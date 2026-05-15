/**
 * Discord Voice Connection
 *
 * Audio quality settings (2025 best practices):
 * - Opus 128kbps @ 48kHz stereo — transparent quality, efficient
 * - Frame size 960 samples = 20ms frames (Discord standard)
 * - FFmpeg: -b:a 128k -ar 48000 -ac 2 -application audio
 * - Reconnect on disconnect with exponential backoff
 * - Silence frames sent before/after to avoid Discord audio glitches
 */

const WebSocket = require('ws');
const dgram = require('dgram');
const { spawn, execSync } = require('child_process');
const nacl = require('tweetnacl');
const { EventEmitter } = require('events');
const logger = require('../utils/logger');

// Use system ffmpeg (higher quality, more codecs)
let FFMPEG_PATH;
try {
    FFMPEG_PATH = execSync('which ffmpeg', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().trim();
} catch {
    try { FFMPEG_PATH = require('ffmpeg-static'); } catch { FFMPEG_PATH = 'ffmpeg'; }
}

const OPUS_SAMPLE_RATE = 48000;
const OPUS_CHANNELS = 2;
const OPUS_FRAME_SIZE = 960;          // 20ms at 48kHz
const OPUS_FRAME_DURATION_MS = 20;
const OPUS_BITRATE = '128k';          // 128kbps — transparent for music
const SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);
const SILENCE_FRAMES_COUNT = 5;

// ── Opus encoder loader ────────────────────────────────────────────────────────
let OpusEncoder = null;
function loadOpus() {
    if (OpusEncoder) return OpusEncoder;
    try {
        const prism = require('prism-media');
        OpusEncoder = prism.opus.Encoder;
        logger.debug('[Voice] Opus encoder: prism-media');
    } catch (e) {
        logger.error('[Voice] prism-media not available:', e.message);
    }
    return OpusEncoder;
}

class VoiceConnection extends EventEmitter {
    constructor(guildId, userId) {
        super();
        this.guildId = guildId;
        this.userId = userId;

        // State
        this.state = 'DISCONNECTED'; // DISCONNECTED | CONNECTING | CONNECTED | DESTROYED
        this.ws = null;
        this.udp = null;
        this.ssrc = null;
        this.secretKey = null;
        this.mode = null;
        this.voiceIp = null;
        this.voicePort = null;

        // RTP state
        this.sequence = Math.floor(Math.random() * 0xffff);
        this.timestamp = Math.floor(Math.random() * 0xffffffff);
        this.nonce = 0;

        // Playback state
        this.ffmpegProc = null;
        this.opusEncoder = null;
        this.playTimer = null;
        this.frameQueue = [];
        this.playing = false;

        // Reconnect state
        this.heartbeatInterval = null;
        this.reconnectTimeout = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.lastCloseCode = null;

        loadOpus();
    }

    // ── Connect ──────────────────────────────────────────────────────────────
    connect(endpoint, token, sessionId) {
        if (this.state === 'DESTROYED') return;
        this.endpoint = endpoint;
        this.token = token;
        this.sessionId = sessionId;
        this.state = 'CONNECTING';
        this._connectWS();
    }

    _connectWS() {
        if (this.ws) {
            this.ws.removeAllListeners();
            try { this.ws.close(); } catch {}
            this.ws = null;
        }

        const host = this.endpoint.replace(/:.*/, '');
        const wsUrl = `wss://${host}/?v=8`;
        logger.debug(`[Voice] WS → ${wsUrl} guild=${this.guildId}`);

        this.ws = new WebSocket(wsUrl, {
            headers: { 'User-Agent': 'DiscordBot (custom-lavalink, 4.0)' }
        });

        this.ws.on('open', () => this._identify());
        this.ws.on('message', (raw) => {
            try { this._handleOP(JSON.parse(raw.toString())); } catch {}
        });
        this.ws.on('close', (code) => this._onClose(code));
        this.ws.on('error', (e) => logger.warn(`[Voice] WS error guild=${this.guildId}: ${e.message}`));
    }

