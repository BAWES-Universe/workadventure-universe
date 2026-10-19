/**
 * The address guard for an address a person typed (#374). It mirrors Orbit's lib/ai-key-fetch.ts: https and a name only,
 * every address the name gives must be public, the connection goes to the address that was checked, only the chat and
 * model paths, no redirect followed, a size cap.
 */

import { EventEmitter } from "events";
import { PassThrough } from "stream";
import https from "https";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("dns/promises", () => ({ lookup: vi.fn() }));
import { lookup } from "dns/promises";
import { AddressError, isPublicAddress, ownComputerFetch, parsePublicHttpsUrl } from "../ai/ownComputerFetch";

const lookupMock = lookup as unknown as ReturnType<typeof vi.fn>;

async function problem(run: () => unknown): Promise<string | null> {
    try {
        await run();
        return null;
    } catch (error) {
        return error instanceof AddressError ? error.problem : `other:${String(error)}`;
    }
}

describe("isPublicAddress", () => {
    it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"])("allows the public address %s", (ip) =>
        expect(isPublicAddress(ip)).toBe(true)
    );
    it.each([
        "0.0.0.0", "10.0.0.5", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.10", "198.18.0.1", "224.0.0.1",
        "::", "::1", "fc00::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "64:ff9b::7f00:1",
    ])("refuses the private, loopback or reserved address %s", (ip) => expect(isPublicAddress(ip)).toBe(false));
    it("refuses anything that is not an address", () => {
        expect(isPublicAddress("lm.example.com")).toBe(false);
        expect(isPublicAddress("")).toBe(false);
    });
});

describe("parsePublicHttpsUrl", () => {
    it("accepts an https name with a port, on the chat and model paths", () => {
        expect(parsePublicHttpsUrl("https://lm.example.com/v1/chat/completions").hostname).toBe("lm.example.com");
        expect(parsePublicHttpsUrl("https://random-words.trycloudflare.com:8443/v1/models").port).toBe("8443");
        expect(parsePublicHttpsUrl("https://nim.example.com/v1/chat/completions/").pathname).toBe("/v1/chat/completions/");
    });
    it.each([
        ["http://lm.example.com/v1/models", "not-https"],
        ["lm.example.com/v1/models", "not-https"],
        ["https://user:pass@lm.example.com/v1/models", "credentials"],
        ["https://127.0.0.1/v1/models", "not-a-name"],
        ["https://2130706433/v1/models", "not-a-name"],
        ["https://0x7f.0.0.1/v1/models", "not-a-name"],
        ["https://[::1]/v1/models", "not-a-name"],
        ["https://localhost/v1/models", "not-a-name"],
        ["https://app.localhost/v1/models", "not-a-name"],
        ["https://intranet/v1/models", "not-a-name"],
        ["https://lm.example.com/admin", "path"],
        ["https://lm.example.com/", "path"],
        ["https://lm.example.com/v1/files", "path"],
    ])("refuses %s", async (raw, expected) => {
        expect(await problem(() => parsePublicHttpsUrl(raw))).toBe(expected);
    });
});

