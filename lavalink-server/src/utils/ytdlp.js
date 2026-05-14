const { spawn } = require('child_process');

// Wrapper around the system yt-dlp binary
function ytdlp(url, args = []) {
    return new Promise((resolve, reject) => {
        const proc = spawn('yt-dlp', [...args, url], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', d => { stdout += d.toString(); });
        proc.stderr.on('data', d => { stderr += d.toString(); });

        proc.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
            } else {
                try {
                    resolve(JSON.parse(stdout));
                } catch {
                    resolve(stdout);
                }
            }
        });

        proc.on('error', reject);
    });
}

module.exports = ytdlp;
