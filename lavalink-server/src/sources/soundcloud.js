/**
 * SoundCloud source — with rate limit protection
 *
 * Anti-ban strategy:
 * - Sleep between requests (SoundCloud rate limits aggressively)
 * - Retry with backoff on 429
 * - Rotate user agents
 */
const ytdlp = require('../utils/ytdlp');
const { getRandomUserAgent } = require('../utils/antibot');
const logger = require('../utils/logger');

const searchCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 min

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of searchCache) if (now - v.ts > CACHE_TTL) searchCache.delete(k);
}, 3 * 60 * 1000);

function baseArgs() {
    return [
        '--dump-single-json',
        '--no-check-certificates',
        '--no-warnings',
        '--skip-download',
        '--add-header', `user-agent:${getRandomUserAgent()}`,
        '--retries', '3',
        '--retry-sleep', 'exp=1:5',
    ];
}

function streamArgs() {
    return [
        '--dump-single-json',
        '--no-check-certificates',
        '--no-warnings',
        '--prefer-free-formats',
        '--format', 'bestaudio/best',
        '--add-header', `user-agent:${getRandomUserAgent()}`,
        '--sleep-requests', '1',
        '--retries', '3',
    ];
}

function isSoundCloudUrl(url) {
    return /soundcloud\.com/.test(url);
}

async function resolve(identifier) {
    // Try direct URL resolution first
    try {
        const result = await ytdlp(identifier, baseArgs(), { retries: 2, timeout: 20000 });
        if (result.entries) {
            return {
                type: 'playlist',
                tracks: result.entries.filter(e => e.id || e.url).map(formatTrack),
                name: result.title || 'SoundCloud Set',
            };
        }
        if (result.id || result.title) {
            return { type: 'track', tracks: [formatTrack(result)] };
        }
    } catch (e) {
        logger.warn(`[SoundCloud] Direct URL failed, trying search fallback: ${e.message.slice(0, 80)}`);
    }

    // Fallback: extract artist/track from URL and search SoundCloud
    try {
        const urlObj = new URL(identifier);
        const parts = urlObj.pathname.replace(/^\//, '').split('/').filter(Boolean);
        if (parts.length >= 2) {
            // e.g. /alanwalker/faded-1 → "alanwalker faded"
            const artistSlug = parts[0].replace(/-/g, ' ');
            const trackSlug  = parts[1].replace(/-\d+$/, '').replace(/-/g, ' ');
            const query = `${artistSlug} ${trackSlug}`.trim();
            logger.info(`[SoundCloud] Searching fallback: "${query}"`);
            const tracks = await search(query, 1);
            if (tracks?.length) return { type: 'track', tracks };
        }
    } catch (e) {
        logger.error(`[SoundCloud] resolve fallback error: ${e.message}`);
    }

    return null;
}

async function search(query, limit = 10) {
    const cacheKey = `sc:${query}:${limit}`;
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

    try {
        const result = await ytdlp(`scsearch${limit}:${query}`, [
            '--dump-single-json',
            '--no-check-certificates',
            '--no-warnings',
            '--flat-playlist',
            '--skip-download',
            '--add-header', `user-agent:${getRandomUserAgent()}`,
            '--sleep-requests', '0.5',
        ], { retries: 2, timeout: 20000 });

        const entries = result.entries || (result.id ? [result] : []);
        const tracks = entries.filter(e => e.id || e.url).map(formatTrack);
        searchCache.set(cacheKey, { data: tracks, ts: Date.now() });
        return tracks;
    } catch (e) {
        logger.error(`[SoundCloud] search error: ${e.message}`);
        return [];
    }
}

async function getStreamUrl(identifier) {
    try {
        const result = await ytdlp(identifier, streamArgs(), { retries: 3, timeout: 25000 });

        const formats = result.formats || [];
        const best = formats
            .filter(f => f.url)
            .sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0))[0];

        if (best?.url) return { url: best.url, contentType: best.ext || 'mp3' };
        if (result.url) return { url: result.url };
    } catch (e) {
        logger.error(`[SoundCloud] getStreamUrl error: ${e.message}`);
    }
    return null;
}

function formatTrack(entry) {
    return {
        identifier: entry.webpage_url || entry.url || entry.id,
        isSeekable: true,
        author: entry.uploader || entry.artist || 'Unknown',
        length: entry.duration ? Math.floor(entry.duration * 1000) : 0,
        isStream: false,
        position: 0,
        title: entry.title || 'Unknown',
        uri: entry.webpage_url || entry.url,
        artworkUrl: entry.thumbnail || null,
        isrc: null,
        sourceName: 'soundcloud',
    };
}

module.exports = { resolve, search, getStreamUrl, isSoundCloudUrl };
