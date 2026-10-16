// Single-origin gateway for the local safety-net stack (stands in for Traefik in docker-compose):
//   /ws/*            -> pusher websocket server (3003)
//   /iframe_api.js   -> scripting API bundle built into STATE_DIR/iframe-api
//   everything else  -> pusher HTTP server (3002)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const STATE_DIR = process.env.STATE_DIR;
const require = createRequire(import.meta.url);
const httpProxy = require("http-proxy");

const PORT = Number(process.env.GATEWAY_PORT || 8000);
const PUSHER_HTTP = "http://127.0.0.1:3002";
const PUSHER_WS = "http://127.0.0.1:3003";
const IFRAME_API_DIR = path.join(STATE_DIR, "iframe-api");

const proxy = httpProxy.createProxyServer({ xfwd: true, ws: true });
proxy.on("error", (err, req, res) => {
    console.error("[gateway] proxy error", req?.url, err.message);
    try {
        if (res && typeof res.writeHead === "function" && !res.headersSent) {
            res.writeHead(502, { "Content-Type": "text/plain" });
            res.end("Bad gateway: " + err.message);
        } else if (res && typeof res.destroy === "function") {
            res.destroy();
        }
    } catch {
        // socket already gone
    }
});

const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/iframe_api.js" || url.pathname === "/iframe_api.js.map") {
        fs.readFile(path.join(IFRAME_API_DIR, path.basename(url.pathname)), (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end("iframe_api.js not built: run stack.sh setup");
                return;
            }
            res.writeHead(200, {
                "Content-Type": url.pathname.endsWith(".map") ? "application/json" : "application/javascript",
                "Cache-Control": "no-cache",
                "Access-Control-Allow-Origin": "*",
            });
            res.end(data);
        });
        return;
    }
    proxy.web(req, res, { target: PUSHER_HTTP });
});

server.on("upgrade", (req, socket, head) => {
    if (req.url.startsWith("/ws/")) {
        proxy.ws(req, socket, head, { target: PUSHER_WS });
    } else {
        socket.destroy();
    }
});

server.listen(PORT, "127.0.0.1", () => console.log(`[gateway] listening on http://localhost:${PORT}`));
