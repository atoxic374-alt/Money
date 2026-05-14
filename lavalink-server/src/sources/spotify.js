/**
 * Spotify source resolver
 *
 * Token-free strategy (no API credentials required):
 * 1. oEmbed API → get track title/artist for YouTube search
 * 2. Page scraping → extract JSON-LD metadata
 * 3. URL path parsing → best-effort title extraction
 *
 * If SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET are set, the full API is used
 * (enables albums, playlists, artists with full metadata).
 */
const axios = require('axios');
const logger = require('../utils/logger');
const youtube = require('./youtube');

// ── Token management (optional — only for full API access) ────────────────────
let _token = null;
let _tokenExpiry = 0;

async function getToken() {
    if (_token && Date.now() < _tokenExpiry) return _token;

    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    try {
        const r = await axios.post(
            'https://accounts.spotify.com/api/token',
            'grant_type=client_credentials',
            {
                headers: {
                    Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                timeout: 8000,
            }
        );
        _token = r.data.access_token;
        _tokenExpiry = Date.now() + (r.data.expires_in - 60) * 1000;
        logger.debug('[Spotify] Token via client credentials');
        return _token;
    } catch (e) {
        logger.warn('[Spotify] Client credentials failed:', e.message);
        return null;
    }
}

// ── Cache ──────────────────────────────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 15 * 60 * 1000;

function getCached(k) {
    const h = cache.get(k);
    if (!h || Date.now() - h.ts > CACHE_TTL) { cache.delete(k); return null; }
    return h.data;
}
function setCached(k, d) {
    cache.set(k, { data: d, ts: Date.now() });
    if (cache.size > 1000) cache.delete(cache.keys().next().value);
}

// ── URL parsing ────────────────────────────────────────────────────────────────
function parseSpotifyUrl(url) {
    const patterns = [
        { re: /spotify\.com\/track\/([A-Za-z0-9]+)/, type: 'track' },
        { re: /spotify\.com\/album\/([A-Za-z0-9]+)/, type: 'album' },
        { re: /spotify\.com\/playlist\/([A-Za-z0-9]+)/, type: 'playlist' },
        { re: /spotify\.com\/artist\/([A-Za-z0-9]+)/, type: 'artist' },
        { re: /spotify:track:([A-Za-z0-9]+)/, type: 'track' },
        { re: /spotify:album:([A-Za-z0-9]+)/, type: 'album' },
        { re: /spotify:playlist:([A-Za-z0-9]+)/, type: 'playlist' },
    ];
    for (const { re, type } of patterns) {
        const m = url.match(re);
        if (m) return { id: m[1], type };
    }
    return null;
}

// ── oEmbed metadata (no token needed) ─────────────────────────────────────────
async function getOembedMeta(spotifyUrl) {
    try {
        const r = await axios.get(
            `https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`,
            {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bot)' },
                timeout: 8000,
            }
        );
        return r.data; // { title, author_name, thumbnail_url, ... }
    } catch (e) {
        logger.debug(`[Spotify] oEmbed failed: ${e.message}`);
        return null;
    }
}

// ── Page scraping for JSON-LD metadata ────────────────────────────────────────
async function getPageMeta(spotifyUrl) {
    try {
        const r = await axios.get(spotifyUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
                Accept: 'text/html',
            },
            timeout: 10000,
        });

        // Try JSON-LD
        const ldMatch = r.data.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
        if (ldMatch) {
            try {
                const ld = JSON.parse(ldMatch[1]);
                return { title: ld.name, author: ld.byArtist?.name || ld.creator?.name };
            } catch {}
        }

        // Try og:title
        const ogTitle = r.data.match(/<meta property="og:title" content="([^"]+)"/);
        if (ogTitle) {
            const parts = ogTitle[1].split(' · ');
            return { title: parts[0], author: parts[1] };
        }

        // Try <title>
        const titleMatch = r.data.match(/<title>([^<]+)<\/title>/);
        if (titleMatch) {
            const clean = titleMatch[1].replace(' | Spotify', '').trim();
            return { title: clean, author: '' };
        }
    } catch (e) {
        logger.debug(`[Spotify] Page scrape failed: ${e.message}`);
    }
    return null;
}

