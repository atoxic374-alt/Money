const fs = require('fs');
const { runsys } = require('./music');

const runningBots = new Map();

// تخزين معلومات الفشل مع وقت إعادة المحاولة (Exponential Backoff)
const failedTokens = new Map(); // token → { attempts, retryAt }

const BACKOFF_BASE_MS  = 30_000;   // 30 ثانية أول محاولة
const BACKOFF_MAX_MS   = 900_000;  // 15 دقيقة كحد أقصى
const SPAWN_CONCURRENCY = 10;      // عدد البوتات المشغّلة بالتوازي في المرة الواحدة

function getBackoffDelay(attempts) {
    return Math.min(BACKOFF_BASE_MS * Math.pow(2, attempts - 1), BACKOFF_MAX_MS);
}

// تشغيل مجموعة من الوعود بتوازٍ محدود (مثل p-limit بدون حزمة خارجية)
async function runWithConcurrency(tasks, limit) {
    const results = [];
    let i = 0;
    async function next() {
        if (i >= tasks.length) return;
        const task = tasks[i++];
        await task().catch(() => {});
        await next();
    }
    const workers = Array.from({ length: Math.min(limit, tasks.length) }, next);
    await Promise.all(workers);
    return results;
}

async function checkForNewBots() {
    let tokens;
    try {
        const data = fs.readFileSync('./settings/tokens.json', 'utf8');
        tokens = JSON.parse(data || '[]');
    } catch {
        return;
    }

    const now = Date.now();
    const toSpawn = [];

    for (const botData of tokens) {
        const failInfo = failedTokens.get(botData.token);

        // التوكن فشل — هل حان وقت إعادة المحاولة؟
        if (failInfo) {
            if (now < failInfo.retryAt) continue;
        }

        // البوت شغّال وجاهز — تخطَّه
        const existing = runningBots.get(botData.token);
        if (existing && existing.isReady()) continue;

        toSpawn.push(botData);
    }

    if (toSpawn.length === 0) return;

    const tasks = toSpawn.map(botData => async () => {
        try {
            const botInstance = await runsys(botData.token, botData.Server);
            if (botInstance) {
                runningBots.set(botData.token, botInstance);
                failedTokens.delete(botData.token); // نجح → امسح سجل الفشل
            } else {
                const prev = failedTokens.get(botData.token);
                const attempts = (prev?.attempts || 0) + 1;
                failedTokens.set(botData.token, {
                    attempts,
                    retryAt: Date.now() + getBackoffDelay(attempts),
                });
            }
        } catch {
            const prev = failedTokens.get(botData.token);
            const attempts = (prev?.attempts || 0) + 1;
            failedTokens.set(botData.token, {
                attempts,
                retryAt: Date.now() + getBackoffDelay(attempts),
            });
        }
    });

    // شغّل SPAWN_CONCURRENCY بوت في آنٍ واحد بدلاً من واحد واحد
    await runWithConcurrency(tasks, SPAWN_CONCURRENCY);
}

// فحص كل 15 ثانية (بدلاً من 10) — يقلّل الضغط على I/O
setInterval(checkForNewBots, 15_000);
checkForNewBots(); // فور التشغيل بدون انتظار
