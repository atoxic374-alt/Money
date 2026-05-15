#!/usr/bin/env node
const http = require('http');
const { spawn } = require('child_process');

const LAVALINK_PORT = Number(process.env.SERVER_PORT || 2333);
const LAVALINK_HOST = process.env.LAVALINK_HEALTH_HOST || '127.0.0.1';
const START_TIMEOUT_MS = Number(process.env.LAVALINK_START_TIMEOUT_MS || 120000);

function spawnProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });

  child.on('exit', (code, signal) => {
    if (signal) console.log(`[start-all] ${command} exited by ${signal}`);
    else console.log(`[start-all] ${command} exited with code ${code}`);
  });

  return child;
}

function healthCheck() {
  return new Promise((resolve) => {
    const req = http.get({ host: LAVALINK_HOST, port: LAVALINK_PORT, path: '/version', timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

async function waitForLavalink() {
  const started = Date.now();
  while (Date.now() - started < START_TIMEOUT_MS) {
    if (await healthCheck()) return true;
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
  return false;
}

async function main() {
  const lavalink = spawnProcess('npm', ['run', 'lavalink']);
  const ready = await waitForLavalink();
  if (!ready) {
    console.error(`[start-all] Lavalink did not become ready on ${LAVALINK_HOST}:${LAVALINK_PORT}`);
    lavalink.kill('SIGTERM');
    process.exit(1);
  }

  console.log('[start-all] Lavalink is ready; starting Discord bot...');
  const bot = spawnProcess('node', ['index.js']);

  const shutdown = () => {
    bot.kill('SIGTERM');
    lavalink.kill('SIGTERM');
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[start-all] Failed:', error);
  process.exit(1);
});
