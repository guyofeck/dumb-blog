# Development Notes

## Overview
Zero-dependency Node.js blog app. Pure `http` module server with in-memory storage (no database). Everything resets on restart (including `node --watch` restarts on file edits).

## Running
```bash
docker compose -f docker-compose.base44.yml up -d
```
App serves on port 3000 (`PORT` env var; default outside compose is 4477). `node --watch` restarts the server on edits — reload the preview afterwards (no HMR).

## Key facts
- No npm dependencies — no `npm install` needed. No build step.
- Optional Google OAuth ("Sign in with Google"): needs `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from `/run/base44/app.env`. Without them the app boots fine; `/auth/google` returns a "not configured" error.
- `APP_ORIGIN` is set in compose to the public preview URL; the OAuth redirect URI is `${APP_ORIGIN}/auth/google/callback` and must be registered in Google Cloud Console.
- Verify: `curl localhost:3000` returns the home page; sign up at `/signup`, then write a post.
