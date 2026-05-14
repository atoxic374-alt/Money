const ytdlp = require('../utils/ytdlp');
const { getRandomUserAgent, getNextYoutubeClient, randomDelay } = require('../utils/antibot');
const logger = require('../utils/logger');

const searchCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function cleanCache() {
    const now = Date.now();
    for (const [key, val] of searchCache) {
        if (now - val.ts > CACHE_TTL) searchCache.delete(key);
    }
}
setInterval(cleanCache, 60000);

function buildArgs(extra = []) {
    const client = getNextYoutubeClient();
    return [
        '--dump-single-json',
        '--no-check-certificates',
        '--no-warnings',
        '--skip-download',
        '--add-header', `user-agent:${client.userAgent}`,
        '--add-header', 'accept-language:en-US,en;q=0.9',
        ...extra,
    ];
}

async function search(query, options = {}) {
    const limit = options.limit || 10;
    const cacheKey = `yt:${query}:${limit}`;

    if (searchCache.has(cacheKey)) {
        const cached = searchCache.get(cacheKey);
        if (Date.now() - cached.ts < CACHE_TTL) return cached.data;
    }

    try {
        const result = await ytdlp(`ytsearch${limit}:${query}`, [
            ...buildArgs(['--flat-playlist']),
        ]);

        const entries = result.entries || (result.id ? [result] : []);
        const tracks = entries.map(e => formatTrack(e));
        searchCache.set(cacheKey, { data: tracks, ts: Date.now() });
        return tracks;
    } catch (e) {
        logger.error('[YouTube] search error:', e.message);
        return [];
    }
}

async function getTrack(identifier) {
    try {
        const result = await ytdlp(identifier, buildArgs(['--skip-download']));

        if (result.entries) {
            return {
                type: 'playlist',
                tracks: result.entries.map(e => formatTrack(e)),
                name: result.title,
            };
        }
        return { type: 'track', tracks: [formatTrack(result)] };
    } catch (e) {
        logger.error('[YouTube] getTrack error:', e.message);
        return null;
    }
}

async function getStreamUrl(identifier) {
    const strategies = [
        [],
        ['--extractor-args', 'youtube:player_client=android'],
        ['--extractor-args', 'youtube:player_client=ios'],
    ];

    for (let i = 0; i < strategies.length; i++) {
        if (i > 0) await randomDelay(500, 1500);
        try {
            const result = await ytdlp(identifier, [
                '--dump-single-json',
                '--no-check-certificates',
                '--no-warnings',
                '--prefer-free-formats',
                '--format-sort', 'acodec:opus,br:128,ext:webm',
                '--add-header', `user-agent:${getNextYoutubeClient().userAgent}`,
                '--add-header', 'accept-language:en-US,en;q=0.9',
                ...strategies[i],
            ]);

            const formats = result.formats || [];
            let best = formats
                .filter(f => f.vcodec === 'none' && f.acodec !== 'none' && f.url)
                .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

            if (!best) {
                best = formats.filter(f => f.url).sort((a, b) => (a.height || 9999) - (b.height || 9999))[0];
            }

            if (best?.url) {
                return { url: best.url, contentType: best.ext || 'webm' };
            }
        } catch (e) {
            logger.warn(`[YouTube] getStreamUrl attempt ${i + 1} failed: ${e.message}`);
        }
    }

    logger.error('[YouTube] All attempts to get stream URL failed');
    return null;
}

function formatTrack(entry) {
    const id = entry.id || entry.url;
    return {
        identifier: id,
        isSeekable: true,
        author: entry.uploader || entry.channel || 'Unknown',
        length: entry.duration ? Math.floor(entry.duration * 1000) : 0,
        isStream: entry.is_live || false,
        position: 0,
        title: entry.title || 'Unknown',
        uri: entry.webpage_url || `https://www.youtube.com/watch?v=${id}`,
        artworkUrl: entry.thumbnail || (entry.thumbnails?.slice(-1)[0]?.url) || null,
        isrc: null,
        sourceName: 'youtube',
    };
}

module.exports = { search, getTrack, getStreamUrl };
