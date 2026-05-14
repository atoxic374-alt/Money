const router = require('express').Router({ mergeParams: true });
const logger = require('../utils/logger');

// PATCH session - update session (resume config)
router.patch('/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const wsManager = req.app.get('wsManager');
    const body = req.body;

    const session = wsManager.getSession(sessionId);
    if (!session) {
        return res.status(404).json({
            timestamp: Date.now(),
            status: 404,
            error: 'Session not found',
            message: `No session ${sessionId}`,
            path: req.path,
        });
    }

    if (body.resuming !== undefined || body.timeout !== undefined) {
        wsManager.enableResume(sessionId, null, body.timeout || 60000);
        logger.info(`[REST] Session ${sessionId} resume configured timeout=${body.timeout}`);
    }

    res.json({
        resuming: body.resuming || false,
        timeout: body.timeout || 60000,
    });
});

module.exports = router;
