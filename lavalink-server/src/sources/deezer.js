/**
 * Deezer source resolver
 * Uses the public Deezer API (no auth needed for metadata) → resolves to YouTube
 */
const axios = require('axios');
const logger = require('../utils/logger');
const youtube = require('./youtube');

const API = 'https://api.deezer.com';
const cache = new Map();
const CACHE_TTL = 15 * 60 * 1000;

function getCached(k) {
    const h = cache.get(k);
    if (!h) return null;
    if (Date.now() - h.ts > CACHE_TTL) { cache.delete(k); return null; }
    return h.data;
}
function setCached(k, d) { cache.set(k, { data: d, ts: Date.now() }); }

function isDeezerUrl(url) { return /deezer\.com/.test(url); }

function parseUrl(url) {
    const m = url.match(/deezer\.com\/(?:[a-z]+\/)?(track|album|playlist|artist)\/(\d+)/);
    return m ? { type: m[1], id: m[2] } : null;
}

async function deezerGet(path) {
    const r = await axios.get(`${API}${path}`, {
        timeout: 10000,
        headers: { 'Accept': 'application/json' },
    });
    if (r.data.error) throw new Error(`Deezer API error: ${r.data.error.message}`);
    return r.data;
}

async function resolveTrack(track) {
    if (!track) return null;
    const cacheKey = `dz:track:${track.id}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const artist = track.artist?.name || '';
    const query = `${track.title} ${artist}`;
    try {
        const results = await youtube.search(query, { limit: 1 });
        if (!results?.length) return null;
        const yt = results[0];
        const resolved = {
            ...yt,
            title: track.title || yt.title,
            author: artist || yt.author,
            length: track.duration ? track.duration * 1000 : yt.length,
            artworkUrl: track.album?.cover_xl || track.album?.cover_big || yt.artworkUrl,
            isrc: track.isrc || null,
            sourceName: 'deezer',
        };
        setCached(cacheKey, resolved);
        return resolved;
    } catch (e) {
        logger.warn(`[Deezer] resolveTrack failed: ${e.message}`);
        return null;
    }
}

async function resolveBatch(tracks, concurrency = 3) {
    const results = [];
    for (let i = 0; i < tracks.length; i += concurrency) {
        const batch = tracks.slice(i, i + concurrency);
        const resolved = await Promise.all(batch.map(t => resolveTrack(t)));
        results.push(...resolved.filter(Boolean));
    }
    return results;
}

async function resolve(identifier) {
    const info = parseUrl(identifier);
    if (!info) return null;

    const cacheKey = `dz:${info.type}:${info.id}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
        let result;

        if (info.type === 'track') {
            const track = await deezerGet(`/track/${info.id}`);
            const resolved = await resolveTrack(track);
            result = resolved ? { type: 'track', tracks: [resolved] } : null;
        }

        else if (info.type === 'album') {
            const [album, tracksData] = await Promise.all([
                deezerGet(`/album/${info.id}`),
                deezerGet(`/album/${info.id}/tracks?limit=50`),
            ]);
            const tracks = await resolveBatch(tracksData.data.map(t => ({ ...t, album })));
            result = { type: 'playlist', tracks, name: album.title };
        }

        else if (info.type === 'playlist') {
            const pl = await deezerGet(`/playlist/${info.id}`);
            const tracksData = await deezerGet(`/playlist/${info.id}/tracks?limit=100`);
            const tracks = await resolveBatch(tracksData.data);
            result = { type: 'playlist', tracks, name: pl.title };
        }

        else if (info.type === 'artist') {
            const [artist, topData] = await Promise.all([
                deezerGet(`/artist/${info.id}`),
                deezerGet(`/artist/${info.id}/top?limit=10`),
            ]);
            const tracks = await resolveBatch(topData.data);
            result = { type: 'playlist', tracks, name: `${artist.name} — Top Tracks` };
        }

        if (result) setCached(cacheKey, result);
        return result;
    } catch (e) {
        logger.error(`[Deezer] resolve error (${info.type}:${info.id}): ${e.message}`);
        return null;
    }
}

module.exports = { resolve, isDeezerUrl };
