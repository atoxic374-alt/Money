/**
 * YouTube source — 2025/2026 anti-ban best practices
 *
 * Strategy:
 * 1. Search:  Use yt-dlp with flat-playlist (fastest, no format fetching)
 * 2. Stream:  Try iOS client first (no PO token), fallback to mweb → web → android
 * 3. Format:  bestaudio[acodec=opus] → bestaudio[ext=webm] → bestaudio → HLS stream
 * 4. Quality: HLS streams are 128kbps AAC (good), WebM/Opus up to 160kbps (best)
 */
const ytdlp = require('../utils/ytdlp');
const { getYoutubeClientByAttempt, PLATFORM_CONFIGS, getRandomUserAgent } = require('../utils/antibot');
const logger = require('../utils/logger');

const cfg = PLATFORM_CONFIGS.youtube;

// ── Cache ──────────────────────────────────────────────────────────────────────
const cache = {
    search: new Map(),   // query → { data, ts }
    stream: new Map(),   // identifier → { url, ts }
    TTL: { search: 5 * 60 * 1000, stream: 4 * 60 * 1000 }, // stream URLs expire fast

    getSearch(key) { return this._get('search', key); },
    setSearch(key, val) { this._set('search', key, val, this.TTL.search); },
    getStream(key) { return this._get('stream', key); },
    setStream(key, val) { this._set('stream', key, val, this.TTL.stream); },

    _get(store, key) {
        const hit = this[store].get(key);
        if (!hit) return null;
        if (Date.now() - hit.ts > this.TTL[store]) { this[store].delete(key); return null; }
        return hit.data;
    },
    _set(store, key, data, ttl) {
        this[store].set(key, { data, ts: Date.now() });
        // Keep map bounded
        if (this[store].size > 500) {
            const firstKey = this[store].keys().next().value;
            this[store].delete(firstKey);
        }
    },
};

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of cache.search) if (now - v.ts > cache.TTL.search) cache.search.delete(k);
    for (const [k, v] of cache.stream) if (now - v.ts > cache.TTL.stream) cache.stream.delete(k);
}, 2 * 60 * 1000);

// ── Base yt-dlp args ───────────────────────────────────────────────────────────
function baseArgs(extra = []) {
    return [
        '--dump-single-json',
        '--no-check-certificates',
        '--no-warnings',
        '--add-header', `user-agent:${getRandomUserAgent()}`,
        '--add-header', 'accept-language:en-US,en;q=0.9',
        ...extra,
    ];
}

function clientArgs(attempt) {
    const client = getYoutubeClientByAttempt(attempt);
    return [
        '--extractor-args', client.extractorArgs,
        '--add-header', `user-agent:${client.userAgent}`,
    ];
}

// ── Search ─────────────────────────────────────────────────────────────────────
async function search(query, options = {}) {
    const limit = Math.min(options.limit || 10, 20);
    const cacheKey = `${query}::${limit}`;
    const cached = cache.getSearch(cacheKey);
    if (cached) { logger.debug(`[YouTube] Cache hit: search "${query}"`); return cached; }

    try {
        const result = await ytdlp(`ytsearch${limit}:${query}`, [
            '--dump-single-json',
            '--no-check-certificates',
            '--no-warnings',
            '--flat-playlist',
            '--skip-download',
            '--add-header', `user-agent:${getRandomUserAgent()}`,
            '--add-header', 'accept-language:en-US,en;q=0.9',
        ], { retries: 2, timeout: 25000 });

        const entries = result.entries || (result.id ? [result] : []);
        const tracks = entries.filter(e => e.id).map(e => formatTrack(e));
        cache.setSearch(cacheKey, tracks);
        return tracks;
    } catch (e) {
        logger.error(`[YouTube] Search failed "${query}": ${e.message}`);
        return [];
    }
}

// ── Load Track / Playlist ──────────────────────────────────────────────────────
async function getTrack(identifier) {
    try {
        const result = await ytdlp(identifier, [
            '--dump-single-json',
            '--no-check-certificates',
            '--no-warnings',
            '--skip-download',
            '--flat-playlist',
            '--add-header', `user-agent:${getRandomUserAgent()}`,
        ], { retries: 2 });

        if (result.entries) {
            return {
                type: 'playlist',
                tracks: result.entries.filter(e => e.id).map(e => formatTrack(e)),
                name: result.title || 'YouTube Playlist',
            };
        }
        return { type: 'track', tracks: [formatTrack(result)] };
    } catch (e) {
        logger.error(`[YouTube] getTrack error: ${e.message}`);
        return null;
    }
}