describe("ownComputerFetch", () => {
    let requestSpy: ReturnType<typeof vi.spyOn>;
    let seen: any;
    let written: string[];

    function fakeServer(status: number, body: string, headers: Record<string, string> = {}) {
        requestSpy = vi.spyOn(https, "request").mockImplementation(((options: any, callback: (res: any) => void) => {
            seen = options;
            written = [];
            const req: any = Object.assign(new EventEmitter(), {
                destroy: vi.fn((error?: Error) => error && req.emit("error", error)),
                write: (chunk: string) => written.push(chunk),
                end: () => {
                    const res: any = new PassThrough();
                    res.statusCode = status;
                    res.statusMessage = "OK";
                    res.headers = headers;
                    callback(res);
                    res.end(body);
                },
            });
            return req;
        }) as never);
    }

    beforeEach(() => {
        lookupMock.mockReset();
    });
    afterEach(() => requestSpy?.mockRestore());

    it("connects only to the address that was checked, with the name kept for the certificate, and never looks the name up again", async () => {
        lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
        fakeServer(200, "data: hi\n\n", { "content-type": "text/event-stream" });
        const response = await ownComputerFetch("https://lm.example.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer k" },
            body: '{"a":1}',
        });
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("data: hi\n\n");
        expect(lookupMock).toHaveBeenCalledTimes(1);
        expect(seen.hostname).toBe("lm.example.com");
        expect(seen.servername).toBe("lm.example.com");
        expect(seen.method).toBe("POST");
        expect(seen.path).toBe("/v1/chat/completions");
        expect(seen.headers.authorization).toBe("Bearer k");
        expect(written).toEqual(['{"a":1}']);
        const single = vi.fn();
        seen.lookup("lm.example.com", {}, single);
        expect(single).toHaveBeenCalledWith(null, "93.184.216.34", 4);
        const all = vi.fn();
        seen.lookup("lm.example.com", { all: true }, all);
        expect(all).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
    });

    it("refuses a name that resolves to a private address, even when only one of its addresses is", async () => {
        fakeServer(200, "");
        for (const addresses of [
            [{ address: "192.168.1.20", family: 4 }],
            [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.7", family: 4 }],
            [{ address: "169.254.169.254", family: 4 }],
            [{ address: "::1", family: 6 }],
        ]) {
            lookupMock.mockResolvedValue(addresses);
            expect(await problem(() => ownComputerFetch("https://sneaky.example.com/v1/chat/completions"))).toBe("private");
        }
        expect(requestSpy).not.toHaveBeenCalled();
    });

    it("says a name that does not exist does not exist", async () => {
        lookupMock.mockImplementation(() => {
            throw new Error("ENOTFOUND");
        });
        expect(await problem(() => ownComputerFetch("https://nope.example.com/v1/models"))).toBe("unresolved");
    });

    it("looks nothing up for an address that is already refused", async () => {
        expect(await problem(() => ownComputerFetch("http://lm.example.com/v1/models"))).toBe("not-https");
        expect(await problem(() => ownComputerFetch("https://127.0.0.1/v1/models"))).toBe("not-a-name");
        expect(lookupMock).not.toHaveBeenCalled();
    });

    it("hands a redirect back and follows nothing", async () => {
        lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
        fakeServer(302, "", { location: "https://169.254.169.254/latest/meta-data" });
        const response = await ownComputerFetch("https://lm.example.com/v1/models");
        expect(response.status).toBe(302);
        expect(response.ok).toBe(false);
        expect(requestSpy).toHaveBeenCalledTimes(1);
    });

    it("stops an answer that grows past the cap", async () => {
        lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
        fakeServer(200, "x".repeat(100));
        const { MAX_RESPONSE_BYTES } = await import("../ai/ownComputerFetch");
        expect(MAX_RESPONSE_BYTES).toBe(20_000_000);
    });

    it("only limits getting connected: a model that is slow to start answering is not cut off", async () => {
        vi.useFakeTimers();
        try {
            lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
            let socket: any;
            let request: any;
            requestSpy = vi.spyOn(https, "request").mockImplementation((() => {
                request = Object.assign(new EventEmitter(), { destroy: vi.fn(), write: vi.fn(), end: vi.fn() });
                return request;
            }) as never);
            const pending = ownComputerFetch("https://lm.example.com/v1/chat/completions", { method: "POST", body: "{}" });
            await vi.advanceTimersByTimeAsync(0);
            socket = Object.assign(new EventEmitter(), { connecting: true, getProtocol: () => null });
            request.emit("socket", socket);
            // Connected and TLS done, then 30 seconds with no answer yet
            socket.connecting = false;
            socket.emit("secureConnect");
            await vi.advanceTimersByTimeAsync(30_000);
            expect(request.destroy).not.toHaveBeenCalled();
            request.emit("error", new Error("stop"));
            await expect(pending).rejects.toThrow("stop");
        } finally {
            vi.useRealTimers();
        }
    });

    it("still gives up when it cannot get connected", async () => {
        vi.useFakeTimers();
        try {
            lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
            let request: any;
            requestSpy = vi.spyOn(https, "request").mockImplementation((() => {
                request = Object.assign(new EventEmitter(), { destroy: vi.fn(), write: vi.fn(), end: vi.fn() });
                return request;
            }) as never);
            const pending = ownComputerFetch("https://lm.example.com/v1/models");
            pending.catch(() => {});
            await vi.advanceTimersByTimeAsync(0);
            request.emit("socket", Object.assign(new EventEmitter(), { connecting: true, getProtocol: () => null }));
            await vi.advanceTimersByTimeAsync(10_001);
            expect(request.destroy).toHaveBeenCalledWith(expect.objectContaining({ message: "Timed out connecting" }));
        } finally {
            vi.useRealTimers();
        }
    });

    it("rejects with an abort when the caller cancels", async () => {
        lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
        const controller = new AbortController();
        controller.abort();
        fakeServer(200, "");
        await expect(ownComputerFetch("https://lm.example.com/v1/models", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    });
});
