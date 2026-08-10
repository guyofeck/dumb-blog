# AGENTS.md

## Overview
Zero-dependency Node.js blog app ("Yet Another Dumb Blog"). Single `server.js` file using only Node built-ins (`http`, `crypto`, `fs`, `path`). In-memory storage — all data lost on restart.

## Running
```bash
docker compose -f docker-compose.base44.yml up -d
```
App listens on port 3000 (mapped from internal port 3000, configurable via `PORT` env var).

## Key facts
- No npm dependencies — no `npm install` needed.
- No database — users, sessions, and posts are in-memory Maps/arrays.
- Static CSS served from `public/style.css`.
- Auth: scrypt-hashed passwords, HttpOnly session cookies.
