const fs = require('fs');
const { runsys } = require('./music');

const runningBots = new Map();
const failedTokens = new Set();

async function checkForNewBots() {
    let tokens;
    try {
        const data = fs.readFileSync('./settings/tokens.json', 'utf8');
        tokens = JSON.parse(data || '[]');
    } catch {
        return;
    }

    for (const botData of tokens) {
        if (failedTokens.has(botData.token)) continue;

        const existing = runningBots.get(botData.token);
        if (existing && existing.isReady()) continue;

        try {
            const botInstance = await runsys(botData.token, botData.Server);
            if (botInstance) {
                runningBots.set(botData.token, botInstance);
            } else {
                failedTokens.add(botData.token);
            }
        } catch {
            failedTokens.add(botData.token);
        }
    }
}

setInterval(checkForNewBots, 10000);
