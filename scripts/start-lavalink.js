#!/usr/bin/env node

const fs = require('fs');
const https = require('https');
const { spawn, spawnSync } = require('child_process');

const FALLBACK_LAVALINK_VERSION = '4.2.2';
const FALLBACK_YOUTUBE_PLUGIN_VERSION = '1.18.1';
const FALLBACK_LAVASRC_PLUGIN_VERSION = '4.8.1';

const JAR_PATH = process.env.LAVALINK_JAR_PATH || 'Lavalink.jar';
const PLUGINS_DIR = process.env.LAVALINK_PLUGINS_DIR || 'plugins';
const JAVA_MAX_RAM = process.env.LAVALINK_JAVA_MAX_RAM || '768m';
const JAVA_MIN_RAM = process.env.LAVALINK_JAVA_MIN_RAM || '256m';
const VERSION_CHECK_TIMEOUT_MS = Number(process.env.LAVALINK_VERSION_CHECK_TIMEOUT_MS || 15000);
const DOWNLOAD_TIMEOUT_MS = Number(process.env.LAVALINK_DOWNLOAD_TIMEOUT_MS || 120000);

const LAVALINK_VERSION_REQUEST = process.env.LAVALINK_VERSION || 'latest';
const YOUTUBE_PLUGIN_VERSION_REQUEST = process.env.YOUTUBE_PLUGIN_VERSION || 'latest';
const LAVASRC_PLUGIN_VERSION_REQUEST = process.env.LAVASRC_PLUGIN_VERSION || 'latest';

const PLUGIN_ARTIFACTS = [
  {
    name: 'youtube-plugin',
    envName: 'YOUTUBE_PLUGIN_VERSION',
    request: YOUTUBE_PLUGIN_VERSION_REQUEST,
    fallback: FALLBACK_YOUTUBE_PLUGIN_VERSION,
    metadataUrl: 'https://maven.lavalink.dev/releases/dev/lavalink/youtube/youtube-plugin/maven-metadata.xml',
    filePrefix: 'youtube-plugin-',
  },
  {
    name: 'lavasrc-plugin',
    envName: 'LAVASRC_PLUGIN_VERSION',
    request: LAVASRC_PLUGIN_VERSION_REQUEST,
    fallback: FALLBACK_LAVASRC_PLUGIN_VERSION,
    metadataUrl: 'https://maven.lavalink.dev/releases/com/github/topi314/lavasrc/lavasrc-plugin/maven-metadata.xml',
    filePrefix: 'lavasrc-plugin-',
  },
];

function requestText(url, timeoutMs = VERSION_CHECK_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'Accept': 'application/json,text/xml,text/plain,*/*',
        'User-Agent': 'Money-Music-Bot-Lavalink-Setup/2.0',
      },
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        return resolve(requestText(response.headers.location, timeoutMs));
      }

      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`HTTP ${response.statusCode}`));
      }

      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve(body));
    });

    request.setTimeout(timeoutMs, () => request.destroy(new Error('request timed out')));
    request.on('error', reject);
  });
}

async function requestJson(url) {
  return JSON.parse(await requestText(url));
}

function parseMavenMetadataVersion(xml) {
  const release = xml.match(/<release>([^<]+)<\/release>/)?.[1];
  if (release) return release.trim();

  const latest = xml.match(/<latest>([^<]+)<\/latest>/)?.[1];
  if (latest && !latest.includes('SNAPSHOT')) return latest.trim();

  const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
    .map(match => match[1].trim())
    .filter(version => version && !version.includes('SNAPSHOT'));

  return versions.at(-1) || null;
}

async function resolveLavalinkVersion() {
  if (LAVALINK_VERSION_REQUEST !== 'latest') return LAVALINK_VERSION_REQUEST;

  try {
    const release = await requestJson('https://api.github.com/repos/lavalink-devs/Lavalink/releases/latest');
    const tag = String(release.tag_name || '').replace(/^v/i, '').trim();
    if (tag) return tag;
  } catch (error) {
    console.warn(`[lavalink] Could not check latest Lavalink release: ${error.message}`);
  }

  console.warn(`[lavalink] Falling back to pinned Lavalink ${FALLBACK_LAVALINK_VERSION}`);
  return FALLBACK_LAVALINK_VERSION;
}

