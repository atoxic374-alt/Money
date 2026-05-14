/**
 * Apple Music resolver → YouTube
 *
 * Uses the iTunes Search/Lookup API (free, no auth) for metadata
 * then searches YouTube for audio streaming.
 *
 * API: https://itunes.apple.com/lookup?id=TRACK_ID
 *      https://itunes.apple.com/search?term=QUERY&media=music&limit=N
 */
const axios = require('axios');
const logger = require('../utils/logger');
const youtube = require('./youtube');

const cache = new Map();
const CACHE_TTL = 15 * 60 * 1000;

function getCached(k) {
    const h = cache.get(k);
    if (!h || Date.now() - h.ts > CACHE_TTL) { cache.delete(k); return null; }
    return h.data;
}
function setCached(k, d) { cache.set(k, { data: d, ts: Date.now() }); }

function isAppleMusicUrl(url) { return /music\.apple\.com/.test(url); }

function parseUrl(url) {
    // Track: /album/slug/albumId?i=trackId
    const trackMatch = url.match(/music\.apple\.com\/[^/]+\/album\/([^/?]+)\/(\d+)[?&].*i=(\d+)/);
    if (trackMatch) return { type: 'track', slug: trackMatch[1], albumId: trackMatch[2], trackId: trackMatch[3] };

    // Album: /album/name/id
    const albumMatch = url.match(/music\.apple\.com\/[^/]+\/album\/([^/?]+)\/(\d+)/);
    if (albumMatch) return { type: 'album', slug: albumMatch[1], id: albumMatch[2] };

    // Playlist: /playlist/name/pl.xxx
    const playlistMatch = url.match(/music\.apple\.com\/[^/]+\/playlist\/([^/]+)\/(pl\.[^?/]+)/);
    if (playlistMatch) return { type: 'playlist', slug: playlistMatch[1], id: playlistMatch[2] };

    // Artist: /artist/name/id
    const artistMatch = url.match(/music\.apple\.com\/[^/]+\/artist\/([^/?]+)\/(\d+)/);
    if (artistMatch) return { type: 'artist', slug: artistMatch[1], id: artistMatch[2] };

    return null;
}

// ── iTunes API helper ──────────────────────────────────────────────────────────
async function itunesLookup(id) {
    const r = await axios.get(
        `https://itunes.apple.com/lookup?id=${id}`,
        { timeout: 8000, headers: { 'Accept': 'application/json' } }
    );
    return r.data?.results || [];
}

async function itunesSearch(query, limit = 20) {
    const r = await axios.get(
        `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&limit=${limit}`,
        { timeout: 8000, headers: { 'Accept': 'application/json' } }
    );
    return r.data?.results || [];
}

// ── Resolve iTunes track → YouTube ────────────────────────────────────────────
async function resolveTrackMeta(meta) {
    if (!meta) return null;
    const query = `${meta.trackName || ''} ${meta.artistName || ''}`.trim();
    try {
        const results = await youtube.search(query, { limit: 1 });
        if (!results?.length) return null;
        const yt = results[0];
        return {
            ...yt,
            title: meta.trackName || yt.title,
            author: meta.artistName || yt.author,
            length: meta.trackTimeMillis || yt.length,
            artworkUrl: (meta.artworkUrl100 || yt.artworkUrl || '').replace('100x100bb', '500x500bb'),
            isrc: null,
            sourceName: 'applemusic',
        };
    } catch (e) {
        logger.warn(`[Apple] resolveTrack "${query}": ${e.message}`);
        return null;
    }
}

async function resolveBatch(items, concurrency = 3) {
    const results = [];
    for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        const resolved = await Promise.all(batch.map(t => resolveTrackMeta(t)));
        results.push(...resolved.filter(Boolean));
    }
    return results;
}

// ── Slug → human readable text ────────────────────────────────────────────────
function slugToText(slug) {
    return (slug || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Main resolve ───────────────────────────────────────────────────────────────
async function resolve(identifier) {
    const info = parseUrl(identifier);
    if (!info) return null;

    const cacheKey = `am:${identifier}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
        let result = null;

        if (info.type === 'track') {
            // Apple Music IDs ≠ iTunes IDs — use Search API with slug-derived query
            // URL format: /album/ALBUM-SLUG/ALBUM-ID?i=TRACK-ID
            // Album slug contains track name hint, e.g. "after-hours"
            const albumSlug = info.slug || '';
            const query = slugToText(albumSlug);

            // Strategy 1: iTunes Lookup with entity=song on album ID
            let items = [];
            try {
                const raw = await itunesLookup(`${info.albumId}&entity=song`);
                items = raw.filter(i => i.kind === 'song');
            } catch {}

            // Strategy 2: iTunes Search
            if (!items.length && query) {
                try { items = await itunesSearch(query, 5); } catch {}
            }

            if (items.length > 0) {
                // If we have trackId, try to find matching track by position or name
                const track = items[0];
                const resolved = await resolveTrackMeta(track);
                result = resolved ? { type: 'track', tracks: [resolved] } : null;
            }

            // Strategy 3: direct YouTube search from slug
            if (!result && query) {
                const ytResults = await youtube.search(query, { limit: 1 });
                if (ytResults?.length) {
                    result = { type: 'track', tracks: [{ ...ytResults[0], sourceName: 'applemusic' }] };
                }
            }
        }

        else if (info.type === 'album') {
            const items = await itunesLookup(info.id);
            const album = items.find(i => i.wrapperType === 'collection') || items[0];
            const songs = items.filter(i => i.kind === 'song');
            if (songs.length > 0) {
                const tracks = await resolveBatch(songs);
                result = { type: 'playlist', tracks, name: album?.collectionName || slugToText(info.slug) };
            } else {
                // Search by album name
                const query = slugToText(info.slug);
                const searchItems = await itunesSearch(query, 10);
                const tracks = await resolveBatch(searchItems);
                result = tracks.length ? { type: 'playlist', tracks, name: query } : null;
            }
        }

        else if (info.type === 'playlist') {
            // iTunes API doesn't expose Apple Music curated playlists
            // Fall back to searching by playlist name slug
            const query = slugToText(info.slug);
            const items = await itunesSearch(query, 10);
            const tracks = await resolveBatch(items);
            result = tracks.length ? { type: 'playlist', tracks, name: query } : null;
        }

        else if (info.type === 'artist') {
            // iTunes API: lookup artist top songs
            const items = await itunesLookup(info.id);
            const artist = items.find(i => i.wrapperType === 'artist');
            const query = artist?.artistName || slugToText(info.slug);
            const songs = await itunesSearch(query, 10);
            const tracks = await resolveBatch(songs);
            result = tracks.length
                ? { type: 'playlist', tracks, name: `${query} — Top Tracks` }
                : null;
        }

        if (result) setCached(cacheKey, result);
        return result;
    } catch (e) {
        logger.error(`[Apple] resolve error: ${e.message}`);
        return null;
    }
}

module.exports = { resolve, isAppleMusicUrl };
