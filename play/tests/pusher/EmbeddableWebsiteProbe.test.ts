import http from "node:http";
import net from "node:net";
import type { AddressInfo, LookupFunction } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { probeEmbeddableWebsite } from "../../src/pusher/services/EmbeddableWebsiteProbe";
import { parsePreviewableUrl } from "../../src/pusher/services/LinkPreviewService";

let server: http.Server;
let port: number;
const requests: string[] = [];

beforeAll(async () => {
    server = http.createServer((request, response) => {
        requests.push(`${request.method} ${request.url}`);
        switch (request.url) {
            case "/ok":
                response.writeHead(200, { "Content-Type": "text/html" });
                break;
            case "/deny":
                response.writeHead(200, { "X-Frame-Options": "DENY" });
                break;
            case "/no-head":
                response.writeHead(request.method === "HEAD" ? 405 : 200, { "X-Frame-Options": "SAMEORIGIN" });
                break;
            case "/to-deny":
                response.writeHead(302, { Location: "/deny" });
                break;
            case "/to-metadata":
                response.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" });
                break;
            case "/to-localhost":
                response.writeHead(302, { Location: "http://localhost/admin" });
                break;
            case "/linkedin":
                response.writeHead(999);
                break;
            default:
                response.writeHead(404);
        }
        response.end(request.method === "HEAD" ? undefined : "<html></html>");
    });
    await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
    });
    port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
    await new Promise((resolve) => {
        server.close(resolve);
    });
});

beforeEach(() => {
    requests.length = 0;
});

describe("probeEmbeddableWebsite, with the real address guard", () => {
    it.each([
        () => `http://127.0.0.1:${port}/ok`,
        () => "http://127.0.0.1/",
        () => "http://localhost/",
        () => "http://169.254.169.254/latest/meta-data/",
        () => "http://10.0.0.5/",
        () => "http://redis/",
        () => "file:///etc/passwd",
        () => "not a url",
    ])("refuses an internal address without fetching it (%#)", async (url) => {
        expect(await probeEmbeddableWebsite(url())).toEqual({
            state: false,
            embeddable: false,
            message: "URL is not reachable",
        });
        expect(requests).toEqual([]);
    });
});

describe("probeEmbeddableWebsite, when a name passes the URL check", () => {
    it("still refuses it when DNS points it at an internal address", async () => {
        const passEverything = (raw: string) => new URL(raw);
        expect(await probeEmbeddableWebsite(`http://localhost:${port}/ok`, { parseUrl: passEverything })).toEqual({
            state: false,
            embeddable: false,
            message: "URL is not reachable",
        });
        expect(requests).toEqual([]);
    });
});

describe("probeEmbeddableWebsite, against a stand-in public site", () => {
    // public.test stands for a public site: it passes the URL check and resolves to the local test server.
    const options = {
        parseUrl: (raw: string) => {
            const url = new URL(raw);
            return url.hostname === "public.test" ? url : parsePreviewableUrl(raw);
        },
        lookup: ((hostname, lookupOptions, callback) => {
            const done = callback as (error: Error | null, address: unknown, family?: number) => void;
            if (hostname !== "public.test") {
                done(new Error(`unexpected lookup of ${hostname}`), "", 4);
                return;
            }
            if (lookupOptions.all) {
                done(null, [{ address: "127.0.0.1", family: 4 }]);
                return;
            }
            done(null, "127.0.0.1", 4);
        }) as LookupFunction,
    };
    const site = (path: string) => `http://public.test:${port}${path}`;

    it("says a site without frame headers can be framed", async () => {
        expect(await probeEmbeddableWebsite(site("/ok"), options)).toEqual({ state: true, embeddable: true });
        expect(requests).toEqual(["HEAD /ok"]);
    });

    it("says a site with X-Frame-Options DENY can't be framed", async () => {
        expect(await probeEmbeddableWebsite(site("/deny"), options)).toEqual({ state: true, embeddable: false });
    });

    it("asks with GET when HEAD is not allowed", async () => {
        expect(await probeEmbeddableWebsite(site("/no-head"), options)).toEqual({ state: true, embeddable: false });
        expect(requests).toEqual(["HEAD /no-head", "GET /no-head"]);
    });

    it("follows a redirect to an allowed address", async () => {
        expect(await probeEmbeddableWebsite(site("/to-deny"), options)).toEqual({ state: true, embeddable: false });
        expect(requests).toEqual(["HEAD /to-deny", "HEAD /deny"]);
    });

    it.each(["/to-metadata", "/to-localhost"])("doesn't follow %s to an internal address", async (path) => {
        expect(await probeEmbeddableWebsite(site(path), options)).toEqual({
            state: false,
            embeddable: false,
            message: "URL is not reachable",
        });
        expect(requests).toEqual([`HEAD ${path}`]);
    });

    it("gives up on a server that drips its headers slower than the time limit", async () => {
        // The socket lives only for this test: its listeners go with it.
        /* eslint-disable listeners/no-missing-remove-event-listener, listeners/no-inline-function-event-listener */
        const dripping = net.createServer((socket) => {
            socket.on("error", () => {});
            socket.write("HTTP/1.1 200 OK\r\n");
            const timer = setInterval(() => socket.write("X-Drip: 1\r\n"), 20);
            socket.on("close", () => clearInterval(timer));
        });
        /* eslint-enable listeners/no-missing-remove-event-listener, listeners/no-inline-function-event-listener */
        await new Promise<void>((resolve) => {
            dripping.listen(0, "127.0.0.1", resolve);
        });
        const dripPort = (dripping.address() as AddressInfo).port;
        const started = Date.now();
        expect(await probeEmbeddableWebsite(`http://public.test:${dripPort}/`, { ...options, timeoutMs: 300 })).toEqual(
            {
                state: false,
                embeddable: false,
                message: "URL is not reachable",
            }
        );
        expect(Date.now() - started).toBeLessThan(2000);
        await new Promise((resolve) => {
            dripping.close(resolve);
        });
    });

    it("keeps LinkedIn's 999 as reachable but not embeddable", async () => {
        expect(await probeEmbeddableWebsite(site("/linkedin"), options)).toEqual({ state: true, embeddable: false });
    });
});