async function resolveMavenVersion(artifact) {
  if (artifact.request !== 'latest') return artifact.request;

  try {
    const xml = await requestText(artifact.metadataUrl);
    const version = parseMavenMetadataVersion(xml);
    if (version) return version;
  } catch (error) {
    console.warn(`[lavalink] Could not check latest ${artifact.name}: ${error.message}`);
  }

  console.warn(`[lavalink] Falling back to pinned ${artifact.name} ${artifact.fallback}`);
  return artifact.fallback;
}

function javaMajorVersion() {
  const result = spawnSync('java', ['-version'], { encoding: 'utf8', timeout: 10000 });
  const output = `${result.stderr || ''}${result.stdout || ''}`;
  const match = output.match(/version "(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return match[1] === '1' ? Number(match[2]) : Number(match[1]);
}

function assertJavaVersion() {
  const major = javaMajorVersion();
  if (!major || major < 17) {
    throw new Error(`Java 17+ is required for Lavalink v4. Detected: ${major || 'unknown'}`);
  }
  console.log(`[lavalink] Java ${major} detected.`);
}

function lavalinkJarVersion() {
  if (!fs.existsSync(JAR_PATH)) return null;
  if (fs.statSync(JAR_PATH).size < 10 * 1024 * 1024) return null;

  const result = spawnSync('java', ['-jar', JAR_PATH, '--version'], {
    encoding: 'utf8',
    timeout: 15000,
  });

  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const version = output.match(/(?:Lavalink\s*)?(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9._-]+)?)/i)?.[1];
  if (version) return version;

  return result.status === 0 ? 'unknown' : null;
}

function lavalinkDownloadUrls(version) {
  return [
    `https://github.com/lavalink-devs/Lavalink/releases/download/${version}/Lavalink.jar`,
    `https://maven.lavalink.dev/releases/dev/arbjerg/lavalink/Lavalink-Server/${version}/Lavalink-Server-${version}.jar`,
    `https://repo1.maven.org/maven2/dev/arbjerg/lavalink/Lavalink-Server/${version}/Lavalink-Server-${version}.jar`,
  ];
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'User-Agent': 'Money-Music-Bot-Lavalink-Setup/2.0',
      },
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        return resolve(downloadFile(response.headers.location, destination));
      }

      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`HTTP ${response.statusCode}`));
      }

      const tempPath = `${destination}.download`;
      const file = fs.createWriteStream(tempPath);
      response.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          fs.renameSync(tempPath, destination);
          resolve();
        });
      });
      file.on('error', (error) => {
        fs.rmSync(tempPath, { force: true });
        reject(error);
      });
    });

    request.setTimeout(DOWNLOAD_TIMEOUT_MS, () => request.destroy(new Error('download timed out')));
    request.on('error', reject);
  });
}

async function ensureJar(version) {
  const currentVersion = lavalinkJarVersion();
  if (currentVersion === version) {
    console.log(`[lavalink] Existing ${JAR_PATH} is valid and already on Lavalink ${version}.`);
    return;
  }

  if (currentVersion && LAVALINK_VERSION_REQUEST !== 'latest' && currentVersion !== 'unknown') {
    console.log(`[lavalink] Existing ${JAR_PATH} is Lavalink ${currentVersion}; requested ${version}, updating...`);
  } else if (currentVersion && LAVALINK_VERSION_REQUEST === 'latest') {
    console.log(`[lavalink] Existing ${JAR_PATH} is Lavalink ${currentVersion}; latest is ${version}, updating...`);
  } else {
    console.log(`[lavalink] ${JAR_PATH} is missing, corrupt, or too small; downloading Lavalink ${version}...`);
  }

  fs.rmSync(JAR_PATH, { force: true });

  let lastError;
  for (const url of lavalinkDownloadUrls(version)) {
    try {
      console.log(`[lavalink] Downloading ${url}`);
      await downloadFile(url, JAR_PATH);
      const downloadedVersion = lavalinkJarVersion();
      if (downloadedVersion) {
        console.log(`[lavalink] Downloaded Lavalink jar validated as ${downloadedVersion}.`);
        return;
      }
      lastError = new Error('downloaded jar failed validation');
    } catch (error) {
      lastError = error;
      console.warn(`[lavalink] Download failed: ${error.message}`);
    }
  }

  throw lastError || new Error('failed to download Lavalink');
}

