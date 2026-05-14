/**
 * Anti-ban utilities — 2025/2026 best practices
 * Based on: yt-dlp wiki, community research, platform behavior analysis
 */

// ── User Agents ────────────────────────────────────────────────────────────────
const USER_AGENTS = [
    // Chrome Windows (most common, lowest detection risk)
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    // Chrome macOS
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    // Firefox
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0',
    // Edge
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
    // Safari macOS
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
    // Chrome Linux
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

// ── YouTube Player Clients ─────────────────────────────────────────────────────
// Research: iOS and MWEB clients work reliably without PO tokens in 2025/2026
// Android: requires PO token for some formats but works for others
// WEB: requires PO token in 2026 from flagged IPs
const YOUTUBE_CLIENTS = [
    // iOS — most reliable, no PO token needed, gives m4a/mp4
    {
        name: 'ios',
        extractorArgs: 'youtube:player_client=ios',
        userAgent: 'com.google.ios.youtube/19.45.4 (iPhone14,3; U; CPU iOS 17_5_1 like Mac OS X)',
        priority: 1,
    },
    // TV HTML5 Simple Embedded — no PO token needed
    {
        name: 'tv_simply_embedded',
        extractorArgs: 'youtube:player_client=tv_simply_embedded',
        userAgent: USER_AGENTS[0],
        priority: 2,
    },
    // MWEB — mobile web, usually works without PO token
    {
        name: 'mweb',
        extractorArgs: 'youtube:player_client=mweb',
        userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36',
        priority: 3,
    },
    // WEB — may need PO token but fallback
    {
        name: 'web',
        extractorArgs: 'youtube:player_client=web',
        userAgent: USER_AGENTS[0],
        priority: 4,
    },
    // Android — works for most content
    {
        name: 'android',
        extractorArgs: 'youtube:player_client=android',
        userAgent: 'com.google.android.youtube/19.45.36 (Linux; U; Android 11; HD1913) gzip',
        priority: 5,
    },
];

let uaIndex = 0;
let ytClientIndex = 0;
let scIndex = 0;

function getRandomUserAgent() {
    const ua = USER_AGENTS[uaIndex % USER_AGENTS.length];
    uaIndex++;
    return ua;
}

function getNextYoutubeClient(attempt = 0) {
    const sorted = [...YOUTUBE_CLIENTS].sort((a, b) => a.priority - b.priority);
    return sorted[attempt % sorted.length];
}

function getYoutubeClientByAttempt(attempt) {
    const sorted = [...YOUTUBE_CLIENTS].sort((a, b) => a.priority - b.priority);
    return sorted[attempt % sorted.length];
}

function getRandomHeaders(extra = {}) {
    const ua = getRandomUserAgent();
    return {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
        ...extra,
    };
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomDelay(min = 200, max = 800) {
    return delay(Math.floor(Math.random() * (max - min + 1)) + min);
}
function jitter(baseMs, factor = 0.3) {
    return baseMs + (Math.random() * baseMs * factor * 2 - baseMs * factor);
}

// ── Platform-specific anti-ban configs ────────────────────────────────────────
const PLATFORM_CONFIGS = {
    youtube: {
        // Best format strategy: prefer opus webm (transparent at 128kbps), fallback to HLS
        formatSelector: 'bestaudio[acodec=opus]/bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio',
        // Always try iOS client first (no PO token)
        defaultClient: 'ios',
        // Rate: max 1 request/sec
        minRequestGap: 1000,
        retries: 3,
        // Common args for quality + anti-ban
        commonArgs: [
            '--no-check-certificates',
            '--no-warnings',
            '--prefer-free-formats',
        ],
    },
    soundcloud: {
        formatSelector: 'bestaudio/best',
        minRequestGap: 500,
        retries: 3,
        commonArgs: [
            '--no-check-certificates',
            '--no-warnings',
        ],
    },
};

module.exports = {
    USER_AGENTS,
    YOUTUBE_CLIENTS,
    PLATFORM_CONFIGS,
    getRandomUserAgent,
    getNextYoutubeClient,
    getYoutubeClientByAttempt,
    getRandomHeaders,
    delay,
    randomDelay,
    jitter,
};
