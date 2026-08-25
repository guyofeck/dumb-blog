const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 4477;
const APP_ORIGIN = process.env.APP_ORIGIN || `http://localhost:${PORT}`;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_REDIRECT_URI = `${APP_ORIGIN}/auth/google/callback`;

// In-memory "database". Restarting the server wipes everything, which is
// consistent with the overall level of ambition here.
const users = new Map(); // username -> { salt, hash }
const sessions = new Map(); // sessionId -> username
const posts = []; // { id, author, title, body, createdAt }

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function createSession(username) {
  const sid = crypto.randomBytes(32).toString("hex");
  sessions.set(sid, username);
  return sid;
}

function getSessionUser(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)sid=([a-f0-9]{64})/);
  return match ? sessions.get(match[1]) || null : null;
}

// One-shot flash message carried in a cookie: set on redirect, shown once, cleared.
function flashCookie(message) {
  return `flash=${encodeURIComponent(message)}; Path=/; SameSite=Lax; Max-Age=30`;
}

function getFlash(req) {
  const match = (req.headers.cookie || "").match(/(?:^|;\s*)flash=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

const CLEAR_FLASH = "flash=; Max-Age=0; Path=/";

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    }).on("error", reject);
  });
}

function httpsPost(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(body);
    const req = https.request({ hostname, path, method: "POST", headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": data.length,
    }}, (res) => {
      let out = "";
      res.on("data", (chunk) => (out += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: out }));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function parseBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(new URLSearchParams(data)));
  });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function page(title, body, user) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Yet Another Dumb Blog!!</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header>
  <a class="logo" href="/">🗞️ Yet Another Dumb Blog!</a>
  <nav>
    ${user
      ? `<span class="who">signed in as <b>${esc(user)}</b></span>
         <a class="btn" href="/new">New post</a>
         <form method="post" action="/logout" class="inline"><button class="btn ghost">Log out</button></form>`
      : `<a class="btn ghost" href="/login">Log in</a>
         <a class="btn" href="/signup">Sign up</a>
         <a class="btn google" href="/auth/google">Sign in with Google</a>`}
  </nav>
</header>
<main>${body}</main>
<footer>proudly held together with zero dependencies</footer>
</body>
</html>`;
}

function renderHome(user, flash) {
  const list = posts.length
    ? posts
        .slice()
        .reverse()
        .map(
          (p) => `<article class="post">
  <h2>${esc(p.title)}</h2>
  <div class="meta">by <b>${esc(p.author)}</b> · ${new Date(p.createdAt).toLocaleString()}</div>
  <p>${esc(p.body).replace(/\n/g, "<br>")}</p>
</article>`
        )
        .join("\n")
    : `<p class="empty">No posts yet. The internet thanks you for your restraint.</p>`;
  const banner = flash ? `<div class="flash">✅ ${esc(flash)}</div>` : "";
  return page("Home", `${banner}<h1>Latest hot takes</h1>${list}`, user);
}

function renderForm(kind, error) {
  const isLogin = kind === "login";
  return page(
    isLogin ? "Log in" : "Sign up",
    `<h1>${isLogin ? "Log in" : "Create an account"}</h1>
${error ? `<p class="error">${esc(error)}</p>` : ""}
<form method="post" action="/${kind}" class="card">
  <label>Username <input name="username" required autofocus autocomplete="username"></label>
  <label>Password <input name="password" type="password" required autocomplete="${isLogin ? "current-password" : "new-password"}"></label>
  <button class="btn primary">${isLogin ? "Log in" : "Sign up"}</button>
  <div class="divider">or</div>
  <a class="btn google" href="/auth/google">Sign in with Google</a>
  <p class="hint">${
    isLogin
      ? `No account? <a href="/signup">Sign up</a>`
      : `Already have one? <a href="/login">Log in</a>`
  }</p>
</form>`,
    null
  );
}

function renderNewPost(user, error) {
  return page(
    "New post",
    `<h1>Publish your wisdom</h1>
${error ? `<p class="error">${esc(error)}</p>` : ""}
<form method="post" action="/new" class="card">
  <label>Title <input name="title" required autofocus></label>
  <label>Body <textarea name="body" rows="6" required></textarea></label>
  <button class="btn primary">Publish</button>
