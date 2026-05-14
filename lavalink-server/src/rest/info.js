const router = require('express').Router();
const os = require('os');

const SERVER_INFO = {
    version: { semver: '4.0.8', major: 4, minor: 0, patch: 8, preRelease: null, build: 'custom' },
    buildTime: Date.now(),
    git: { branch: 'main', commit: 'custom-lavalink', commitTime: Date.now() },
    jvm: process.version,
    lavaplayer: '2.2.1',
    sourceManagers: ['youtube', 'soundcloud', 'spotify', 'deezer', 'applemusic', 'http'],
    filters: ['volume', 'equalizer', 'timescale', 'tremolo', 'vibrato', 'rotation', 'distortion', 'channelMix', 'lowPass'],
    plugins: [],
};

router.get('/info', (req, res) => res.json(SERVER_INFO));

router.get('/version', (req, res) => {
    res.set('Content-Type', 'text/plain');
    res.send(SERVER_INFO.version.semver);
});

router.get('/stats', (req, res) => {
    const pm = req.app.get('playerManager');
    const stats = pm ? pm.getStats() : {};
    const mem = process.memoryUsage();
    const cpus = os.cpus();

    // Calculate CPU load
    let lavalinkLoad = 0;
    try {
        const usage = process.cpuUsage();
        lavalinkLoad = (usage.user + usage.system) / 1e9 / os.cpus().length;
    } catch {}

    res.json({
        players: stats.players || 0,
        playingPlayers: stats.playingPlayers || 0,
        uptime: Math.floor(process.uptime() * 1000),
        memory: {
            free:       os.freemem(),
            used:       mem.heapUsed,
            allocated:  mem.heapTotal,
            reservable: os.totalmem(),
        },
        cpu: {
            cores:        cpus.length,
            systemLoad:   Math.min(lavalinkLoad * 1.2, 1),
            lavalinkLoad: Math.min(lavalinkLoad, 1),
        },
        frameStats: stats.frameStats || { sent: 0, nulled: 0, deficit: 0 },
    });
});

module.exports = router;
