const express = require('express');
const router = express.Router();
const infoRouter = require('./info');
const tracksRouter = require('./tracks');
const playersRouter = require('./players');
const sessionsRouter = require('./sessions');
const logger = require('../utils/logger');

// Auth middleware
function authMiddleware(password) {
    return (req, res, next) => {
        // Skip auth for /version
        if (req.path === '/version') return next();

        const auth = req.headers['authorization'];
        if (auth !== password) {
            logger.warn(`[REST] Unauthorized request to ${req.path} from ${req.ip}`);
            return res.status(401).json({
                timestamp: Date.now(),
                status: 401,
                error: 'Unauthorized',
                message: 'Invalid or missing authorization header',
                path: req.path,
            });
        }
        next();
    };
}

function setupRoutes(app, password) {
    app.use(express.json());

    const v4 = express.Router();
    v4.use(authMiddleware(password));

    // Info routes
    v4.use('/', infoRouter);

    // Track routes
    v4.use('/', tracksRouter);

    // Session routes
    v4.use('/sessions', sessionsRouter);

    // Player routes (nested under sessions)
    v4.use('/sessions/:sessionId/players', playersRouter);

    // Route planner (stub - not needed without IP rotation)
    v4.get('/routeplanner/status', (req, res) => {
        res.json({ class: null, details: null });
    });

    v4.post('/routeplanner/free/address', (req, res) => {
        res.status(204).end();
    });

    v4.post('/routeplanner/free/all', (req, res) => {
        res.status(204).end();
    });

    app.use('/v4', v4);

    // Root version check (no auth)
    app.get('/version', (req, res) => {
        res.set('Content-Type', 'text/plain');
        res.send('4.0.8');
    });

    // 404 handler
    app.use((req, res) => {
        res.status(404).json({
            timestamp: Date.now(),
            status: 404,
            error: 'Not Found',
            message: `Route ${req.method} ${req.path} not found`,
            path: req.path,
        });
    });

    // Error handler
    app.use((err, req, res, next) => {
        logger.error('[REST] Unhandled error:', err.message);
        res.status(500).json({
            timestamp: Date.now(),
            status: 500,
            error: 'Internal Server Error',
            message: err.message,
            path: req.path,
        });
    });
}

module.exports = { setupRoutes };