    _identify() {
        this._wsSend({ op: 0, d: { server_id: this.guildId, user_id: this.userId, session_id: this.sessionId, token: this.token } });
    }

    _handleOP(msg) {
        switch (msg.op) {
            case 2: // Ready
                this.ssrc = msg.d.ssrc;
                this.voiceIp = msg.d.ip;
                this.voicePort = msg.d.port;
                this.mode = this._pickMode(msg.d.modes);
                this._setupUDP();
                break;

            case 4: // Session Description
                this.secretKey = new Uint8Array(msg.d.secret_key);
                this.state = 'CONNECTED';
                this.reconnectAttempts = 0;
                logger.info(`[Voice] Connected guild=${this.guildId} mode=${this.mode}`);
                this.emit('ready');
                break;

            case 6: // Heartbeat ACK
                break;

            case 8: // Hello
                this._startHeartbeat(msg.d.heartbeat_interval);
                break;

            case 9: // Resumed
                this.state = 'CONNECTED';
                logger.info(`[Voice] Resumed guild=${this.guildId}`);
                this.emit('ready');
                break;

            case 13: // Client Disconnect
                break;
        }
    }

    _pickMode(modes) {
        const priority = ['xsalsa20_poly1305_lite', 'xsalsa20_poly1305_suffix', 'xsalsa20_poly1305'];
        for (const m of priority) if (modes.includes(m)) return m;
        return modes[0];
    }

    _onClose(code) {
        logger.warn(`[Voice] WS closed ${code} guild=${this.guildId}`);
        this._clearHeartbeat();
        if (this.state === 'DESTROYED') return;

        this.lastCloseCode = code;

        const nonResumableCodes = new Set([4001, 4004, 4006, 4009, 4011, 4014, 4016, 4017]);
        if (nonResumableCodes.has(code)) {
            const hint = code === 4017 ? ' (DAVE/E2EE-capable voice implementation required)' : '';
            logger.warn(`[Voice] Non-resumable close code ${code}${hint}; waiting for a fresh voice update guild=${this.guildId}`);
            this.state = 'DISCONNECTED';
            this._closeTransport();
            this.emit('disconnected', code);
            return;
        }

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.warn(`[Voice] Max reconnect attempts reached guild=${this.guildId}`);
            this.state = 'DISCONNECTED';
            this._closeTransport();
            this.emit('disconnected', code);
            return;
        }

