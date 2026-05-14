const youtube = require('./youtube');
const spotify = require('./spotify');
const soundcloud = require('./soundcloud');
const deezer = require('./deezer');
const apple = require('./apple');
const http = require('./http');
const logger = require('../utils/logger');

async function loadTracks(identifier) {
    // 1. Detect search prefixes (ytsearch:, ytsearch5:, scsearch:, scsearch3:, etc.)
    const searchMatch = identifier.match(/^(ytsearch|ytmsearch|scsearch|spsearch)(\d*):(.+)$/);
    if (searchMatch) {
        const prefix = searchMatch[1];
        const limit = parseInt(searchMatch[2]) || 10;
        const query = searchMatch[3];
        const sourceMap = { ytsearch: 'youtube', ytmsearch: 'youtube', scsearch: 'soundcloud', spsearch: 'spotify' };
        return await searchSource(sourceMap[prefix] || 'youtube', query, limit);
    }

    // 2. Detect URL type
    if (isUrl(identifier)) {
        return await loadUrl(identifier);
    }

    // 3. Default: YouTube search
    return await searchSource('youtube', identifier, 10);
}

async function searchSource(source, query, limit = 10) {
    try {
        let tracks = [];

        switch (source) {
            case 'youtube':
                tracks = await youtube.search(query, { limit });
                break;
            case 'soundcloud':
                tracks = await soundcloud.search(query, limit);
                break;
            default:
                tracks = await youtube.search(query, { limit });
        }

        if (!tracks || tracks.length === 0) {
            return { loadType: 'empty', data: {} };
        }

        return {
            loadType: 'search',
            data: tracks.map(t => buildTrackObject(t)),
        };
    } catch (e) {
        logger.error('[Sources] searchSource error:', e.message);
        return { loadType: 'error', data: { message: e.message, severity: 'suspicious', cause: e.message } };
    }
}

async function loadUrl(identifier) {
    try {
        // Spotify
        if (/spotify\.com|spotify:/.test(identifier)) {
            const result = await spotify.resolve(identifier);
            return formatResult(result);
        }

        // Deezer
        if (/deezer\.com/.test(identifier)) {
            const result = await deezer.resolve(identifier);
            return formatResult(result);
        }

        // Apple Music
        if (/music\.apple\.com/.test(identifier)) {
            const result = await apple.resolve(identifier);
            return formatResult(result);
        }

        // SoundCloud
        if (/soundcloud\.com/.test(identifier)) {
            const result = await soundcloud.resolve(identifier);
            return formatResult(result);
        }

        // YouTube
        if (/youtube\.com|youtu\.be/.test(identifier)) {
            const result = await youtube.getTrack(identifier);
            return formatResult(result);
        }

        // Direct HTTP/HTTPS stream
        if (http.isHttpUrl(identifier)) {
            const result = await http.resolve(identifier);
            return formatResult(result);
        }

        return { loadType: 'empty', data: {} };
    } catch (e) {
        logger.error('[Sources] loadUrl error:', e.message);
        return { loadType: 'error', data: { message: e.message, severity: 'suspicious', cause: e.message } };
    }
}

function formatResult(result) {
    if (!result) return { loadType: 'empty', data: {} };

    if (result.type === 'track') {
        if (!result.tracks || result.tracks.length === 0) return { loadType: 'empty', data: {} };
        return {
            loadType: 'track',
            data: buildTrackObject(result.tracks[0]),
        };
    }

    if (result.type === 'playlist') {
        return {
            loadType: 'playlist',
            data: {
                info: {
                    name: result.name || 'Playlist',
                    selectedTrack: 0,
                },
                pluginInfo: {},
                tracks: (result.tracks || []).filter(Boolean).map(t => buildTrackObject(t)),
            }
        };
    }

    return { loadType: 'empty', data: {} };
}

function buildTrackObject(info) {
    const { TrackEncoder } = require('../audio/encoder');
    const encoded = TrackEncoder.encode(info);
    return {
        encoded,
        info: {
            identifier: info.identifier,
            isSeekable: info.isSeekable !== false,
            author: info.author || 'Unknown',
            length: info.length || 0,
            isStream: info.isStream || false,
            position: info.position || 0,
            title: info.title || 'Unknown',
            uri: info.uri || null,
            artworkUrl: info.artworkUrl || null,
            isrc: info.isrc || null,
            sourceName: info.sourceName || 'unknown',
        },
        pluginInfo: {},
        userData: {},
    };
}

async function getStreamUrl(info) {
    const { sourceName, identifier, uri } = info;

    try {
        switch (sourceName) {
            case 'youtube':
                return await youtube.getStreamUrl(identifier);

            case 'soundcloud':
                return await soundcloud.getStreamUrl(uri || identifier);

            case 'spotify':
            case 'deezer':
            case 'applemusic':
                // These are resolved to YouTube, so use YouTube stream
                return await youtube.getStreamUrl(identifier);

            case 'http':
                return await http.getStreamUrl(identifier);

            default:
                return await youtube.getStreamUrl(identifier);
        }
    } catch (e) {
        logger.error('[Sources] getStreamUrl error:', e.message);
        return null;
    }
}

function isUrl(str) {
    return /^https?:\/\/|^spotify:|^spotify\.com/.test(str);
}

module.exports = { loadTracks, getStreamUrl, buildTrackObject };
