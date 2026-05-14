const chalk = require('chalk');

const levels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const currentLevel = levels[process.env.LOG_LEVEL || 'INFO'];

function timestamp() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

const logger = {
    debug: (msg, ...args) => {
        if (currentLevel <= levels.DEBUG)
            console.log(chalk.gray(`[${timestamp()}] [DEBUG] ${msg}`), ...args);
    },
    info: (msg, ...args) => {
        if (currentLevel <= levels.INFO)
            console.log(chalk.cyan(`[${timestamp()}] [INFO]  ${msg}`), ...args);
    },
    warn: (msg, ...args) => {
        if (currentLevel <= levels.WARN)
            console.log(chalk.yellow(`[${timestamp()}] [WARN]  ${msg}`), ...args);
    },
    error: (msg, ...args) => {
        if (currentLevel <= levels.ERROR)
            console.log(chalk.red(`[${timestamp()}] [ERROR] ${msg}`), ...args);
    }
};

module.exports = logger;
