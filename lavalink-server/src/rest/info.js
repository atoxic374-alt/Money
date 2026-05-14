const router = require('express').Router();
const os = require('os');

const SERVER_INFO = {
    version: {
        semver: '4.0.8',
        major: 4,
        minor: 0,
        patch: 8,
        preRelease: null,
        build: 'custom',
    },
    buildTime: Date.now(),
    git: {
        branch: 'main',
        commit: 'custom',
        commitTime: Date.now(),
    },
    jvm: process.version,
    lavaplayer: '2.2.1',
    sourceManagers: ['youtube', 'soundcloud', 'spotify', 'deezer', 'applemusic', 'http'],
    filters: ['volume', 'equalizer', 'timescale', 'tremolo', 'vibrato', 'rotation', 'distortion', 'channelMix', 'lowPass'],
    plugins: [],
};

router.get('/info', (req, res) => {
    res.json(SERVER_INFO);
});

router.get('/version', (req, res) => {
    res.set('Content-Type', 'text/plain');
    res.send(SERVER_INFO.version.semver);
});

router.get('/stats', (req, res) => {
    const playerManager = req.app.get('playerManager');
    const stats = playerManager ? playerManager.getStats() : {};
    res.json({
        players: stats.players || 0,
        playingPlayers: stats.playingPlayers || 0,
        uptime: Math.floor(process.uptime() * 1000),
        memory: stats.memory || {
            free: os.freemem(),
            used: process.memoryUsage().heapUsed,
            allocated: process.memoryUsage().heapTotal,
            reservable: os.totalmem(),
        },
        cpu: stats.cpu || {
            cores: os.cpus().length,
            systemLoad: 0,
            lavalinkLoad: 0,
        },
        frameStats: stats.frameStats || { sent: 0, nulled: 0, deficit: 0 },
    });
});

module.exports = router;
