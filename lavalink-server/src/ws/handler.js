/**
 * WebSocket Manager — Lavalink v4 Protocol
 *
 * poru v5 sends these headers on connect:
 *   Authorization: <password>
 *   User-Id: <botUserId>
 *   Client-Name: <clientName>
 *   Resume-Key: <key>  (optional, for session resumption)
 *
 * We respond with op:ready { resumed, sessionId }
 * Then the bot uses sessionId for all REST calls.
 */

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

class WebSocketManager {
    constructor() {
        this.sessions   = new Map(); // sessionId -> session object
        this.resumeKeys = new Map(); // resumeKey -> sessionId (for resume)
    }

    setupServer(wss, password) {
        this.password = password;
        this.wss = wss;

        // Handle path filtering — poru v5 connects to /v4/websocket
        wss.on('connection', (ws, req) => {
            // Accept /v4/websocket and / (some older clients)
            const url = req.url?.split('?')[0];
            if (url && url !== '/v4/websocket' && url !== '/') {
                ws.close(4004, 'Unexpected endpoint');
                return;
            }
            this._handleConnection(ws, req);
        });

        // ── Heartbeat: ping every 20s to keep connection alive through proxies ──
        this._heartbeatInterval = setInterval(() => {
            for (const [sessionId, session] of this.sessions.entries()) {
                const ws = session.ws;
                if (!ws) continue;

                if (ws.readyState !== WebSocket.OPEN) continue;

                if (ws._missedPongs > 0) {
                    // Client didn't respond to last ping — terminate
                    logger.warn(`[WS] No pong received, terminating session=${sessionId}`);
                    ws.terminate();
                    continue;
                }

                ws._missedPongs = (ws._missedPongs || 0) + 1;
                try { ws.ping(); } catch (_) {}
            }
        }, 20000);
    }

    _handleConnection(ws, req) {
        const h = req.headers;

        // ── Auth ──────────────────────────────────────────────────────────────
        if (h['authorization'] !== this.password) {
            logger.warn(`[WS] Unauthorized (client=${h['client-name'] || '?'} ip=${req.socket.remoteAddress})`);
            ws.close(4001, 'Unauthorized');
            return;
        }

        const userId     = h['user-id'];
        const clientName = h['client-name'] || 'unknown';
        const resumeKey  = h['resume-key'] || null;   // poru sends this

        if (!userId) {
            ws.close(4002, 'Missing User-Id header');
            return;
        }

        // ── Session resume ───────────────────────────────────────────────────
        let sessionId;
        let resumed = false;

        if (resumeKey && this.resumeKeys.has(resumeKey)) {
            // Resume existing session
            sessionId = this.resumeKeys.get(resumeKey);
            const old = this.sessions.get(sessionId);
            if (old) {
                if (old.timeoutHandle) { clearTimeout(old.timeoutHandle); old.timeoutHandle = null; }
                if (old.ws?.readyState === WebSocket.OPEN) old.ws.close(1000, 'Replaced by resume');
                old.ws = ws;
                old.connectedAt = Date.now();
                resumed = true;
                logger.info(`[WS] ✅ Session RESUMED session=${sessionId} client=${clientName}`);
            }
        }

        if (!resumed) {
            sessionId = uuidv4();
            this.sessions.set(sessionId, {
                ws,
                userId,
                clientName,
                resumeKey: null,
                resuming: false,
                resumeTimeout: 60000,
                timeoutHandle: null,
                connectedAt: Date.now(),
            });
            if (resumeKey) {
                this.resumeKeys.set(resumeKey, sessionId);
                this.sessions.get(sessionId).resumeKey = resumeKey;
                this.sessions.get(sessionId).resuming = true;
            }
            logger.info(`[WS] ✅ New connection session=${sessionId} client=${clientName} userId=${userId}`);
        }

        ws.sessionId = sessionId;
        ws.userId    = userId;

        // ── Send ready ───────────────────────────────────────────────────────
        this._send(ws, { op: 'ready', resumed, sessionId });

        // ── Handlers ─────────────────────────────────────────────────────────
        ws.on('close', (code, reason) => {
            logger.warn(`[WS] Disconnected session=${sessionId} code=${code}`);
            const session = this.sessions.get(sessionId);
            if (!session) return;

            if (session.resuming && session.resumeTimeout > 0) {
                session.ws = null;
                session.timeoutHandle = setTimeout(() => {
                    this.sessions.delete(sessionId);
                    if (session.resumeKey) this.resumeKeys.delete(session.resumeKey);
                    logger.info(`[WS] Session expired (timeout) session=${sessionId}`);
                }, session.resumeTimeout);
                logger.info(`[WS] Session kept for resume ${session.resumeTimeout}ms session=${sessionId}`);
            } else {
                this.sessions.delete(sessionId);
                if (session.resumeKey) this.resumeKeys.delete(session.resumeKey);
            }
        });

        ws.on('pong', () => {
            ws._missedPongs = 0;
        });

        ws.on('error', (e) => {
            logger.debug(`[WS] WS error session=${sessionId}: ${e.message}`);
        });

        // Lavalink v4: all control is via REST. WS is receive-only from server side.
        // However poru v5 may send configureResuming op
        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.op === 'configureResuming') {
                    const session = this.sessions.get(sessionId);
                    if (session) {
                        session.resuming = msg.key != null;
                        session.resumeTimeout = (msg.timeout || 60) * 1000;
                        if (msg.key) {
                            session.resumeKey = msg.key;
                            this.resumeKeys.set(msg.key, sessionId);
                        }
                        logger.debug(`[WS] configureResuming key=${msg.key} timeout=${msg.timeout} session=${sessionId}`);
                    }
                }
            } catch {}
        });
    }

    // ── Send helpers ──────────────────────────────────────────────────────────
    _send(ws, data) {
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    sendToSession(sessionId, data) {
        const session = this.sessions.get(sessionId);
        if (session?.ws) this._send(session.ws, data);
    }

    broadcast(data) {
        for (const s of this.sessions.values()) {
            if (s.ws) this._send(s.ws, data);
        }
    }

    // ── Session management ────────────────────────────────────────────────────
    getSession(sessionId) {
        return this.sessions.get(sessionId) || null;
    }

    getSessions() {
        return this.sessions;
    }

    enableResume(sessionId, key, timeout) {
        const s = this.sessions.get(sessionId);
        if (!s) return;
        s.resuming = true;
        s.resumeTimeout = timeout || 60000;
        if (key) {
            s.resumeKey = key;
            this.resumeKeys.set(key, sessionId);
        }
    }
}

module.exports = WebSocketManager;
