process.on('uncaughtException', err => {
    console.error('[FATAL] Uncaught Exception:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] Unhandled Rejection:', reason?.message || reason);
});

const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const chalk = require('chalk');

const logger = require('./utils/logger');
const WebSocketManager = require('./ws/handler');
const PlayerManager = require('./player/PlayerManager');
const { setupRoutes } = require('./rest/router');

// Load config
let config;
const configPath = path.join(__dirname, '..', 'config.yml');
try {
    config = yaml.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
    logger.warn('config.yml not found, using defaults');
    config = {};
}

const PORT = process.env.PORT || config?.server?.port || 2333;
const HOST = process.env.HOST || config?.server?.address || '0.0.0.0';
const PASSWORD = process.env.LAVALINK_PASSWORD || config?.lavalink?.server?.password || 'youshallnotpass';

// Set env vars for sources
if (config?.plugins?.spotify?.clientId) process.env.SPOTIFY_CLIENT_ID = config.plugins.spotify.clientId;
if (config?.plugins?.spotify?.clientSecret) process.env.SPOTIFY_CLIENT_SECRET = config.plugins.spotify.clientSecret;

// Boot banner
console.log(chalk.cyan(`
╔══════════════════════════════════════════╗
║     🎵  Custom Lavalink Server v4.0.8    ║
║   YouTube • Spotify • SC • Deezer • AM   ║
╚══════════════════════════════════════════╝
`));

const app = express();
const server = http.createServer(app);

// Setup WebSocket server
const wss = new WebSocket.Server({ server });
const wsManager = new WebSocketManager();
wsManager.setupServer(wss, PASSWORD);

// Setup Player Manager
const playerManager = new PlayerManager(wsManager);

// Expose managers to route handlers
app.set('wsManager', wsManager);
app.set('playerManager', playerManager);

// Setup REST routes
setupRoutes(app, PASSWORD);

// Start server
server.listen(PORT, HOST, () => {
    logger.info(`Server listening on ${HOST}:${PORT}`);
    logger.info(`Password: ${PASSWORD}`);
    logger.info('Sources: YouTube, Spotify, SoundCloud, Deezer, Apple Music, HTTP');
    logger.info('Anti-ban: User-Agent rotation, client rotation, request jitter');
    logger.info('Ready to accept connections!');

    // Write host.json for the bot to use
    writeHostConfig(HOST, PORT, PASSWORD);
});

function writeHostConfig(host, port, password) {
    const hostConfigPath = path.join(__dirname, '..', '..', 'settings', 'host.json');
    const listenHost = host === '0.0.0.0' ? '127.0.0.1' : host;

    const hostConfig = [
        {
            host: listenHost,
            port: Number(port),
            secure: false,
            password: password,
            resumeKey: 'lavalink-custom',
        }
    ];

    try {
        fs.writeFileSync(hostConfigPath, JSON.stringify(hostConfig, null, 2));
        logger.info(`✅ host.json updated → ${listenHost}:${port}`);
    } catch (e) {
        logger.warn('Could not write host.json:', e.message);
    }
}

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} already in use!`);
        process.exit(1);
    }
    logger.error('Server error:', e.message);
});

module.exports = { app, server, wsManager, playerManager };
