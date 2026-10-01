import http from "node:http";
import dns from "node:dns";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
    isBlockedAddress,
    LinkPreviewService,
    linkPreviewService,
    parsePreviewableUrl,
    parsePreviewTags,
} from "../../src/pusher/services/LinkPreviewService";

describe("isBlockedAddress", () => {
    it.each([
        "127.0.0.1",
        "10.1.2.3",
        "172.20.0.5",
        "192.168.1.1",
        "169.254.169.254",
        "100.64.0.1",
        "0.0.0.0",
        "224.0.0.1",
        "::1",
        "::",
        "fd12::1",
        "fe80::1",
        "::ffff:127.0.0.1",
        "::ffff:7f00:1",
        "::ffff:a9fe:a9fe",
    ])("blocks %s", (address) => {
        expect(isBlockedAddress(address)).toBe(true);
    });

    it.each(["1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows %s", (address) => {
        expect(isBlockedAddress(address)).toBe(false);
    });
});

describe("parsePreviewableUrl", () => {
    it("accepts public http(s) pages and drops the fragment", () => {
        expect(parsePreviewableUrl("https://bawes.net/about#team")?.toString()).toBe("https://bawes.net/about");
    });

    it.each([
        "ftp://bawes.net/",
        "file:///etc/passwd",
        "http://localhost/",
        "http://127.0.0.1/",
        "http://[::1]/",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5/",
        "http://user:pass@bawes.net/",
        "http://bawes.net:6379/",
        "http://redis/",
        "http://metadata.google.internal/",
        "http://printer.local/",
        "not a url",
    ])("refuses %s", (url) => {
        expect(parsePreviewableUrl(url)).toBeUndefined();
    });
});

describe("parsePreviewTags", () => {
    const page = new URL("https://bawes.net/blog/post");

    it("reads Open Graph tags and resolves a relative image", () => {
        const preview = parsePreviewTags(
            `<html><head>
                <title>Fallback title</title>
                <meta property="og:site_name" content="BAWES">
                <meta property="og:title" content="  Universe   launch ">
                <meta property="og:description" content="A virtual office.">
                <meta property="og:image" content="/img/cover.png">
            </head></html>`,
            page
        );
        expect(preview).toEqual({
            siteName: "BAWES",
            title: "Universe launch",
            description: "A virtual office.",
            image: "https://bawes.net/img/cover.png",
        });
    });

    it("falls back to the page title, meta description and host name", () => {
        const preview = parsePreviewTags(
            `<html><head><title>Plain page</title><meta name="description" content="Words."></head></html>`,
            new URL("https://www.example.com/")
        );
        expect(preview).toEqual({
            siteName: "example.com",
            title: "Plain page",
            description: "Words.",
            image: undefined,
        });
    });

    it("ignores images that aren't http(s)", () => {
        const preview = parsePreviewTags(
            `<meta property="og:image" content="javascript:alert(1)"><meta property="og:title" content="T">`,
            page
        );
        expect(preview.image).toBeUndefined();
    });
});

describe("LinkPreviewService", () => {
    it("loads each page once and refuses internal addresses without fetching", async () => {
        const load = vi.fn((url: URL) => Promise.resolve({ url: url.toString(), siteName: "bawes.net", title: "B" }));
        const service = new LinkPreviewService(load);

        await service.getPreview("https://bawes.net/");
        await service.getPreview("https://bawes.net/");
        await expect(service.getPreview("http://127.0.0.1:8080/")).rejects.toThrow();

        expect(load).toHaveBeenCalledTimes(1);
    });

    describe("fetching", () => {
        let server: http.Server;
        let port: number;

        beforeAll(async () => {
            server = http.createServer((req, res) => {
                res.setHeader("Content-Type", "text/html");
                res.end(`<meta property="og:title" content="Internal secret">`);
            });
            await new Promise<void>((resolve) => {
                server.listen(0, "127.0.0.1", resolve);
            });
            port = (server.address() as AddressInfo).port;
        });

        afterAll(async () => {
            await new Promise<void>((resolve) => {
                server.close(() => resolve());
            });
        });

        it("refuses a public-looking host that resolves to an internal address (DNS rebinding)", async () => {
            const lookup = vi
                .spyOn(dns, "lookup")
                .mockImplementation(((
                    _hostname: string,
                    _options: unknown,
                    callback: (error: null, addresses: dns.LookupAddress[]) => void
                ) => callback(null, [{ address: "127.0.0.1", family: 4 }])) as unknown as typeof dns.lookup);
            try {
                await expect(new LinkPreviewService().getPreview("http://rebind.example.com/")).rejects.toThrow(
                    /private or reserved/
                );
            } finally {
                lookup.mockRestore();
            }
        });

        it("never reaches a server on a loopback address", async () => {
            await expect(linkPreviewService.getPreview(`http://127.0.0.1:${port}/`)).rejects.toThrow();
            await expect(linkPreviewService.getPreview("http://localhost/")).rejects.toThrow();
        });
    });
});