        this.state = 'CONNECTING';
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
        logger.info(`[Voice] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}) guild=${this.guildId}`);
        this.reconnectTimeout = setTimeout(() => {
            if (this.state !== 'DESTROYED') this._connectWS();
        }, delay);
    }

    // ── UDP ──────────────────────────────────────────────────────────────────
    _setupUDP() {
        if (this.udp) { try { this.udp.close(); } catch {} }
        this.udp = dgram.createSocket('udp4');
        this.udp.on('message', (msg) => {
            if (msg.readUInt16BE(0) === 2 && msg.length >= 74) {
                const nullAt = msg.indexOf(0, 8);
                const myIp = msg.toString('ascii', 8, nullAt > 8 ? nullAt : 72);
                const myPort = msg.readUInt16BE(msg.length - 2);
                this._selectProtocol(myIp, myPort);
            }
        });
        this.udp.on('error', (e) => logger.warn(`[Voice] UDP error: ${e.message}`));
        this._ipDiscovery();
    }

    _ipDiscovery() {
        const buf = Buffer.alloc(74);
        buf.writeUInt16BE(1, 0);
        buf.writeUInt16BE(70, 2);
        buf.writeUInt32BE(this.ssrc, 4);
        this.udp.send(buf, this.voicePort, this.voiceIp);
    }

    _selectProtocol(ip, port) {
        this._wsSend({ op: 1, d: { protocol: 'udp', data: { address: ip, port, mode: this.mode } } });
    }

    // ── Heartbeat ────────────────────────────────────────────────────────────
    _startHeartbeat(interval) {
        this._clearHeartbeat();
        // Add jitter to avoid synchronized heartbeats across many bots
        const jittered = interval * (0.8 + Math.random() * 0.4);
        this.heartbeatInterval = setInterval(() => {
            this._wsSend({ op: 3, d: Date.now() });
        }, jittered);
    }

    _clearHeartbeat() {
        if (this.heartbeatInterval) { clearInterval(this.heartbeatInterval); this.heartbeatInterval = null; }
    }

    _closeTransport() {
        if (this.reconnectTimeout) { clearTimeout(this.reconnectTimeout); this.reconnectTimeout = null; }
        if (this.udp) { try { this.udp.close(); } catch {} this.udp = null; }
        this.ws = null;
    }

    // ── Audio Playback ───────────────────────────────────────────────────────
    play(audioUrl, options = {}) {
        this.stop();
        if (this.state !== 'CONNECTED') {
            logger.warn(`[Voice] Cannot play — not connected (${this.state}) guild=${this.guildId}`);
            return;
        }

        const { volume = 100, startTime = 0, isHLS = false } = options;

        const enc = loadOpus();
        if (!enc) {
            logger.error('[Voice] No Opus encoder, cannot play audio');
            this.emit('trackEnd', { reason: 'loadFailed' });
            return;
        }

        // ── FFmpeg args for maximum quality, minimum CPU ──────────────────────
        const ffArgs = [];

        // Reconnect options (essential for HLS and expiring CDN URLs)
        ffArgs.push(
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '5',
            '-reconnect_at_eof', '1',
        );

        // Input
        ffArgs.push('-ss', String(startTime / 1000));
        ffArgs.push('-i', audioUrl);

        // Audio processing
        const filters = [];
        if (volume !== 100) filters.push(`volume=${volume / 100}`);
        // loudnorm for consistent volume (low CPU impact with linear mode)
        // filters.push('loudnorm=I=-16:TP=-1.5:LRA=11:linear=true');

        ffArgs.push('-analyzeduration', '0');
        ffArgs.push('-loglevel', 'error');

        if (filters.length > 0) {
            ffArgs.push('-af', filters.join(','));
        }

        // Output: raw PCM → piped to Opus encoder
        ffArgs.push(
            '-ar', String(OPUS_SAMPLE_RATE),
            '-ac', String(OPUS_CHANNELS),
            '-f', 's16le',
            'pipe:1',
        );

        this.ffmpegProc = spawn(FFMPEG_PATH, ffArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

        this.ffmpegProc.stderr.on('data', (d) => {
            const msg = d.toString().trim();
            if (msg && !msg.startsWith('frame=')) {
                logger.debug(`[Voice] FFmpeg: ${msg}`);
            }
        });

        // Opus encoder: 128kbps, application=audio (optimized for music)
        this.opusEncoder = new enc({
            rate: OPUS_SAMPLE_RATE,
            channels: OPUS_CHANNELS,
            frameSize: OPUS_FRAME_SIZE,
            application: 'audio',  // better quality than 'voip' for music
            bitrate: 128000,
        });

        this.frameQueue = [];
        this.playing = true;

        this.ffmpegProc.stdout.pipe(this.opusEncoder);

        this.opusEncoder.on('data', (frame) => {
            this.frameQueue.push(Buffer.from(frame));
        });

        this.opusEncoder.on('end', () => {
            this.playing = false;
            // Give queue time to drain
            setTimeout(() => {
                if (this.frameQueue.length === 0) {
                    this._sendSilence();
                    this.emit('trackEnd', { reason: 'finished' });
                }
            }, 200);
        });

        this.ffmpegProc.on('error', (e) => {
            logger.error(`[Voice] FFmpeg proc error: ${e.message}`);
            this.playing = false;
            this.emit('trackEnd', { reason: 'loadFailed', error: e.message });
        });

        // Timed frame sender — sends exactly 1 frame every 20ms
        let emptyFrames = 0;
        this.playTimer = setInterval(() => {
            if (this.state !== 'CONNECTED') return;

            const frame = this.frameQueue.shift();
            if (!frame) {
                if (!this.playing) {
                    emptyFrames++;
                    if (emptyFrames > 5) {
                        clearInterval(this.playTimer);
                        this.playTimer = null;
                        this._sendSilence();
                        this.emit('trackEnd', { reason: 'finished' });
                    }
                }
                // Send silence to keep connection alive
                this._sendRTPFrame(SILENCE_FRAME);
                return;
            }

            emptyFrames = 0;
            this._sendRTPFrame(frame);
        }, OPUS_FRAME_DURATION_MS);

        logger.info(`[Voice] Playing guild=${this.guildId} vol=${volume}% start=${startTime}ms`);
    }

    _sendRTPFrame(opusFrame) {
        if (!this.udp || !this.secretKey) return;

        const header = Buffer.allocUnsafe(12);
        header[0] = 0x80;
        header[1] = 0x78;
        header.writeUInt16BE(this.sequence & 0xffff, 2);
        header.writeUInt32BE(this.timestamp >>> 0, 4);
        header.writeUInt32BE(this.ssrc, 8);

        this.sequence = (this.sequence + 1) & 0xffff;
        this.timestamp = (this.timestamp + OPUS_FRAME_SIZE) >>> 0;

        const encrypted = this._encrypt(header, opusFrame);
        if (!encrypted) return;

        const packet = Buffer.concat([header, encrypted]);
        this.udp.send(packet, this.voicePort, this.voiceIp);
    }

    _encrypt(header, data) {
        if (!this.secretKey) return null;
        const key = this.secretKey;

        if (this.mode === 'xsalsa20_poly1305_lite') {
            this.nonce = (this.nonce + 1) >>> 0;
            const nonce = Buffer.allocUnsafe(24).fill(0);
            nonce.writeUInt32BE(this.nonce, 0);
            const encrypted = nacl.secretbox(data, nonce, key);
            return Buffer.concat([encrypted, nonce.slice(0, 4)]);
        }

        if (this.mode === 'xsalsa20_poly1305_suffix') {
            const nonce = nacl.randomBytes(24);
            const encrypted = nacl.secretbox(data, nonce, key);
            return Buffer.concat([encrypted, nonce]);
        }

        // xsalsa20_poly1305 — nonce is first 24 bytes of RTP header, zero-padded
        const nonce = Buffer.allocUnsafe(24).fill(0);
        header.copy(nonce, 0, 0, Math.min(12, header.length));
        return nacl.secretbox(data, nonce, key);
    }

    _sendSilence(count = SILENCE_FRAMES_COUNT) {
        for (let i = 0; i < count; i++) this._sendRTPFrame(SILENCE_FRAME);
    }

    stop() {
        this.playing = false;
        if (this.playTimer) { clearInterval(this.playTimer); this.playTimer = null; }
        if (this.opusEncoder) { try { this.opusEncoder.destroy(); } catch {} this.opusEncoder = null; }
        if (this.ffmpegProc) { try { this.ffmpegProc.kill('SIGKILL'); } catch {} this.ffmpegProc = null; }
        this.frameQueue = [];
        this._sendSilence();
    }

    // ── Cleanup ──────────────────────────────────────────────────────────────
    destroy() {
        this.state = 'DESTROYED';
        this.stop();
        this._clearHeartbeat();
        if (this.reconnectTimeout) { clearTimeout(this.reconnectTimeout); this.reconnectTimeout = null; }
        if (this.ws) { try { this.ws.close(1000); } catch {} this.ws = null; }
        if (this.udp) { try { this.udp.close(); } catch {} this.udp = null; }
        this.removeAllListeners();
        logger.debug(`[Voice] Destroyed guild=${this.guildId}`);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────
    _wsSend(data) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }
}

module.exports = VoiceConnection;
