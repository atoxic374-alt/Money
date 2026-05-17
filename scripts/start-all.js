#!/usr/bin/env node

const http = require('http');
const { spawn } = require('child_process');

const LAVALINK_HOST = process.env.LAVALINK_HOST || '127.0.0.1';
const LAVALINK_PORT = Number(process.env.LAVALINK_PORT || process.env.SERVER_PORT || 2333);
const LAVALINK_PASSWORD = process.env.LAVALINK_PASSWORD || 'youshallnotpass';
const START_TIMEOUT_MS = Number(process.env.LAVALINK_START_TIMEOUT_MS || 120000);
const JAVA_MAX_RAM = process.env.LAVALINK_JAVA_MAX_RAM || '768m';
const JAVA_MIN_RAM = process.env.LAVALINK_JAVA_MIN_RAM || '256m';

function spawnProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: false,
    env: process.env,
    ...options,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.log(`[start-all] ${command} ${args.join(' ')} stopped by ${signal}`);
      return;
    }

    if (code !== 0) {
      console.error(`[start-all] ${command} ${args.join(' ')} exited with code ${code}`);
      process.exitCode = code || 1;
    }
  });

  return child;
}

function healthCheck() {
  return new Promise((resolve) => {
    const req = http.request({
      host: LAVALINK_HOST,
      port: LAVALINK_PORT,
      path: '/v4/info',
      method: 'GET',
      timeout: 2000,
      headers: {
        Authorization: LAVALINK_PASSWORD,
      },
    }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

async function waitForLavalink() {
  const started = Date.now();
  while (Date.now() - started < START_TIMEOUT_MS) {
    if (await healthCheck()) return true;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return false;
}

function stopChild(child) {
  if (child && !child.killed) child.kill('SIGTERM');
}

async function main() {
  console.log(`[start-all] Starting Lavalink on ${LAVALINK_HOST}:${LAVALINK_PORT} with -Xmx${JAVA_MAX_RAM}...`);
  const lavalink = spawnProcess('node', ['scripts/start-lavalink.js']);

  const ready = await waitForLavalink();
  if (!ready) {
    console.error(`[start-all] Lavalink did not become ready on ${LAVALINK_HOST}:${LAVALINK_PORT} within ${START_TIMEOUT_MS}ms`);
    stopChild(lavalink);
    process.exit(1);
  }

  console.log('[start-all] Lavalink is ready; starting Discord bot...');
  const bot = spawnProcess('node', ['index.js']);

  const shutdown = () => {
    stopChild(bot);
    stopChild(lavalink);
  };

  bot.on('exit', (code) => {
    stopChild(lavalink);
    if (code !== 0 && code !== null) process.exit(code);
  });

  lavalink.on('exit', (code) => {
    stopChild(bot);
    if (code !== 0 && code !== null) process.exit(code);
  });

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[start-all] Failed:', error);
  process.exit(1);
});
