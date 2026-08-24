# Development Notes

## Overview
Zero-dependency Node.js blog app with signup/login (in-memory storage). No database, no build step.

## Running
```bash
docker compose -f docker-compose.base44.yml up -d
```
App serves on port 3000.

## Key Details
- Single `server.js` file handles all routing and rendering (no framework).
- Static CSS at `public/style.css`.
- All data is in-memory — restarting the container resets users and posts.
- No external services or secrets needed.
