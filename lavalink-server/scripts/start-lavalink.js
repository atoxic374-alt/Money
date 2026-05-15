#!/usr/bin/env node
const { createWriteStream, existsSync, mkdirSync, statSync } = require('fs');
const { get } = require('https');
const { join, resolve } = require('path');
const { spawn } = require('child_process');

const ROOT = resolve(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const JAR_PATH = process.env.LAVALINK_JAR_PATH || join(DATA_DIR, 'Lavalink.jar');
const VERSION = process.env.LAVALINK_VERSION || '4.2.2';
const CONFIG = process.env.LAVALINK_CONFIG || join(ROOT, 'application.yml');
const DEFAULT_JAVA_OPTS = [
  '-Xms64m',
  `-Xmx${process.env.LAVALINK_MAX_RAM || '384m'}`,
  '-XX:+UseG1GC',
  '-XX:+UseStringDeduplication',
  '-Dfile.encoding=UTF-8',
];

function requestJson(url) {
  return new Promise((resolveRequest, reject) => {
    get(url, { headers: { 'User-Agent': 'Money-Lavalink-Launcher' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        requestJson(res.headers.location).then(resolveRequest, reject);
        return;
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API returned ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }

        try {
          resolveRequest(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

function download(url, target) {
  return new Promise((resolveDownload, reject) => {
    const file = createWriteStream(target);
    get(url, { headers: { 'User-Agent': 'Money-Lavalink-Launcher' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        download(res.headers.location, target).then(resolveDownload, reject);
        return;
      }

      if (res.statusCode !== 200) {
        file.close();
        reject(new Error(`Download returned ${res.statusCode}`));
        return;
      }

      res.pipe(file);
      file.on('finish', () => file.close(resolveDownload));
    }).on('error', (error) => {
      file.close();
      reject(error);
    });
  });
}

async function ensureJar() {
  mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(JAR_PATH) && statSync(JAR_PATH).size > 1024 * 1024) {
    console.log(`[Lavalink] Using cached jar: ${JAR_PATH}`);
    return;
  }

  if (VERSION !== 'latest') {
    const directUrl = `https://github.com/lavalink-devs/Lavalink/releases/download/${VERSION}/Lavalink.jar`;
    console.log(`[Lavalink] Downloading ${VERSION} from ${directUrl}`);
    await download(directUrl, JAR_PATH);
    return;
  }

  const releaseUrl = 'https://api.github.com/repos/lavalink-devs/Lavalink/releases/latest';
  console.log('[Lavalink] Fetching latest release metadata...');
  const release = await requestJson(releaseUrl);
  const asset = release.assets?.find(item => item.name === 'Lavalink.jar')
    || release.assets?.find(item => item.name.endsWith('.jar'));

  if (!asset) {
    throw new Error(`No Lavalink jar asset found in release ${release.tag_name || VERSION}`);
  }

  console.log(`[Lavalink] Downloading ${release.tag_name || VERSION} from ${asset.browser_download_url}`);
  await download(asset.browser_download_url, JAR_PATH);
}

async function main() {
  await ensureJar();
  const extraJavaOpts = (process.env.JAVA_OPTS || '').split(/\s+/).filter(Boolean);
  const args = [...DEFAULT_JAVA_OPTS, ...extraJavaOpts, '-jar', JAR_PATH, '--spring.config.location', CONFIG];
  console.log(`[Lavalink] Starting official Lavalink with Java opts: ${[...DEFAULT_JAVA_OPTS, ...extraJavaOpts].join(' ')}`);
  console.log(`[Lavalink] Config: ${CONFIG}`);

  if (process.env.LAVALINK_DRY_RUN === 'true') {
    console.log('[Lavalink] Dry run complete; not spawning Java.');
    return;
  }

  const child = spawn('java', args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error('[Lavalink] Failed to start:', error);
  process.exit(1);
});
