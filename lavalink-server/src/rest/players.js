const router = require('express').Router({ mergeParams: true });
const { TrackEncoder } = require('../audio/encoder');
const logger = require('../utils/logger');

// GET all players in a session
router.get('/', (req, res) => {
    const { sessionId } = req.params;
    const playerManager = req.app.get('playerManager');
    const players = playerManager.getBySession(sessionId);
    res.json(players.map(p => p.toJSON()));
});

// GET specific player
router.get('/:guildId', (req, res) => {
    const { sessionId, guildId } = req.params;
    const playerManager = req.app.get('playerManager');
    const player = playerManager.get(guildId);

    if (!player || player.sessionId !== sessionId) {
        return res.status(404).json({ timestamp: Date.now(), status: 404, error: 'Player not found', message: `No player for guild ${guildId}`, path: req.path });
    }

    res.json(player.toJSON());
});

// PATCH - Update player (main control endpoint)
router.patch('/:guildId', async (req, res) => {
    const { sessionId, guildId } = req.params;
    const playerManager = req.app.get('playerManager');
    const wsManager = req.app.get('wsManager');
    const session = wsManager.getSession(sessionId);

    if (!session) {
        return res.status(404).json({ timestamp: Date.now(), status: 404, error: 'Session not found', message: `No session ${sessionId}`, path: req.path });
    }

    const noReplace = req.query.noReplace === 'true';
    const body = req.body;

    let player = playerManager.get(guildId);
    if (!player) {
        player = playerManager.getOrCreate(guildId, sessionId, session.userId);
    }

    // Update voice state
    if (body.voice) {
        player.updateVoice(body.voice);
    }

    // Update volume
    if (body.volume !== undefined) {
        player.setVolume(body.volume);
    }

    // Update paused state
    if (body.paused !== undefined && player.track) {
        player.pause(body.paused);
    }

    // Update filters
    if (body.filters) {
        player.setFilters(body.filters);
        if (body.filters.volume !== undefined) {
            player.setVolume(Math.round(body.filters.volume * 100));
        }
    }

    // Play a track
    if (body.track !== undefined) {
        if (body.track === null || body.track.encoded === null) {
            // Stop current track
            player.stopTrack();
        } else if (body.track.encoded || body.track.identifier) {
            // Don't replace if noReplace and already playing
            if (noReplace && player.track) {
                return res.json(player.toJSON());
            }

            let trackInfo;
            if (body.track.encoded) {
                try {
                    const decoded = TrackEncoder.decode(body.track.encoded);
                    trackInfo = decoded;
                } catch (e) {
                    logger.error('[REST] Decode track error:', e.message);
                    return res.status(400).json({ error: 'Invalid encoded track' });
                }
            } else if (body.track.identifier) {
                const { loadTracks } = require('../sources');
                const result = await loadTracks(body.track.identifier);
                if (result.loadType === 'track' || result.loadType === 'search') {
                    const t = result.loadType === 'track' ? result.data : result.data[0];
                    trackInfo = { encoded: t.encoded, info: t.info };
                } else {
                    return res.status(400).json({ error: 'Could not load track' });
                }
            }

            if (trackInfo) {
                await player.playTrack(
                    { encoded: trackInfo.encoded, info: trackInfo.info, userData: body.track.userData || {} },
                    {
                        startTime: body.track.startTime || body.startTime,
                        endTime: body.track.endTime || body.endTime,
                        volume: body.volume,
                        paused: body.paused,
                    }
                );
            }
        }
    }

    // Handle position seek via position field
    if (body.position !== undefined && player.track) {
        await player.seek(body.position);
    }

    res.json(player.toJSON());
});

// DELETE player
router.delete('/:guildId', (req, res) => {
    const { sessionId, guildId } = req.params;
    const playerManager = req.app.get('playerManager');
    const player = playerManager.get(guildId);

    if (!player || player.sessionId !== sessionId) {
        return res.status(404).json({ timestamp: Date.now(), status: 404, error: 'Player not found', message: `No player for guild ${guildId}`, path: req.path });
    }

    playerManager.destroy(guildId);
    res.status(204).end();
});

module.exports = router;
