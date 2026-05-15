const { spawn } = require('child_process');
const logger = require('./logger');

// Global rate limiter to prevent ban across all concurrent requests
const rateLimit = {
    lastRequest: 0,
    minGap: 800, // ms between requests
    queue: [],
    processing: false,

    async acquire() {
        return new Promise((resolve) => {
            this.queue.push(resolve);
            this._process();
        });
    },

    async _process() {
        if (this.processing) return;
        this.processing = true;
        while (this.queue.length > 0) {
            const now = Date.now();
            const wait = Math.max(0, this.lastRequest + this.minGap - now);
            if (wait > 0) await sleep(wait);
            this.lastRequest = Date.now();
            const resolve = this.queue.shift();
            resolve();
            // jitter between requests
            await sleep(Math.floor(Math.random() * 400));
        }
        this.processing = false;
    }
};

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

/**
 * Execute yt-dlp with retry logic and rate limiting
 * @param {string} url - URL or search query
 * @param {string[]} args - yt-dlp arguments
 * @param {object} options - { retries, timeout, noRateLimit }
 */
async function ytdlp(url, args = [], options = {}) {
    const retries = options.retries ?? 3;
    const timeout = options.timeout ?? 30000;
    const noRateLimit = options.noRateLimit ?? false;

    let lastError;

    for (let attempt = 0; attempt < retries; attempt++) {
        if (attempt > 0) {
            const backoff = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
            const jitter = Math.floor(Math.random() * 1000);
            logger.debug(`[ytdlp] Retry ${attempt}/${retries - 1} after ${backoff + jitter}ms`);
            await sleep(backoff + jitter);
        }

        if (!noRateLimit) await rateLimit.acquire();

        try {
            const result = await _exec(url, args, timeout);
            return result;
        } catch (e) {
            lastError = e;
            const msg = e.message || '';

            // Rate limit - wait longer
            if (msg.includes('429') || msg.includes('Too Many Requests')) {
                logger.warn(`[ytdlp] Rate limited (429), backing off...`);
                await sleep(5000 + Math.random() * 5000);
                continue;
            }

            // 403 - try different client next attempt
            if (msg.includes('403') || msg.includes('Forbidden')) {
                logger.warn(`[ytdlp] 403 Forbidden on attempt ${attempt + 1}`);
                continue;
            }

            // Fatal errors - don't retry
            if (msg.includes('is not a valid URL') || msg.includes('No video formats found')) {
                throw e;
            }

            logger.warn(`[ytdlp] Attempt ${attempt + 1} failed: ${msg.slice(0, 100)}`);
        }
    }

    throw lastError || new Error('yt-dlp failed after all retries');
}


function withEnvironmentArgs(args) {
    const finalArgs = [...args];
    const hasArg = (name) => finalArgs.includes(name) || finalArgs.some(arg => arg.startsWith(`${name}=`));
    const hasHeader = (headerName) => finalArgs.some((arg, index) => {
        if (arg !== '--add-header') return false;
        return String(finalArgs[index + 1] || '').toLowerCase().startsWith(`${headerName.toLowerCase()}:`);
    });

    if (process.env.YTDLP_USER_AGENT && !hasHeader('user-agent')) {
        finalArgs.push('--add-header', `user-agent:${process.env.YTDLP_USER_AGENT}`);
    }

    if (process.env.YTDLP_COOKIES_PATH && !hasArg('--cookies')) {
        finalArgs.push('--cookies', process.env.YTDLP_COOKIES_PATH);
    }

    return finalArgs;
}

function _exec(url, args, timeout) {
    return new Promise((resolve, reject) => {
        const finalArgs = withEnvironmentArgs(args);
        const proc = spawn('yt-dlp', [...finalArgs, url], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const timer = timeout > 0 ? setTimeout(() => {
            timedOut = true;
            try { proc.kill('SIGKILL'); } catch {}
            reject(new Error(`yt-dlp timed out after ${timeout}ms`));
        }, timeout) : null;

        proc.stdout.on('data', d => { stdout += d.toString(); });
        proc.stderr.on('data', d => { stderr += d.toString(); });

        proc.on('close', (code) => {
            if (timer) clearTimeout(timer);
            if (timedOut) return;

            if (code !== 0) {
                // Filter warning lines from stderr
                const errMsg = stderr
                    .split('\n')
                    .filter(l => !l.startsWith('WARNING:') && l.trim())
                    .join(' ')
                    .trim();
                reject(new Error(errMsg || `yt-dlp exited with code ${code}`));
            } else {
                if (!stdout.trim()) {
                    reject(new Error('yt-dlp returned no output'));
                    return;
                }
                try {
                    resolve(JSON.parse(stdout));
                } catch {
                    resolve(stdout.trim());
                }
            }
        });

        proc.on('error', (e) => {
            if (timer) clearTimeout(timer);
            reject(e);
        });
    });
}

module.exports = ytdlp;
