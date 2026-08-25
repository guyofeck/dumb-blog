# Development Notes

## Overview
Zero-dependency Node.js blog app. Pure `http` module server with in-memory storage (no database). Everything resets on restart.

## Running
```bash
docker compose -f docker-compose.base44.yml up -d
```
App serves on port 3000 (mapped from internal port 3000, configured via `PORT` env var).

## Key facts
- No npm dependencies — no `npm install` needed.
- No build step.
- No external services or secrets required.
- In-memory data store: users, sessions, and posts are lost on restart.
