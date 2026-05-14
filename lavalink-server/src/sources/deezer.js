const axios = require('axios');
const logger = require('../utils/logger');
const youtube = require('./youtube');

const DEEZER_API = 'https://api.deezer.com';

function isDeezerUrl(url) {
    return /deezer\.com/.test(url);
}

function extractDeezerInfo(url) {
    const trackMatch = url.match(/deezer\.com\/.+\/track\/(\d+)/);
    const albumMatch = url.match(/deezer\.com\/.+\/album\/(\d+)/);
    const playlistMatch = url.match(/deezer\.com\/.+\/playlist\/(\d+)/);
    const artistMatch = url.match(/deezer\.com\/.+\/artist\/(\d+)/);

    if (trackMatch) return { type: 'track', id: trackMatch[1] };
    if (albumMatch) return { type: 'album', id: albumMatch[1] };
    if (playlistMatch) return { type: 'playlist', id: playlistMatch[1] };
    if (artistMatch) return { type: 'artist', id: artistMatch[1] };
    return null;
}

async function resolve(identifier) {
    const info = extractDeezerInfo(identifier);
    if (!info) return null;

    try {
        if (info.type === 'track') {
            const res = await axios.get(`${DEEZER_API}/track/${info.id}`);
            return { type: 'track', tracks: [await resolveDeezerTrackToYT(res.data)] };
        }

        if (info.type === 'album') {
            const [albumRes, tracksRes] = await Promise.all([
                axios.get(`${DEEZER_API}/album/${info.id}`),
                axios.get(`${DEEZER_API}/album/${info.id}/tracks?limit=50`),
            ]);
            const tracks = await Promise.all(tracksRes.data.data.map(t => resolveDeezerTrackToYT(t)));
            return { type: 'playlist', tracks: tracks.filter(Boolean), name: albumRes.data.title };
        }

        if (info.type === 'playlist') {
            const res = await axios.get(`${DEEZER_API}/playlist/${info.id}/tracks?limit=100`);
            const tracks = await Promise.all(res.data.data.map(t => resolveDeezerTrackToYT(t)));
            const plRes = await axios.get(`${DEEZER_API}/playlist/${info.id}`);
            return { type: 'playlist', tracks: tracks.filter(Boolean), name: plRes.data.title };
        }

        if (info.type === 'artist') {
            const [artistRes, topRes] = await Promise.all([
                axios.get(`${DEEZER_API}/artist/${info.id}`),
                axios.get(`${DEEZER_API}/artist/${info.id}/top?limit=10`),
            ]);
            const tracks = await Promise.all(topRes.data.data.map(t => resolveDeezerTrackToYT(t)));
            return { type: 'playlist', tracks: tracks.filter(Boolean), name: `${artistRes.data.name} - Top Tracks` };
        }
    } catch (e) {
        logger.error('[Deezer] resolve error:', e.message);
    }
    return null;
}

async function resolveDeezerTrackToYT(track) {
    try {
        const artist = track.artist?.name || '';
        const query = `${track.title} ${artist}`;
        const results = await youtube.search(query, { limit: 1 });
        if (!results || results.length === 0) return null;
        const ytTrack = results[0];
        return {
            ...ytTrack,
            title: track.title || ytTrack.title,
            author: artist || ytTrack.author,
            length: track.duration ? track.duration * 1000 : ytTrack.length,
            artworkUrl: track.album?.cover_xl || track.album?.cover_big || ytTrack.artworkUrl,
            isrc: track.isrc || null,
            sourceName: 'deezer',
        };
    } catch (e) {
        logger.warn('[Deezer] resolveTrackToYT error:', e.message);
        return null;
    }
}

module.exports = { resolve, isDeezerUrl };
