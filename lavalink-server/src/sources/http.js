const logger = require('../utils/logger');

function isHttpUrl(url) {
    return /^https?:\/\//.test(url);
}

async function resolve(identifier) {
    try {
        // Try to extract metadata from URL
        const urlObj = new URL(identifier);
        const filename = urlObj.pathname.split('/').pop() || 'stream';
        const title = filename.replace(/\.[^.]+$/, '') || 'HTTP Stream';

        return {
            type: 'track',
            tracks: [{
                identifier,
                isSeekable: false,
                author: 'HTTP',
                length: 0,
                isStream: identifier.includes('.m3u8') || identifier.includes('.pls'),
                position: 0,
                title,
                uri: identifier,
                artworkUrl: null,
                isrc: null,
                sourceName: 'http',
            }]
        };
    } catch (e) {
        logger.error('[HTTP] resolve error:', e.message);
        return null;
    }
}

async function getStreamUrl(identifier) {
    return { url: identifier };
}

module.exports = { resolve, getStreamUrl, isHttpUrl };
