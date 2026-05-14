const ytdlp = require('../utils/ytdlp');
const { getRandomUserAgent } = require('../utils/antibot');
const logger = require('../utils/logger');

function isSoundCloudUrl(url) {
    return /soundcloud\.com/.test(url);
}

function baseArgs() {
    return [
        '--dump-single-json',
        '--no-check-certificates',
        '--no-warnings',
        '--skip-download',
        '--add-header', `user-agent:${getRandomUserAgent()}`,
    ];
}

async function resolve(identifier) {
    try {
        const result = await ytdlp(identifier, baseArgs());
        if (result.entries) {
            return {
                type: 'playlist',
                tracks: result.entries.map(e => formatTrack(e)),
                name: result.title,
            };
        }
        return { type: 'track', tracks: [formatTrack(result)] };
    } catch (e) {
        logger.error('[SoundCloud] resolve error:', e.message);
        return null;
    }
}

async function search(query, limit = 10) {
    try {
        const result = await ytdlp(`scsearch${limit}:${query}`, [
            ...baseArgs(),
            '--flat-playlist',
        ]);
        const entries = result.entries || (result.id ? [result] : []);
        return entries.map(e => formatTrack(e));
    } catch (e) {
        logger.error('[SoundCloud] search error:', e.message);
        return [];
    }
}

async function getStreamUrl(identifier) {
    try {
        const result = await ytdlp(identifier, [
            '--dump-single-json',
            '--no-check-certificates',
            '--no-warnings',
            '--prefer-free-formats',
            '--add-header', `user-agent:${getRandomUserAgent()}`,
        ]);

        const formats = result.formats || [];
        const best = formats
            .filter(f => f.url)
            .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

        if (best?.url) return { url: best.url, contentType: best.ext || 'mp3' };
        if (result.url) return { url: result.url };
    } catch (e) {
        logger.error('[SoundCloud] getStreamUrl error:', e.message);
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