// ── Get Stream URL ─────────────────────────────────────────────────────────────
// Tries multiple clients in priority order to get a working audio stream URL.
// iOS client is first as it requires no PO token and gives reliable m4a streams.
async function getStreamUrl(identifier) {
    const cached = cache.getStream(identifier);
    if (cached) { logger.debug(`[YouTube] Cache hit: stream ${identifier}`); return cached; }

    // Strategy order: ios → tv_simply_embedded → mweb → web → android
    const strategies = [
        {
            label: 'ios',
            args: [
                '--dump-single-json',
                '--no-check-certificates',
                '--no-warnings',
                '--extractor-args', 'youtube:player_client=ios',
                '--format', 'bestaudio[acodec=mp4a.40.2]/bestaudio/best',
                '--add-header', `user-agent:com.google.ios.youtube/19.45.4 (iPhone14,3; U; CPU iOS 17_5_1 like Mac OS X)`,
            ],
        },
        {
            label: 'mweb',
            args: [
                '--dump-single-json',
                '--no-check-certificates',
                '--no-warnings',
                '--extractor-args', 'youtube:player_client=mweb',
                '--format', 'bestaudio/best',
                '--add-header', `user-agent:Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Mobile Safari/537.36`,
            ],
        },
        {
            label: 'web',
            args: [
                '--dump-single-json',
                '--no-check-certificates',
                '--no-warnings',
                '--format', 'bestaudio[acodec=opus]/bestaudio[ext=webm]/bestaudio/best',
                '--add-header', `user-agent:${getRandomUserAgent()}`,
            ],
        },
    ];

    for (let i = 0; i < strategies.length; i++) {
        const strat = strategies[i];
        try {
            logger.debug(`[YouTube] Stream attempt: ${strat.label} | ${identifier}`);
            const result = await ytdlp(identifier, strat.args, { retries: 1, timeout: 20000, noRateLimit: i > 0 });

            // Result can be full metadata with formats or just format info
            const url = extractBestAudioUrl(result);
            if (url) {
                const streamData = {
                    url,
                    contentType: url.includes('.m4a') ? 'm4a' : url.includes('.webm') ? 'webm' : 'mp4',
                    isHLS: url.includes('manifest') || url.includes('.m3u8'),
                    client: strat.label,
                };
                cache.setStream(identifier, streamData);
                logger.debug(`[YouTube] Stream OK via ${strat.label}: ${identifier}`);
                return streamData;
            }
        } catch (e) {
            logger.warn(`[YouTube] Stream ${strat.label} failed (${i + 1}/${strategies.length}): ${e.message.slice(0, 80)}`);
        }
    }

    logger.error(`[YouTube] All stream strategies failed for: ${identifier}`);
    return null;
}

function extractBestAudioUrl(result) {
    if (!result || typeof result !== 'object') return null;

    const formats = result.formats || [];

    // Prefer audio-only formats
    const audioOnly = formats
        .filter(f => f.vcodec === 'none' && f.acodec !== 'none' && f.url)
        .sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0));

    if (audioOnly.length > 0) return audioOnly[0].url;

    // Fallback: any format with URL (includes HLS manifests)
    const anyFmt = formats.filter(f => f.url).sort((a, b) => (b.abr || 0) - (a.abr || 0));
    if (anyFmt.length > 0) return anyFmt[0].url;

    // Direct URL (HLS manifest directly in result)
    if (result.url) return result.url;

    return null;
}

// ── Format Track ───────────────────────────────────────────────────────────────
function formatTrack(entry) {
    const id = entry.id;
    const thumbnail = entry.thumbnail
        || (Array.isArray(entry.thumbnails) ? entry.thumbnails.slice(-1)[0]?.url : null)
        || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

    return {
        identifier: id,
        isSeekable: !(entry.is_live || false),
        author: entry.uploader || entry.channel || entry.artist || 'Unknown',
        length: entry.duration ? Math.floor(entry.duration * 1000) : 0,
        isStream: entry.is_live || false,
        position: 0,
        title: entry.title || 'Unknown',
        uri: entry.webpage_url || `https://www.youtube.com/watch?v=${id}`,
        artworkUrl: thumbnail,
        isrc: null,
        sourceName: 'youtube',
    };
}

module.exports = { search, getTrack, getStreamUrl };
