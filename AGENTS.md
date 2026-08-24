# Development Notes

## Overview
Zero-dependency Node.js blog with in-memory storage. No database, no framework, no build step.

## Running
```bash
docker compose -f docker-compose.base44.yml up -d
```
App serves on port 3000. No external services or secrets required.

## Key details
- All state is in-memory — restarting the container wipes users and posts.
- The server uses Node's built-in `http`, `crypto`, and `fs` modules only.
- Static CSS is served from `public/style.css`.
- No hot-reload: changes to `server.js` require restarting the container (`docker compose -f docker-compose.base44.yml restart web`).
