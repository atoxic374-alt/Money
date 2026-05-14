process.on('uncaughtException', err => console.error('[FATAL] Uncaught Exception:', err.message));
process.on('unhandledRejection', r => console.error('[FATAL] Unhandled Rejection:', r?.message || r));

const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const chalk = require('chalk');
const os = require('os');

const logger = require('./utils/logger');
const WebSocketManager = require('./ws/handler');
const PlayerManager = require('./player/PlayerManager');
const { setupRoutes } = require('./rest/router');

// ── Config ────────────────────────────────────────────────────────────────────
let config = {};
try {
    const configPath = path.join(__dirname, '..', 'config.yml');
    config = yaml.parse(fs.readFileSync(configPath, 'utf8'));
} catch { logger.warn('config.yml not found, using defaults'); }

const PORT     = parseInt(process.env.PORT     || config?.server?.port     || 3000);
const HOST     = process.env.HOST              || config?.server?.address  || '0.0.0.0';
const PASSWORD = process.env.LAVALINK_PASSWORD || config?.lavalink?.server?.password || 'youshallnotpass';

// Set env vars for sources
if (config?.plugins?.spotify?.clientId)     process.env.SPOTIFY_CLIENT_ID     = config.plugins.spotify.clientId;
if (config?.plugins?.spotify?.clientSecret) process.env.SPOTIFY_CLIENT_SECRET = config.plugins.spotify.clientSecret;

// ── Banner ────────────────────────────────────────────────────────────────────
console.log(chalk.cyan(`
╔══════════════════════════════════════════════════╗
║   🎵  Custom Lavalink Server  v4.0.8             ║
║   YouTube • Spotify • SoundCloud • Deezer • AM   ║
║   Anti-ban • HQ Audio • Low Resources            ║
╚══════════════════════════════════════════════════╝
`));
logger.info(`Node.js ${process.version} | OS: ${os.type()} ${os.arch()}`);
logger.info(`CPUs: ${os.cpus().length} | RAM: ${Math.round(os.totalmem() / 1024 / 1024)}MB`);

// ── Server setup ──────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

const wsManager     = new WebSocketManager();
const playerManager = new PlayerManager(wsManager);

wsManager.setupServer(wss, PASSWORD);
app.set('wsManager', wsManager);
app.set('playerManager', playerManager);

// Health endpoint (no auth required)
app.get('/health', (req, res) => {
    const { getResults } = require('./health');
    const mem = process.memoryUsage();
    res.json({
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        memory: { usedMB: Math.round(mem.heapUsed / 1024 / 1024), totalMB: Math.round(mem.heapTotal / 1024 / 1024) },
        players: playerManager.players.size,
        platforms: getResults(),
    });
});

setupRoutes(app, PASSWORD);

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, HOST, async () => {
    logger.info(`Listening on ${HOST}:${PORT}`);
    logger.info(`Password: ${PASSWORD}`);
    logger.info('Sources: YouTube (iOS/mweb/web) • Spotify • SoundCloud • Deezer • Apple Music • HTTP');
    logger.info('Anti-ban: Client rotation • UA rotation • Rate limiting • Retry with backoff');
    logger.info('Audio: Opus 128kbps 48kHz stereo • FFmpeg reconnect • HLS/WebM/m4a');

    writeHostConfig(HOST, PORT, PASSWORD);

    // Run platform health checks after server is up (non-blocking)
    setTimeout(async () => {
        try {
            const { runAll } = require('./health');
            await runAll();
        } catch (e) {
            logger.warn('[Health] Check failed:', e.message);
        }
    }, 3000);
});

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') { logger.error(`Port ${PORT} in use!`); process.exit(1); }
    logger.error('Server error:', e.message);
});

// ── Write host.json ───────────────────────────────────────────────────────────
function writeHostConfig(host, port, password) {
    const listenHost = host === '0.0.0.0' ? '127.0.0.1' : host;
    const config = [{ host: listenHost, port: Number(port), secure: false, password, resumeKey: 'lavalink-custom' }];
    const paths = [
        path.join(__dirname, '..', '..', 'settings', 'host.json'),
        path.join(__dirname, '..', 'host.json'),
    ];
    for (const p of paths) {
        try {
            if (fs.existsSync(path.dirname(p))) {
                fs.writeFileSync(p, JSON.stringify(config, null, 2));
                logger.info(`✅ host.json → ${listenHost}:${port} (${p})`);
            }
        } catch (e) {
            logger.debug(`Could not write ${p}: ${e.message}`);
        }
    }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function shutdown(signal) {
    logger.info(`[${signal}] Graceful shutdown...`);
    server.close(() => {
        logger.info('Server closed. Bye!');
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = { app, server, wsManager, playerManager };
