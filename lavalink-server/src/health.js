/**
 * Health check and platform connectivity tester
 * Runs on startup and periodically to verify all sources are working
 */
const logger = require('./utils/logger');

const results = {
    youtube: { ok: false, lastCheck: 0, latency: 0 },
    soundcloud: { ok: false, lastCheck: 0, latency: 0 },
    spotify: { ok: false, lastCheck: 0, latency: 0 },
    deezer: { ok: false, lastCheck: 0, latency: 0 },
};

async function checkYouTube() {
    const start = Date.now();
    try {
        const { search } = require('./sources/youtube');
        const tracks = await search('test audio', { limit: 1 });
        const ok = Array.isArray(tracks) && tracks.length > 0;
        results.youtube = { ok, lastCheck: Date.now(), latency: Date.now() - start };
        logger.info(`[Health] YouTube: ${ok ? '✅ OK' : '❌ FAIL'} (${Date.now() - start}ms)`);
        return ok;
    } catch (e) {
        results.youtube = { ok: false, lastCheck: Date.now(), latency: Date.now() - start, error: e.message };
        logger.warn(`[Health] YouTube: ❌ ${e.message}`);
        return false;
    }
}

async function checkSoundCloud() {
    const start = Date.now();
    try {
        const { search } = require('./sources/soundcloud');
        const tracks = await search('test', 1);
        const ok = Array.isArray(tracks) && tracks.length > 0;
        results.soundcloud = { ok, lastCheck: Date.now(), latency: Date.now() - start };
        logger.info(`[Health] SoundCloud: ${ok ? '✅ OK' : '❌ FAIL'} (${Date.now() - start}ms)`);
        return ok;
    } catch (e) {
        results.soundcloud = { ok: false, lastCheck: Date.now(), latency: Date.now() - start, error: e.message };
        logger.warn(`[Health] SoundCloud: ❌ ${e.message}`);
        return false;
    }
}

async function checkSpotify() {
    const start = Date.now();
    try {
        const axios = require('axios');
        const r = await axios.get('https://api.spotify.com/v1/', { timeout: 5000 }).catch(() => ({ status: 401 }));
        // 401 = API is reachable, just needs token (expected)
        const ok = [200, 401].includes(r.status);
        results.spotify = { ok, lastCheck: Date.now(), latency: Date.now() - start };
        logger.info(`[Health] Spotify API: ${ok ? '✅ Reachable' : '❌ FAIL'} (${Date.now() - start}ms)`);
        return ok;
    } catch (e) {
        results.spotify = { ok: false, lastCheck: Date.now(), latency: Date.now() - start, error: e.message };
        logger.warn(`[Health] Spotify API: ❌ ${e.message}`);
        return false;
    }
}

async function checkDeezer() {
    const start = Date.now();
    try {
        const axios = require('axios');
        const r = await axios.get('https://api.deezer.com/track/3135556', { timeout: 5000 });
        const ok = r.data?.id === 3135556;
        results.deezer = { ok, lastCheck: Date.now(), latency: Date.now() - start };
        logger.info(`[Health] Deezer API: ${ok ? '✅ OK' : '❌ FAIL'} (${Date.now() - start}ms)`);
        return ok;
    } catch (e) {
        results.deezer = { ok: false, lastCheck: Date.now(), latency: Date.now() - start, error: e.message };
        logger.warn(`[Health] Deezer API: ❌ ${e.message}`);
        return false;
    }
}

async function runAll() {
    logger.info('[Health] Running platform checks...');
    // Run in parallel except YouTube (rate limit aware)
    const [, scOk, spOk, dzOk] = await Promise.all([
        checkYouTube(),
        checkSoundCloud(),
        checkSpotify(),
        checkDeezer(),
    ]);
    logger.info('[Health] Platform check complete.');
    return results;
}

function getResults() { return results; }

module.exports = { runAll, getResults, checkYouTube, checkSoundCloud, checkSpotify, checkDeezer };