function removeStalePluginJars(pluginVersions) {
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  const files = fs.readdirSync(PLUGINS_DIR);

  for (const artifact of PLUGIN_ARTIFACTS) {
    const wantedVersion = pluginVersions[artifact.envName];
    const wantedFile = `${artifact.filePrefix}${wantedVersion}.jar`;

    for (const file of files) {
      if (!file.startsWith(artifact.filePrefix) || !file.endsWith('.jar')) continue;
      if (file === wantedFile) continue;

      fs.rmSync(`${PLUGINS_DIR}/${file}`, { force: true });
      console.log(`[lavalink] Removed stale plugin jar ${PLUGINS_DIR}/${file}; Lavalink will use ${wantedFile}.`);
    }
  }
}

function assertApplicationConfig() {
  const config = fs.readFileSync('application.yml', 'utf8');
  const bannedClients = ['ANDROID_MUSIC', 'ANDROID', 'IOS_MUSIC'];
  const presentBanned = bannedClients.filter(client => config.includes(client));

  if (presentBanned.length > 0) {
    throw new Error(`application.yml still contains broken YouTube clients: ${presentBanned.join(', ')}`);
  }

  if (!config.includes('youtube: false')) {
    throw new Error('application.yml must keep lavalink.server.sources.youtube disabled when youtube-source is used.');
  }

  for (const client of ['WEB', 'WEBEMBEDDED', 'MWEB', 'TVHTML5_SIMPLY']) {
    if (!config.includes(`- ${client}`)) {
      throw new Error(`application.yml is missing YouTube client ${client}`);
    }
  }
}

async function resolveRuntimeVersions() {
  const lavalinkVersion = await resolveLavalinkVersion();
  const pluginVersions = {};

  for (const artifact of PLUGIN_ARTIFACTS) {
    pluginVersions[artifact.envName] = await resolveMavenVersion(artifact);
  }

  return { lavalinkVersion, pluginVersions };
}

async function main() {
  assertJavaVersion();
  assertApplicationConfig();

  const { lavalinkVersion, pluginVersions } = await resolveRuntimeVersions();
  process.env.YOUTUBE_PLUGIN_VERSION = pluginVersions.YOUTUBE_PLUGIN_VERSION;
  process.env.LAVASRC_PLUGIN_VERSION = pluginVersions.LAVASRC_PLUGIN_VERSION;

  console.log(`[lavalink] Target Lavalink: ${lavalinkVersion}`);
  console.log(`[lavalink] Target youtube-source plugin: ${process.env.YOUTUBE_PLUGIN_VERSION}`);
  console.log(`[lavalink] Target LavaSrc plugin: ${process.env.LAVASRC_PLUGIN_VERSION}`);

  await ensureJar(lavalinkVersion);
  removeStalePluginJars(pluginVersions);

  const javaArgs = [
    `-Xms${JAVA_MIN_RAM}`,
    `-Xmx${JAVA_MAX_RAM}`,
    '-XX:+UseG1GC',
    '-XX:MaxGCPauseMillis=100',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxMetaspaceSize=256m',
    '-Djava.awt.headless=true',
    '-Djdk.tls.client.protocols=TLSv1.2,TLSv1.3',
    '-jar',
    JAR_PATH,
  ];

  console.log(`[lavalink] Starting Lavalink with -Xms${JAVA_MIN_RAM} -Xmx${JAVA_MAX_RAM}...`);
  const child = spawn('java', javaArgs, {
    stdio: 'inherit',
    env: process.env,
  });

  const shutdown = () => child.kill('SIGTERM');
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  child.on('exit', (code, signal) => {
    if (signal) return process.exit(0);
    process.exit(code || 0);
  });
}

main().catch((error) => {
  console.error('[lavalink] Failed to start:', error);
  process.exit(1);
});
