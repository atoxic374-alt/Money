const WebSocket = require('ws');
const dgram = require('dgram');
const { spawn } = require('child_process');
const nacl = require('tweetnacl');
// Use system ffmpeg if available, fallback to ffmpeg-static
let ffmpegPath;
try { ffmpegPath = require('child_process').execSync('which ffmpeg').toString().trim(); } catch { ffmpegPath = require('ffmpeg-static'); }
const logger = require('../utils/logger');
const { EventEmitter } = require('events');

const SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);
const OPUS_SAMPLE_RATE = 48000;
const OPUS_FRAME_SIZE = 960;
const OPUS_FRAME_DURATION = 20; // ms

class VoiceConnection extends EventEmitter {
    constructor(guildId, userId) {
        super();
        this.guildId = guildId;
        this.userId = userId;
        this.state = 'DISCONNECTED';
        this.ws = null;
        this.udp = null;
        this.ssrc = null;
        this.secretKey = null;
        this.sequence = Math.floor(Math.random() * 0xffff);
        this.timestamp = Math.floor(Math.random() * 0xffffffff);
        this.ip = null;
        this.port = null;
        this.mode = null;
        this.ffmpeg = null;
        this.playInterval = null;
        this.opus = null;
        this._loadOpus();
        this.heartbeatInterval = null;
        this.nonce = 0;
    }

    _loadOpus() {
        try {
            const prism = require('prism-media');
            this.OpusEncoder = prism.opus.Encoder;
        } catch (e) {
            logger.warn('prism-media not available, using fallback');
            this.OpusEncoder = null;
        }
    }

    connect(endpoint, token, sessionId) {
        this.endpoint = endpoint;
        this.token = token;
        this.sessionId = sessionId;

        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.close();
        }

        const wsUrl = `wss://${endpoint.replace(/:.*/, '')}/?v=8`;
        logger.debug(`[Voice] Connecting to ${wsUrl}`);
        this.ws = new WebSocket(wsUrl);

        this.ws.on('open', () => {
            this._identify();
        });

        this.ws.on('message', (data) => {
            try {
                const payload = JSON.parse(data.toString());
                this._handleGatewayMessage(payload);
            } catch (e) {
                logger.error('[Voice] WS parse error:', e.message);
            }
        });

        this.ws.on('close', (code) => {
            logger.warn(`[Voice] WS closed: ${code} guild=${this.guildId}`);
            this._cleanup();
            if (code !== 1000 && code !== 4006 && code !== 4014) {
                setTimeout(() => {
                    if (this.endpoint) this.connect(this.endpoint, this.token, this.sessionId);
                }, 5000);
            }
        });

