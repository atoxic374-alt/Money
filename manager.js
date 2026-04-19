const fs = require('fs');
const { runsys } = require('./music');

const runningBots = new Map();
async function checkForNewBots() {
    try {
        const data = fs.readFileSync('./settings/tokens.json', 'utf8');
        const tokens = JSON.parse(data);

        for (const botData of tokens) {
            let botInstance = runningBots.get(botData.token);

            if (!botInstance || !botInstance.isReady()) {
                botInstance = await runsys(botData.token, botData.Server);

                if (botInstance) {
                    runningBots.set(botData.token, botInstance);
                }
            } else {
            }
        }
    } catch (error) {
        return;
    }
}
setInterval(checkForNewBots, 10000);
