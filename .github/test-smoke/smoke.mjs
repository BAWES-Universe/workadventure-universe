// Loads a built play client (dist/public) in headless Chromium with a stubbed environment and prints the
// console errors and uncaught exceptions. A module that is used before it is defined (what a bad chunk split
// causes) shows up here as a ReferenceError/TypeError at load. Run for the split build and the unsplit build and compare.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [, , distDir, mode] = process.argv; // mode: modern | legacy
const types = { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png" };
let html = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
const env = { PUSHER_URL: "http://127.0.0.1:9", UPLOADER_URL: "http://127.0.0.1:9", ADMIN_URL: "http://127.0.0.1:9", ICON_URL: "http://127.0.0.1:9", BOT_SERVER_URL: "http://127.0.0.1:9", DEBUG_MODE: false, NODE_ENV: "production", MAX_USERNAME_LENGTH: 30, MAX_PER_GROUP: 4, MAX_DISPLAYED_VIDEOS: 9, ENABLE_MAP_EDITOR: true, START_ROOM_URL: "/_/global/127.0.0.1/map.json", STUN_SERVER: "", TURN_SERVER: "", ENABLE_CHAT: true, ENABLE_CHAT_UPLOAD: false, FALLBACK_LOCALE: "en-US", OPID_LOGIN_SCREEN_PROVIDER: "", PUBLIC_MAP_STORAGE_URL: "", PUSH_PUBLIC_KEY: "", SENTRY_DSN_FRONT: "", FEATURE_FLAG_BROADCAST_AREAS: false, DISABLE_NOTIFICATIONS: true };
html = html.replace(/\{\{\{\s*script\s*\}\}\}/g, "window.env = " + JSON.stringify(env) + ";");
html = html.replace(/\{\{#[^}]+\}\}[\s\S]*?\{\{\/[^}]+\}\}/g, "").replace(/\{\{[^}]*\}\}/g, "");
if (mode === "legacy") {
    // Force the old-browser path: drop the module scripts, run the nomodule ones.
    html = html.replace(/<script type="module"[^>]*><\/script>/g, "").replace(/<link rel="modulepreload"[^>]*>/g, "");
    html = html.replace(/\snomodule(="")?/g, "");
}
const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const f = path.join(distDir, p);
    if (p !== "/" && f.startsWith(distDir) && fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.writeHead(200, { "content-type": types[path.extname(f)] ?? "application/octet-stream" });
        return fs.createReadStream(f).pipe(res);
    }
    if (p.startsWith("/assets") || p.endsWith(".js")) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = new Set();
page.on("pageerror", (e) => errors.add("PAGEERROR " + String(e.message).split("\n")[0].slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") errors.add("CONSOLE " + m.text().split("\n")[0].replace(/127\.0\.0\.1:\d+/g, "HOST").slice(0, 200)); });
let started = false;
page.on("console", (m) => { if (/Start|Sentry|Phaser|WorkAdventure/i.test(m.text())) started = true; });
await page.goto(base + "/_/global/127.0.0.1/map.json", { waitUntil: "load" });
await page.waitForTimeout(25000);
const info = await page.evaluate(() => ({ title: document.title, bodyChildren: document.body.children.length, text: document.body.innerText.slice(0, 200) }));
console.log(`MODE ${mode} :: page`, JSON.stringify(info));
console.log(`MODE ${mode} :: ${errors.size} distinct errors`);
for (const e of [...errors].sort()) console.log("  " + e);
await browser.close();
server.close();
