const axios = require('axios');
const logger = require('../utils/logger');
const youtube = require('./youtube');

let spotifyToken = null;
let spotifyTokenExpiry = 0;

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';

async function getToken() {
    if (spotifyToken && Date.now() < spotifyTokenExpiry) return spotifyToken;

    try {
        if (SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET) {
            const res = await axios.post('https://accounts.spotify.com/api/token',
                'grant_type=client_credentials',
                {
                    headers: {
                        'Authorization': `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
                        'Content-Type': 'application/x-www-form-urlencoded',
                    }
                }
            );
            spotifyToken = res.data.access_token;
            spotifyTokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
            return spotifyToken;
        }
    } catch (e) {
        logger.warn('[Spotify] Token fetch failed:', e.message);
    }

    // Fallback: public token
    try {
        const res = await axios.get('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Cookie': 'sp_t=1;',
            }
        });
        spotifyToken = res.data.accessToken;
        spotifyTokenExpiry = res.data.accessTokenExpirationTimestampMs - 5000;
        return spotifyToken;
    } catch (e) {
        logger.error('[Spotify] Fallback token failed:', e.message);
        return null;
    }
}

function extractSpotifyId(url) {
    const patterns = [
        /spotify\.com\/track\/([a-zA-Z0-9]+)/,
        /spotify\.com\/album\/([a-zA-Z0-9]+)/,
        /spotify\.com\/playlist\/([a-zA-Z0-9]+)/,
        /spotify\.com\/artist\/([a-zA-Z0-9]+)/,
        /spotify:track:([a-zA-Z0-9]+)/,
        /spotify:album:([a-zA-Z0-9]+)/,
        /spotify:playlist:([a-zA-Z0-9]+)/,
    ];

    for (const p of patterns) {
        const m = url.match(p);
        if (m) return { id: m[1], type: url.includes('/track/') || url.includes(':track:') ? 'track'
            : url.includes('/album/') || url.includes(':album:') ? 'album'
            : url.includes('/playlist/') || url.includes(':playlist:') ? 'playlist'
            : 'artist' };
    }
    return null;
}

async function resolve(identifier) {
    const info = extractSpotifyId(identifier);
    if (!info) return null;

    const token = await getToken();
    if (!token) return null;

    try {
        const headers = { Authorization: `Bearer ${token}` };

        if (info.type === 'track') {
            const res = await axios.get(`https://api.spotify.com/v1/tracks/${info.id}`, { headers });
            const track = res.data;
            return {
                type: 'track',
                tracks: [await resolveSpotifyTrackToYT(track)],
            };
        }

        if (info.type === 'album') {
            const res = await axios.get(`https://api.spotify.com/v1/albums/${info.id}/tracks?limit=50`, { headers });
            const albumRes = await axios.get(`https://api.spotify.com/v1/albums/${info.id}`, { headers });
            const tracks = await Promise.all(
                res.data.items.slice(0, 50).map(t => resolveSpotifyTrackToYT({
                    ...t,
                    album: albumRes.data,
                    external_urls: t.external_urls,
                }))
            );
            return { type: 'playlist', tracks: tracks.filter(Boolean), name: albumRes.data.name };
        }

        if (info.type === 'playlist') {
            const res = await axios.get(`https://api.spotify.com/v1/playlists/${info.id}`, { headers });
            const items = res.data.tracks.items;

            let allItems = items;
            let nextUrl = res.data.tracks.next;
            while (nextUrl && allItems.length < 100) {
                const nextRes = await axios.get(nextUrl, { headers });
                allItems = allItems.concat(nextRes.data.items);
                nextUrl = nextRes.data.next;
            }

            const tracks = await Promise.all(
                allItems.slice(0, 100)
                    .filter(i => i.track)
                    .map(i => resolveSpotifyTrackToYT(i.track))
            );
            return { type: 'playlist', tracks: tracks.filter(Boolean), name: res.data.name };
        }

        if (info.type === 'artist') {
            const res = await axios.get(`https://api.spotify.com/v1/artists/${info.id}/top-tracks?market=US`, { headers });
            const tracks = await Promise.all(res.data.tracks.slice(0, 10).map(t => resolveSpotifyTrackToYT(t)));
            const artistRes = await axios.get(`https://api.spotify.com/v1/artists/${info.id}`, { headers });
            return { type: 'playlist', tracks: tracks.filter(Boolean), name: `${artistRes.data.name} - Top Tracks` };
        }
    } catch (e) {
        logger.error('[Spotify] resolve error:', e.message);
    }
    return null;
}

async function resolveSpotifyTrackToYT(track) {
    try {
        const artists = (track.artists || []).map(a => a.name).join(', ');
        const query = `${track.name} ${artists}`;
        const results = await youtube.search(query, { limit: 1 });

        if (!results || results.length === 0) return null;

        const ytTrack = results[0];
        return {
            ...ytTrack,
            title: track.name || ytTrack.title,
            author: artists || ytTrack.author,
            length: track.duration_ms || ytTrack.length,
            artworkUrl: track.album?.images?.[0]?.url || ytTrack.artworkUrl,
            isrc: track.external_ids?.isrc || null,
            sourceName: 'spotify',
        };
    } catch (e) {
        logger.warn('[Spotify] resolveTrackToYT error:', e.message);
        return null;
    }
}

module.exports = { resolve, extractSpotifyId };