        this.ws.on('error', (e) => {
            logger.error('[Voice] WS error:', e.message);
        });
    }

    _identify() {
        this._send({
            op: 0,
            d: {
                server_id: this.guildId,
                user_id: this.userId,
                session_id: this.sessionId,
                token: this.token,
            }
        });
    }

    _handleGatewayMessage(payload) {
        switch (payload.op) {
            case 2: // Ready
                this.ssrc = payload.d.ssrc;
                this.ip = payload.d.ip;
                this.port = payload.d.port;
                const modes = payload.d.modes;
                this.mode = modes.includes('xsalsa20_poly1305_lite')
                    ? 'xsalsa20_poly1305_lite'
                    : modes.includes('xsalsa20_poly1305_suffix')
                        ? 'xsalsa20_poly1305_suffix'
                        : 'xsalsa20_poly1305';
                this._setupUDP();
                break;

            case 4: // Session Description
                this.secretKey = new Uint8Array(payload.d.secret_key);
                this.state = 'CONNECTED';
                logger.info(`[Voice] Ready guild=${this.guildId} mode=${this.mode}`);
                this.emit('ready');
                break;

            case 6: // Heartbeat ACK
                break;

            case 8: // Hello
                const interval = payload.d.heartbeat_interval;
                this._startHeartbeat(interval);
                break;

            case 9: // Resumed
                this.state = 'CONNECTED';
                logger.info(`[Voice] Resumed guild=${this.guildId}`);
                break;

            case 13: // Client Disconnect
                break;
        }
    }

    _setupUDP() {
        this.udp = dgram.createSocket('udp4');

        this.udp.on('message', (msg) => {
            if (msg.length < 8) return;
            // IP discovery response
            if (msg.readUInt16BE(0) === 2) {
                const nullIndex = msg.indexOf(0, 8);
                const myIp = msg.toString('ascii', 8, nullIndex);
                const myPort = msg.readUInt16BE(msg.length - 2);
                this._selectProtocol(myIp, myPort);
            }
        });

        this.udp.on('error', (e) => {
            logger.error('[Voice] UDP error:', e.message);
        });

        this._ipDiscovery();
    }

    _ipDiscovery() {
        const buf = Buffer.allocUnsafe(74);
        buf.writeUInt16BE(1, 0);  // request type
        buf.writeUInt16BE(70, 2); // length
        buf.writeUInt32BE(this.ssrc, 4);
        this.udp.send(buf, 0, 74, this.port, this.ip);
    }

    _selectProtocol(myIp, myPort) {
        this._send({
            op: 1,
            d: {
                protocol: 'udp',
                data: {
                    address: myIp,
                    port: myPort,
                    mode: this.mode,
                }
            }
        });
    }

    _startHeartbeat(interval) {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        const jittered = interval * (0.75 + Math.random() * 0.5);
        this.heartbeatInterval = setInterval(() => {
            this._send({ op: 3, d: Date.now() });
        }, jittered);
    }

    _send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    _encryptPacket(packet) {
        if (!this.secretKey) return null;
        let nonceBuf;
        let encrypted;

        if (this.mode === 'xsalsa20_poly1305_lite') {
            this.nonce = (this.nonce + 1) >>> 0;
            nonceBuf = Buffer.allocUnsafe(24).fill(0);
            nonceBuf.writeUInt32BE(this.nonce, 0);
            encrypted = nacl.secretbox(packet, nonceBuf, this.secretKey);
            return Buffer.concat([encrypted, nonceBuf.slice(0, 4)]);
        } else if (this.mode === 'xsalsa20_poly1305_suffix') {
            nonceBuf = nacl.randomBytes(24);
            encrypted = nacl.secretbox(packet, nonceBuf, this.secretKey);
            return Buffer.concat([encrypted, nonceBuf]);
        } else {
            // xsalsa20_poly1305 - nonce = first 24 bytes of header padded
            nonceBuf = Buffer.allocUnsafe(24).fill(0);
            packet.copy(nonceBuf, 0, 0, Math.min(12, packet.length));
            encrypted = nacl.secretbox(packet, nonceBuf, this.secretKey);
            return encrypted;
        }
    }

    _buildRTPHeader(opusFrame) {
        const header = Buffer.allocUnsafe(12);
        header[0] = 0x80;
        header[1] = 0x78;
        header.writeUInt16BE(this.sequence & 0xffff, 2);
        header.writeUInt32BE(this.timestamp >>> 0, 4);
        header.writeUInt32BE(this.ssrc, 8);
        this.sequence = (this.sequence + 1) & 0xffff;
        this.timestamp = (this.timestamp + OPUS_FRAME_SIZE) >>> 0;
        return header;
    }

    _sendSilence(count = 5) {
        for (let i = 0; i < count; i++) {
            const header = this._buildRTPHeader();
            const payload = Buffer.concat([header, SILENCE_FRAME]);
            const encrypted = this._encryptPacket(payload);
            if (encrypted && this.udp) {
                const pkt = Buffer.concat([header, encrypted]);
                this.udp.send(pkt, 0, pkt.length, this.port, this.ip);
            }
        }
    }

    play(audioUrl, options = {}) {
        this.stop();
        if (this.state !== 'CONNECTED') {
            logger.warn('[Voice] Not connected, cannot play');
            return;
        }

        const { volume = 100, startTime = 0 } = options;
        const volumeFilter = volume !== 100 ? `volume=${volume / 100}` : null;

        const ffmpegArgs = [
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '5',
            '-ss', String(startTime / 1000),
            '-i', audioUrl,
            '-analyzeduration', '0',
            '-loglevel', 'error',
            '-ar', String(OPUS_SAMPLE_RATE),
            '-ac', '2',
            '-f', 's16le',
        ];

        if (volumeFilter) {
            ffmpegArgs.splice(ffmpegArgs.indexOf('-ar'), 0, '-af', volumeFilter);
        }

        this.ffmpeg = spawn(ffmpegPath, ffmpegArgs);

        if (!this.OpusEncoder) {
            logger.error('[Voice] No Opus encoder available');
            return;
        }

        const opusEncoder = new this.OpusEncoder({
            rate: OPUS_SAMPLE_RATE,
            channels: 2,
            frameSize: OPUS_FRAME_SIZE,
        });

        this.ffmpeg.stdout.pipe(opusEncoder);

        let frameQueue = [];
        let playing = true;

        opusEncoder.on('data', (frame) => {
            frameQueue.push(Buffer.from(frame));
        });

        opusEncoder.on('end', () => {
            playing = false;
            setTimeout(() => {
                this._sendSilence();
                this.emit('trackEnd', { reason: 'finished' });
            }, 100);
        });

        this.ffmpeg.on('error', (e) => {
            logger.error('[Voice] FFmpeg error:', e.message);
            playing = false;
            this.emit('trackEnd', { reason: 'loadFailed', error: e.message });
        });

        this.ffmpeg.stderr.on('data', (d) => {
            const msg = d.toString();
            if (msg.includes('Error') || msg.includes('error')) {
                logger.warn('[Voice] FFmpeg stderr:', msg.trim());
            }
        });

        let lastFrameTime = Date.now();

        this.playInterval = setInterval(() => {
            if (!playing && frameQueue.length === 0) {
                clearInterval(this.playInterval);
                return;
            }

            const frame = frameQueue.shift();
            if (!frame) return;

            const header = this._buildRTPHeader();
            const encrypted = this._encryptPacket(frame);
            if (!encrypted || !this.udp) return;

            let pkt;
            if (this.mode === 'xsalsa20_poly1305') {
                pkt = Buffer.concat([header, encrypted]);
            } else {
                pkt = Buffer.concat([header, encrypted]);
            }

            this.udp.send(pkt, 0, pkt.length, this.port, this.ip, (err) => {
                if (err) logger.error('[Voice] UDP send error:', err.message);
            });
        }, OPUS_FRAME_DURATION);

        logger.info(`[Voice] Playing guild=${this.guildId}`);
    }

    stop() {
        if (this.playInterval) {
            clearInterval(this.playInterval);
            this.playInterval = null;
        }
        if (this.ffmpeg) {
            try { this.ffmpeg.kill('SIGKILL'); } catch {}
            this.ffmpeg = null;
        }
        this._sendSilence(5);
    }

    destroy() {
        this.stop();
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.ws) { this.ws.close(); this.ws = null; }
        if (this.udp) { this.udp.close(); this.udp = null; }
        this.state = 'DISCONNECTED';
        this.endpoint = null;
        this.token = null;
        this.sessionId = null;
        this.removeAllListeners();
    }

    _cleanup() {
        this.state = 'DISCONNECTED';
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    }
}

module.exports = VoiceConnection;
