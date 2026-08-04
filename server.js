const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 4477;

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
<title>${esc(title)} · Yet Another Dumb Blog</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header>
  <a class="logo" href="/">🗞️ Yet Another Dumb Blog</a>
  <nav>
    ${user
      ? `<span class="who">signed in as <b>${esc(user)}</b></span>
         <a class="btn" href="/new">New post</a>
         <form method="post" action="/logout" class="inline"><button class="btn ghost">Log out</button></form>`
      : `<a class="btn ghost" href="/login">Log in</a>
         <a class="btn" href="/signup">Sign up</a>`}
  </nav>
</header>
<main>${body}</main>
<footer>proudly held together with zero dependencies</footer>
</body>
</html>`;
}

function renderHome(user) {
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
  return page("Home", `<h1>Latest hot takes</h1>${list}`, user);
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

function redirect(res, location, setCookie) {
  const headers = { Location: location };
  if (setCookie) headers["Set-Cookie"] = setCookie;
  res.writeHead(302, headers);
  res.end();
}

function send(res, html, status = 200) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
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
    return send(res, renderHome(user));
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
    return redirect(res, "/", `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`);
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
    return redirect(res, "/", `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`);
  }

  if (req.method === "POST" && url.pathname === "/logout") {
    const cookie = req.headers.cookie || "";
    const match = cookie.match(/(?:^|;\s*)sid=([a-f0-9]{64})/);
    if (match) sessions.delete(match[1]);
    return redirect(res, "/", "sid=; Max-Age=0; Path=/");
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

  send(res, page("404", `<h1>404</h1><p>This page is even dumber than the rest — it doesn't exist.</p>`, user), 404);
});

server.listen(PORT, () => {
  console.log(`Yet Another Dumb Blog listening on http://localhost:${PORT}`);
});
