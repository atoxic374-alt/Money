const router = require('express').Router();
const { loadTracks } = require('../sources');
const { TrackEncoder } = require('../audio/encoder');
const logger = require('../utils/logger');

function sendLavalinkJson(res, payload, status = 200) {
    res.status(status);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
}

// Load tracks by identifier
router.get('/loadtracks', async (req, res) => {
    const identifier = req.query.identifier;
    if (!identifier) {
        return sendLavalinkJson(res, { error: 'Missing identifier query parameter' }, 400);
    }

    try {
        logger.debug(`[REST] loadtracks identifier=${identifier}`);
        const result = await loadTracks(identifier);
        sendLavalinkJson(res, result);
    } catch (e) {
        logger.error('[REST] loadtracks error:', e.message);
        sendLavalinkJson(res, {
            loadType: 'error',
            data: {
                message: e.message,
                severity: 'suspicious',
                cause: e.message,
            }
        });
    }
});

// Decode a single encoded track
router.get('/decodetrack', (req, res) => {
    const encodedTrack = req.query.encodedTrack;
    if (!encodedTrack) {
        return res.status(400).json({ error: 'Missing encodedTrack query parameter' });
    }

    try {
        const decoded = TrackEncoder.decode(encodedTrack);
        res.json(decoded.info);
    } catch (e) {
        logger.error('[REST] decodetrack error:', e.message);
        res.status(400).json({ error: e.message });
    }
});

// Decode multiple encoded tracks
router.post('/decodetracks', (req, res) => {
    const tracks = req.body;
    if (!Array.isArray(tracks)) {
        return res.status(400).json({ error: 'Body must be an array of encoded tracks' });
    }

    try {
        const decoded = tracks.map(encoded => {
            try {
                return TrackEncoder.decode(encoded).info;
            } catch {
                return null;
            }
        }).filter(Boolean);
        res.json(decoded);
    } catch (e) {
        logger.error('[REST] decodetracks error:', e.message);
        res.status(400).json({ error: e.message });
    }
});

module.exports = router;