</form>`,
    user
  );
}

function redirect(res, location, setCookies) {
  const headers = { Location: location };
  if (setCookies) headers["Set-Cookie"] = setCookies;
  res.writeHead(302, headers);
  res.end();
}

function send(res, html, status = 200, setCookie) {
  const headers = { "Content-Type": "text/html; charset=utf-8" };
  if (setCookie) headers["Set-Cookie"] = setCookie;
  res.writeHead(status, headers);
  res.end(html);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const user = getSessionUser(req);

  if (req.method === "GET" && url.pathname === "/style.css") {
    res.writeHead(200, { "Content-Type": "text/css" });
    res.end(fs.readFileSync(path.join(__dirname, "public", "style.css")));
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    const flash = getFlash(req);
    return send(res, renderHome(user, flash), 200, flash ? CLEAR_FLASH : undefined);
  }

  if (url.pathname === "/signup") {
    if (req.method === "GET") return send(res, renderForm("signup"));
    const form = await parseBody(req);
    const username = (form.get("username") || "").trim();
    const password = form.get("password") || "";
    if (!username || password.length < 4)
      return send(res, renderForm("signup", "Username required; password must be at least 4 characters."), 400);
    if (users.has(username))
      return send(res, renderForm("signup", "That username is taken. Be more original."), 409);
    const salt = crypto.randomBytes(16).toString("hex");
    users.set(username, { salt, hash: hashPassword(password, salt) });
    const sid = createSession(username);
    return redirect(res, "/", [
      `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`,
      flashCookie(`Account created — welcome, ${username}! You are now logged in.`),
    ]);
  }

  if (url.pathname === "/login") {
    if (req.method === "GET") return send(res, renderForm("login"));
    const form = await parseBody(req);
    const username = (form.get("username") || "").trim();
    const password = form.get("password") || "";
    const record = users.get(username);
    const ok =
      record &&
      crypto.timingSafeEqual(
        Buffer.from(record.hash, "hex"),
        Buffer.from(hashPassword(password, record.salt), "hex")
      );
    if (!ok) return send(res, renderForm("login", "Wrong username or password."), 401);
    const sid = createSession(username);
    return redirect(res, "/", [
      `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`,
      flashCookie(`Welcome back, ${username}! You are now logged in.`),
    ]);
  }

  if (req.method === "POST" && url.pathname === "/logout") {
    const cookie = req.headers.cookie || "";
    const match = cookie.match(/(?:^|;\s*)sid=([a-f0-9]{64})/);
    if (match) sessions.delete(match[1]);
    return redirect(res, "/", [
      "sid=; Max-Age=0; Path=/",
      flashCookie("You have been logged out. Go touch grass."),
    ]);
  }

  if (url.pathname === "/new") {
    if (!user) return redirect(res, "/login");
    if (req.method === "GET") return send(res, renderNewPost(user));
    const form = await parseBody(req);
    const title = (form.get("title") || "").trim();
    const body = (form.get("body") || "").trim();
    if (!title || !body) return send(res, renderNewPost(user, "Both fields are required, tragically."), 400);
    posts.push({ id: posts.length + 1, author: user, title, body, createdAt: Date.now() });
    return redirect(res, "/");
  }

  // Google OAuth — start
  if (req.method === "GET" && url.pathname === "/auth/google") {
    if (!GOOGLE_CLIENT_ID) return send(res, page("Error", "<p class='error'>Google OAuth is not configured.</p>", null), 500);
    const state = crypto.randomBytes(16).toString("hex");
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: "code",
      scope: "openid email profile",
      state,
    });
    return redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${params}`, [
      `oauth_state=${state}; HttpOnly; Path=/; SameSite=Lax; Max-Age=300`,
    ]);
  }

  // Google OAuth — callback
  if (req.method === "GET" && url.pathname === "/auth/google/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieState = (req.headers.cookie || "").match(/(?:^|;\s*)oauth_state=([a-f0-9]+)/)?.[1];
    if (!code || !state || state !== cookieState)
      return send(res, page("Error", "<p class='error'>OAuth state mismatch. Please try again.</p>", null), 400);

    // Exchange code for tokens
    const tokenRes = await httpsPost("oauth2.googleapis.com", "/token", new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }).toString());
    const tokens = JSON.parse(tokenRes.body);
    if (!tokens.access_token)
      return send(res, page("Error", `<p class='error'>Google auth failed: ${esc(tokens.error_description || tokens.error || "unknown error")}</p>`, null), 400);

    // Fetch user info
    const userRes = await httpsGet(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${tokens.access_token}`);
    const profile = JSON.parse(userRes.body);
    const username = profile.email;
    if (!username)
      return send(res, page("Error", "<p class='error'>Could not retrieve email from Google.</p>", null), 400);

    // Create account if first time
    if (!users.has(username)) {
      users.set(username, { salt: null, hash: null, google: true });
    }
    const sid = createSession(username);
    return redirect(res, "/", [
      `oauth_state=; Max-Age=0; Path=/`,
      `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`,
      flashCookie(`Welcome, ${username}!`),
    ]);
  }

  send(res, page("404", `<h1>404</h1><p>This page is even dumber than the rest — it doesn't exist.</p>`, user), 404);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Yet Another Dumb Blog listening on http://localhost:${PORT}`);
});
