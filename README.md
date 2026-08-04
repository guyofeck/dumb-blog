# 🗞️ Yet Another Dumb Blog

A deliberately simple blog webapp with a full login flow. **Zero npm dependencies** — just Node's standard library, some HTML, and questionable judgment.

## Features

- **Sign up / log in / log out** — passwords hashed with `crypto.scryptSync` (salted), constant-time comparison on login, `HttpOnly` + `SameSite=Lax` session cookies
- **Write posts** — authenticated users can publish; everyone can read
- **In-memory storage** — restart the server and everything is gone, as nature intended
- **HTML escaping** — your XSS attempts will be displayed as plain text, sorry

## Run it

```bash
npm start
```

Then open http://localhost:4477 (override with `PORT=...`).

## Non-features

- No database
- No framework
- No build step
- No password reset (choose wisely)
- No pagination (write fewer posts)

## Why?

Someone asked for "a webapp for something stupid" with a login flow. Mission accomplished.