// ── Resolve single track → YouTube ────────────────────────────────────────────
async function resolveTrackByMeta(title, artist, durationMs, artworkUrl, id) {
    const cacheKey = `sp:t:${id || title}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const query = `${title} ${artist}`.trim();
    try {
        const results = await youtube.search(query, { limit: 1 });
        if (!results?.length) return null;
        const yt = results[0];
        const resolved = {
            ...yt,
            title: title || yt.title,
            author: artist || yt.author,
            length: durationMs || yt.length,
            artworkUrl: artworkUrl || yt.artworkUrl,
            sourceName: 'spotify',
        };
        setCached(cacheKey, resolved);
        return resolved;
    } catch (e) {
        logger.warn(`[Spotify] resolveTrack "${query}": ${e.message}`);
        return null;
    }
}

// ── Full API track (when token available) ─────────────────────────────────────
async function resolveWithApi(info) {
    const token = await getToken();
    if (!token) return null;

    try {
        const headers = { Authorization: `Bearer ${token}` };

        if (info.type === 'track') {
            const r = await axios.get(`https://api.spotify.com/v1/tracks/${info.id}`, { headers, timeout: 10000 });
            const t = r.data;
            const artists = (t.artists || []).map(a => a.name).join(', ');
            const track = await resolveTrackByMeta(t.name, artists, t.duration_ms, t.album?.images?.[0]?.url, t.id);
            return track ? { type: 'track', tracks: [track] } : null;
        }

        if (info.type === 'album') {
            const [albumR, tracksR] = await Promise.all([
                axios.get(`https://api.spotify.com/v1/albums/${info.id}`, { headers, timeout: 10000 }),
                axios.get(`https://api.spotify.com/v1/albums/${info.id}/tracks?limit=50`, { headers, timeout: 10000 }),
            ]);
            const album = albumR.data;
            const tracks = await resolveBatch(tracksR.data.items.map(t => ({
                title: t.name,
                artist: (t.artists || []).map(a => a.name).join(', '),
                durationMs: t.duration_ms,
                artworkUrl: album.images?.[0]?.url,
                id: t.id,
            })));
            return { type: 'playlist', tracks, name: album.name };
        }

        if (info.type === 'playlist') {
            const plR = await axios.get(`https://api.spotify.com/v1/playlists/${info.id}`, { headers, timeout: 10000 });
            const pl = plR.data;
            let items = pl.tracks.items.filter(i => i.track).map(i => i.track);
            const tracks = await resolveBatch(items.slice(0, 100).map(t => ({
                title: t.name,
                artist: (t.artists || []).map(a => a.name).join(', '),
                durationMs: t.duration_ms,
                artworkUrl: t.album?.images?.[0]?.url,
                id: t.id,
            })));
            return { type: 'playlist', tracks, name: pl.name };
        }

        if (info.type === 'artist') {
            const [artistR, topR] = await Promise.all([
                axios.get(`https://api.spotify.com/v1/artists/${info.id}`, { headers, timeout: 10000 }),
                axios.get(`https://api.spotify.com/v1/artists/${info.id}/top-tracks?market=US`, { headers, timeout: 10000 }),
            ]);
            const tracks = await resolveBatch(topR.data.tracks.slice(0, 10).map(t => ({
                title: t.name,
                artist: (t.artists || []).map(a => a.name).join(', '),
                durationMs: t.duration_ms,
                artworkUrl: t.album?.images?.[0]?.url,
                id: t.id,
            })));
            return { type: 'playlist', tracks, name: `${artistR.data.name} — Top Tracks` };
        }
    } catch (e) {
        logger.warn(`[Spotify] API resolve error: ${e.message}`);
    }
    return null;
}

async function resolveBatch(items, concurrency = 3) {
    const results = [];
    for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        const resolved = await Promise.all(
            batch.map(({ title, artist, durationMs, artworkUrl, id }) =>
                resolveTrackByMeta(title, artist, durationMs, artworkUrl, id)
            )
        );
        results.push(...resolved.filter(Boolean));
    }
    return results;
}

// ── Main resolve ───────────────────────────────────────────────────────────────
async function resolve(identifier) {
    const info = parseSpotifyUrl(identifier);
    if (!info) return null;

    const cacheKey = `sp:${info.type}:${info.id}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    // Try full API first (requires credentials)
    const apiResult = await resolveWithApi(info);
    if (apiResult) { setCached(cacheKey, apiResult); return apiResult; }

    // For single tracks: use oEmbed (no token needed)
    if (info.type === 'track') {
        const embed = await getOembedMeta(identifier);
        if (embed?.title) {
            // oEmbed title format: "Song Name - artist1, artist2"  OR  "Song Name by artist"
            let title = embed.title;
            let artist = embed.author_name || '';

            // Parse "Title - Artist" pattern
            const dashIdx = title.lastIndexOf(' - ');
            if (dashIdx > 0) {
                artist = title.slice(dashIdx + 3);
                title = title.slice(0, dashIdx);
            }

            const track = await resolveTrackByMeta(title, artist, 0, embed.thumbnail_url, info.id);
            const result = track ? { type: 'track', tracks: [track] } : null;
            if (result) setCached(cacheKey, result);
            return result;
        }

        // Page scrape fallback
        const meta = await getPageMeta(identifier);
        if (meta?.title) {
            const track = await resolveTrackByMeta(meta.title, meta.author || '', 0, null, info.id);
            const result = track ? { type: 'track', tracks: [track] } : null;
            if (result) setCached(cacheKey, result);
            return result;
        }
    }

    // For playlists/albums/artists without API credentials: try page scraping
    if (['playlist', 'album'].includes(info.type)) {
        const meta = await getPageMeta(identifier);
        if (meta?.title) {
            // Search YouTube for the playlist name as a fallback
            const results = await youtube.search(meta.title, { limit: 5 });
            if (results?.length) {
                const result = { type: 'playlist', tracks: results, name: meta.title };
                setCached(cacheKey, result);
                return result;
            }
        }
    }

    logger.warn(`[Spotify] Could not resolve ${info.type}:${info.id}`);
    return null;
}

module.exports = { resolve, parseSpotifyUrl };
