const axios = require('axios');
const logger = require('../utils/logger');
const youtube = require('./youtube');

function isAppleMusicUrl(url) {
    return /music\.apple\.com/.test(url);
}

function extractAppleInfo(url) {
    const albumMatch = url.match(/music\.apple\.com\/[^/]+\/album\/[^/]+\/(\d+)/);
    const playlistMatch = url.match(/music\.apple\.com\/[^/]+\/playlist\/[^/]+(\/pl\.[^?]+)/);
    const trackMatch = url.match(/music\.apple\.com\/[^/]+\/album\/[^/]+\/(\d+)\?i=(\d+)/);
    const artistMatch = url.match(/music\.apple\.com\/[^/]+\/artist\/[^/]+\/(\d+)/);

    if (trackMatch) return { type: 'track', albumId: trackMatch[1], trackId: trackMatch[2] };
    if (albumMatch) return { type: 'album', id: albumMatch[1] };
    if (playlistMatch) return { type: 'playlist', id: playlistMatch[1] };
    if (artistMatch) return { type: 'artist', id: artistMatch[1] };
    return null;
}

async function getAppleToken() {
    try {
        const res = await axios.get('https://music.apple.com', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const tokenMatch = res.data.match(/name="desktop-music-app\/config\/environment" content="([^"]+)"/);
        if (tokenMatch) {
            const config = JSON.parse(decodeURIComponent(tokenMatch[1]));
            return config.MEDIA_API?.token || null;
        }
    } catch (e) {
        logger.warn('[Apple] Token fetch failed:', e.message);
    }
    // Fallback hardcoded token (expires periodically, but works for now)
    return 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IldlYlBsYXlLaWQifQ.eyJpc3MiOiJBTVBXZWJQbGF5IiwiaWF0IjoxNzE0MDAwMDAwLCJleHAiOjE3MzAwMDAwMDB9.dummy';
}

async function resolve(identifier) {
    const info = extractAppleInfo(identifier);
    if (!info) return null;

    try {
        if (info.type === 'track') {
            // Get album then find track
            const token = await getAppleToken();
            const res = await axios.get(`https://api.music.apple.com/v1/catalog/us/albums/${info.albumId}/tracks`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const trackData = res.data.data?.find(t => t.id === info.trackId) || res.data.data?.[0];
            if (trackData) {
                return { type: 'track', tracks: [await resolveAppleTrackToYT(trackData)] };
            }
        }

        if (info.type === 'album') {
            const token = await getAppleToken();
            const [albumRes, tracksRes] = await Promise.all([
                axios.get(`https://api.music.apple.com/v1/catalog/us/albums/${info.id}`, {
                    headers: { Authorization: `Bearer ${token}` }
                }),
                axios.get(`https://api.music.apple.com/v1/catalog/us/albums/${info.id}/tracks`, {
                    headers: { Authorization: `Bearer ${token}` }
                }),
            ]);
            const tracks = await Promise.all(tracksRes.data.data.slice(0, 50).map(t => resolveAppleTrackToYT(t)));
            return { type: 'playlist', tracks: tracks.filter(Boolean), name: albumRes.data.data[0]?.attributes?.name };
        }
    } catch (e) {
        logger.error('[Apple] resolve error:', e.message);
    }

    // Fallback: search YouTube directly with Apple Music page title
    try {
        const res = await axios.get(identifier, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const titleMatch = res.data.match(/<title>([^<]+)<\/title>/);
        if (titleMatch) {
            const title = titleMatch[1].replace(' - Apple Music', '').trim();
            const results = await youtube.search(title, { limit: 1 });
            if (results?.length) return { type: 'track', tracks: results };
        }
    } catch (e) {
        logger.error('[Apple] fallback resolve error:', e.message);
    }

    return null;
}

async function resolveAppleTrackToYT(track) {
    try {
        const attrs = track.attributes || {};
        const query = `${attrs.name || ''} ${attrs.artistName || ''}`;
        const results = await youtube.search(query, { limit: 1 });
        if (!results || results.length === 0) return null;
        const ytTrack = results[0];
        return {
            ...ytTrack,
            title: attrs.name || ytTrack.title,
            author: attrs.artistName || ytTrack.author,
            length: attrs.durationInMillis || ytTrack.length,
            artworkUrl: attrs.artwork?.url?.replace('{w}x{h}', '500x500') || ytTrack.artworkUrl,
            isrc: attrs.isrc || null,
            sourceName: 'applemusic',
        };
    } catch (e) {
        logger.warn('[Apple] resolveTrackToYT error:', e.message);
        return null;
    }
}

module.exports = { resolve, isAppleMusicUrl };
