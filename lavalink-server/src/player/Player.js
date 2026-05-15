const { EventEmitter } = require('events');
const VoiceConnection = require('../audio/VoiceConnection');
const { getStreamUrl } = require('../sources');
const logger = require('../utils/logger');

class Player extends EventEmitter {
    constructor(guildId, sessionId, userId) {
        super();
        this.guildId = guildId;
        this.sessionId = sessionId;
        this.userId = userId;

        this.state = {
            time: 0,
            position: 0,
            connected: false,
            ping: 0,
        };

        this.track = null;
        this.volume = 100;
        this.paused = false;
        this.filters = {};
        this.voice = {
            token: null,
            endpoint: null,
            sessionId: null,
        };

        this.voiceConn = null;
        this.voiceConnectKey = null;
        this.lastVoiceFailure = null;
        this.positionTimer = null;
        this.startedAt = null;
    }

    updateVoice(voiceState) {
        const { token, endpoint, sessionId } = voiceState;
        if (token) this.voice.token = token;
        if (endpoint) this.voice.endpoint = endpoint;
        if (sessionId) this.voice.sessionId = sessionId;

        if (this.voice.token && this.voice.endpoint && this.voice.sessionId) {
            const nextConnectKey = `${this.voice.endpoint}:${this.voice.sessionId}:${this.voice.token}`;
            if (
                this.voiceConn
                && this.voiceConnectKey === nextConnectKey
                && ['CONNECTING', 'CONNECTED'].includes(this.voiceConn.state)
            ) {
                return;
            }

            this._connectVoice(nextConnectKey);
        }
    }

    _connectVoice(connectKey) {
        if (this.voiceConn) {
            this.voiceConn.destroy();
        }

        this.state.connected = false;
        this.voiceConnectKey = connectKey;
        this.voiceConn = new VoiceConnection(this.guildId, this.userId);

        this.voiceConn.on('ready', () => {
            this.state.connected = true;
            this.lastVoiceFailure = null;
            this.emit('voiceReady');
            // If we have a pending track, play it
            if (this.track && !this.paused) {
                this._startPlaying();
            }
        });

        this.voiceConn.on('disconnected', (code) => {
            this.state.connected = false;
            this.lastVoiceFailure = { code, at: Date.now() };
            this.emit('voiceDisconnected', { guildId: this.guildId, code });
        });

        this.voiceConn.on('trackEnd', ({ reason, error }) => {
            this._stopPositionTimer();
            const oldTrack = this.track;
            this.track = null;
            this.startedAt = null;
            this.state.position = 0;

            this.emit('trackEnd', {
                guildId: this.guildId,
                track: oldTrack,
                reason: error ? 'loadFailed' : reason || 'finished',
            });
        });

        this.voiceConn.connect(this.voice.endpoint, this.voice.token, this.voice.sessionId);
    }

    async playTrack(trackData, options = {}) {
        this.track = trackData;
        this.paused = false;

        if (options.startTime !== undefined) this.state.position = options.startTime;
        if (options.endTime !== undefined) this._scheduleEnd(options.endTime);
        if (options.volume !== undefined) this.volume = options.volume;
        if (options.paused !== undefined) this.paused = options.paused;

        if (this.state.connected && this.voiceConn) {
            await this._startPlaying();
        }
        // If voice not connected yet, will play when voiceReady fires
    }

    async _startPlaying() {
        if (!this.track) return;

        try {
            const streamInfo = await getStreamUrl(this.track.info);
            if (!streamInfo || !streamInfo.url) {
                this.emit('trackException', {
                    guildId: this.guildId,
                    track: this.track,
                    exception: { message: 'No stream URL found', severity: 'suspicious', cause: 'No stream URL' },
                });
                return;
            }

            this.emit('trackStart', { guildId: this.guildId, track: this.track });

            this.voiceConn.play(streamInfo.url, {
                volume: this.volume,
                startTime: this.state.position || 0,
            });

            this.startedAt = Date.now();
            this._startPositionTimer();
        } catch (e) {
            logger.error(`[Player] _startPlaying error guild=${this.guildId}:`, e.message);
            this.emit('trackException', {
                guildId: this.guildId,
                track: this.track,
                exception: { message: e.message, severity: 'suspicious', cause: e.message },
            });
        }
    }

    pause(paused) {
        this.paused = paused;
        if (this.voiceConn) {
            if (paused) {
                this.voiceConn.stop();
                this._stopPositionTimer();
            } else if (this.track) {
                this._startPlaying();
            }
        }
    }

    async seek(position) {
        this.state.position = position;
        if (this.track && this.voiceConn && this.state.connected) {
            await this._startPlaying();
        }
    }

    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1000, volume));
    }

    setFilters(filters) {
        this.filters = { ...this.filters, ...filters };
    }

    stopTrack() {
        if (this.voiceConn) this.voiceConn.stop();
        this._stopPositionTimer();
        const oldTrack = this.track;
        this.track = null;
        this.startedAt = null;
        this.state.position = 0;
        return oldTrack;
    }

    destroy() {
        this._stopPositionTimer();
        if (this.voiceConn) {
            this.voiceConn.destroy();
            this.voiceConn = null;
        }
        this.voiceConnectKey = null;
        this.track = null;
        this.removeAllListeners();
    }

    _startPositionTimer() {
        this._stopPositionTimer();
        this.startedAt = Date.now();
        this.positionTimer = setInterval(() => {
            if (!this.paused && this.startedAt) {
                this.state.position = (this.state.position || 0) + 250;
                this.state.time = Date.now();
            }
        }, 250);
    }

    _stopPositionTimer() {
        if (this.positionTimer) {
            clearInterval(this.positionTimer);
            this.positionTimer = null;
        }
    }

    _scheduleEnd(endTime) {
        const remaining = endTime - (this.state.position || 0);
        if (remaining > 0) {
            setTimeout(() => {
                if (this.track) this.stopTrack();
            }, remaining);
        }
    }

    toJSON() {
        return {
            guildId: this.guildId,
            track: this.track || null,
            volume: this.volume,
            paused: this.paused,
            state: {
                time: Date.now(),
                position: this.state.position || 0,
                connected: this.state.connected,
                ping: this.state.ping || 0,
            },
            voice: this.voice,
            voiceFailure: this.lastVoiceFailure,
            filters: this.filters,
        };
    }
}

module.exports = Player;
