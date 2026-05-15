# Lavalink Runtime

This project now runs the official Java Lavalink server by default instead of the old custom JS voice server.

Why:

- Official Lavalink is the community standard audio node for Discord music bots.
- Lavalink `4.2.x` includes Discord DAVE/E2EE voice support, which is required to avoid Discord voice close code `4017` in protected voice calls.
- The Java server is more stable and efficient for voice/audio than maintaining a custom WebSocket/UDP implementation in Node.

## Run locally / Replit

```bash
npm start --prefix lavalink-server
```

The launcher downloads the latest `Lavalink.jar` into `lavalink-server/data/` on first start, then reuses it.

## Useful environment variables

- `LAVALINK_VERSION`: defaults to the pinned DAVE-capable `4.2.2`; set `latest` if you want the launcher to resolve the newest GitHub release.
- `LAVALINK_MAX_RAM`: default `384m`; lower to `256m` on small Replit instances.
- `LAVALINK_SERVER_PASSWORD`: defaults to `youshallnotpass`.
- `SERVER_PORT`: defaults to `2333`.
- `YOUTUBE_OAUTH_ENABLED`: set `true` if YouTube requires OAuth on your host.
- `YOUTUBE_PO_TOKEN` / `YOUTUBE_VISITOR_DATA`: optional YouTube anti-bot values.

## Bot connection

The bot reads `settings/host.json`, which points to `127.0.0.1:2333`.
