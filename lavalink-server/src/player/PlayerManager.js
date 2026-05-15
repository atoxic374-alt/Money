const Player = require('./Player');
const logger = require('../utils/logger');

class PlayerManager {
    constructor(wsManager) {
        this.players = new Map(); // guildId -> Player
        this.wsManager = wsManager;
        this.statsInterval = null;
        this._startStats();
    }

    getOrCreate(guildId, sessionId, userId) {
        if (!this.players.has(guildId)) {
            const player = new Player(guildId, sessionId, userId || '0');
            this._bindPlayerEvents(player, sessionId);
            this.players.set(guildId, player);
            logger.debug(`[PlayerManager] Created player guild=${guildId}`);
        }
        return this.players.get(guildId);
    }

    get(guildId) {
        return this.players.get(guildId) || null;
    }

    destroy(guildId) {
        const player = this.players.get(guildId);
        if (player) {
            player.destroy();
            this.players.delete(guildId);
            logger.debug(`[PlayerManager] Destroyed player guild=${guildId}`);
        }
    }

    destroySession(sessionId) {
        for (const [guildId, player] of this.players) {
            if (player.sessionId === sessionId) {
                this.destroy(guildId);
            }
        }
    }

    getBySession(sessionId) {
        const result = [];
        for (const player of this.players.values()) {
            if (player.sessionId === sessionId) result.push(player);
        }
        return result;
    }

    _bindPlayerEvents(player, sessionId) {
        player.on('trackStart', ({ guildId, track }) => {
            this.wsManager.sendToSession(sessionId, {
                op: 'event',
                type: 'TrackStartEvent',
                guildId,
                track,
            });
            // Send playerUpdate
            this.wsManager.sendToSession(sessionId, {
                op: 'playerUpdate',
                guildId,
                state: {
                    time: Date.now(),
                    position: player.state.position || 0,
                    connected: player.state.connected,
                    ping: player.state.ping || 0,
                },
            });
        });

        player.on('trackEnd', ({ guildId, track, reason }) => {
            this.wsManager.sendToSession(sessionId, {
                op: 'event',
                type: 'TrackEndEvent',
                guildId,
                track,
                reason: mapEndReason(reason),
            });
        });

        player.on('trackException', ({ guildId, track, exception }) => {
            this.wsManager.sendToSession(sessionId, {
                op: 'event',
                type: 'TrackExceptionEvent',
                guildId,
                track,
                exception,
            });
        });

        player.on('trackStuck', ({ guildId, track, thresholdMs }) => {
            this.wsManager.sendToSession(sessionId, {
                op: 'event',
                type: 'TrackStuckEvent',
                guildId,
                track,
                thresholdMs,
            });
        });

        player.on('voiceDisconnected', ({ guildId, code }) => {
            this.wsManager.sendToSession(sessionId, {
                op: 'event',
                type: 'TrackExceptionEvent',
                guildId,
                track: player.track,
                exception: {
                    message: `Discord voice gateway closed with code ${code}`,
                    severity: code === 4017 ? 'fault' : 'suspicious',
                    cause: 'voiceDisconnected',
                },
            });
        });
    }

    _startStats() {
        this.statsInterval = setInterval(() => {
            const stats = this.getStats();
            this.wsManager.broadcast({ op: 'stats', ...stats });
        }, 60000);
    }

    getStats() {
        const players = this.players.size;
        let playingPlayers = 0;
        for (const p of this.players.values()) {
            if (p.track && !p.paused) playingPlayers++;
        }

        const memUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();

        return {
            players,
            playingPlayers,
            uptime: process.uptime() * 1000,
            memory: {
                free: memUsage.heapTotal - memUsage.heapUsed,
                used: memUsage.heapUsed,
                allocated: memUsage.heapTotal,
                reservable: memUsage.rss,
            },
            cpu: {
                cores: require('os').cpus().length,
                systemLoad: cpuUsage.system / 1e9,
                lavalinkLoad: cpuUsage.user / 1e9,
            },
            frameStats: {
                sent: 0,
                nulled: 0,
                deficit: 0,
            },
        };
    }
}

function mapEndReason(reason) {
    const map = {
        'finished': 'finished',
        'stopped': 'stopped',
        'replaced': 'replaced',
        'cleanup': 'cleanup',
        'loadFailed': 'loadFailed',
    };
    return map[reason] || 'finished';
}

module.exports = PlayerManager;
