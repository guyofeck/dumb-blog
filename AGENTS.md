# Development Notes

## Overview
Zero-dependency Node.js blog app. No database, no framework — pure `http` module with in-memory storage.

## Running
```bash
docker compose -f docker-compose.base44.yml up -d
```
App serves on port 3000. Uses `node --watch` for live reload on file changes.

## Quirks
- All data (users, sessions, posts) lives in memory — server restart wipes everything.
- No npm install needed — zero dependencies.
- Static CSS served from `public/style.css`.
