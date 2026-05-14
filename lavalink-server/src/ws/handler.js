const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

class WebSocketManager {
    constructor() {
        // sessionId -> { ws, userId, clientName, resumeKey }
        this.sessions = new Map();
        this.resumeKeys = new Map(); // resumeKey -> sessionId
    }

    setupServer(wss, password) {
        this.password = password;
        wss.on('connection', (ws, req) => this._handleConnection(ws, req));
    }

    _handleConnection(ws, req) {
        const headers = req.headers;
        const auth = headers['authorization'];
        const userId = headers['user-id'];
        const clientName = headers['client-name'] || 'unknown';
        const sessionIdHeader = headers['session-id'];

        if (auth !== this.password) {
            logger.warn(`[WS] Unauthorized connection attempt (client=${clientName})`);
            ws.close(4001, 'Unauthorized');
            return;
        }

        if (!userId) {
            ws.close(4002, 'Missing User-Id header');
            return;
        }

        // Check for resume
        let sessionId;
        if (sessionIdHeader && this.sessions.has(sessionIdHeader)) {
            sessionId = sessionIdHeader;
            const old = this.sessions.get(sessionId);
            if (old.ws && old.ws.readyState === WebSocket.OPEN) old.ws.close();
            this.sessions.get(sessionId).ws = ws;
            logger.info(`[WS] Resumed session=${sessionId} client=${clientName}`);
            this._send(ws, {
                op: 'ready',
                resumed: true,
                sessionId,
            });
        } else {
            sessionId = uuidv4();
            this.sessions.set(sessionId, { ws, userId, clientName, resuming: false, timeout: null });
            logger.info(`[WS] New connection session=${sessionId} client=${clientName} userId=${userId}`);
            this._send(ws, {
                op: 'ready',
                resumed: false,
                sessionId,
            });
        }

        ws.sessionId = sessionId;
        ws.userId = userId;

        ws.on('close', (code) => {
            logger.warn(`[WS] Disconnected session=${sessionId} code=${code}`);
            const session = this.sessions.get(sessionId);
            if (session && session.resuming) {
                // Keep session alive for resume timeout
                session.timeout = setTimeout(() => {
                    this.sessions.delete(sessionId);
                    logger.info(`[WS] Session expired session=${sessionId}`);
                }, session.resumeTimeout || 60000);
            } else {
                this.sessions.delete(sessionId);
            }
        });

        ws.on('error', (e) => {
            logger.error(`[WS] Error session=${sessionId}:`, e.message);
        });

        ws.on('message', (data) => {
            // v4: no client->server WS messages (all via REST)
        });
    }

    _send(ws, data) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    sendToSession(sessionId, data) {
        const session = this.sessions.get(sessionId);
        if (session) {
            this._send(session.ws, data);
        }
    }

    broadcast(data) {
        for (const session of this.sessions.values()) {
            this._send(session.ws, data);
        }
    }

    getSession(sessionId) {
        return this.sessions.get(sessionId) || null;
    }

    enableResume(sessionId, key, timeout) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.resuming = true;
            session.resumeTimeout = timeout;
            if (key) {
                session.resumeKey = key;
                this.resumeKeys.set(key, sessionId);
            }
        }
    }

    getSessions() {
        return this.sessions;
    }
}

module.exports = WebSocketManager;
