// Anti-ban utilities: user agent rotation, request delays, header spoofing

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
];

const YOUTUBE_CLIENTS = [
    {
        clientName: 'WEB',
        clientVersion: '2.20240417.01.00',
        userAgent: USER_AGENTS[0],
    },
    {
        clientName: 'WEB_REMIX',
        clientVersion: '1.20240417.01.00',
        userAgent: USER_AGENTS[1],
    },
    {
        clientName: 'ANDROID',
        clientVersion: '19.14.34',
        userAgent: 'com.google.android.youtube/19.14.34 (Linux; U; Android 11) gzip',
        androidSdkVersion: 30,
    },
    {
        clientName: 'IOS',
        clientVersion: '19.14.3',
        userAgent: 'com.google.ios.youtube/19.14.3 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)',
    },
    {
        clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
        clientVersion: '2.0',
        userAgent: USER_AGENTS[2],
    },
];

let uaIndex = 0;
let clientIndex = 0;

function getRandomUserAgent() {
    const ua = USER_AGENTS[uaIndex % USER_AGENTS.length];
    uaIndex++;
    return ua;
}

function getNextYoutubeClient() {
    const client = YOUTUBE_CLIENTS[clientIndex % YOUTUBE_CLIENTS.length];
    clientIndex++;
    return client;
}

function getRandomHeaders() {
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
    };
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(min = 100, max = 500) {
    return delay(Math.floor(Math.random() * (max - min + 1)) + min);
}

function jitter(baseMs, factor = 0.3) {
    const variation = baseMs * factor;
    return baseMs + (Math.random() * variation * 2 - variation);
}

module.exports = {
    getRandomUserAgent,
    getNextYoutubeClient,
    getRandomHeaders,
    delay,
    randomDelay,
    jitter,
    USER_AGENTS,
    YOUTUBE_CLIENTS,
};
