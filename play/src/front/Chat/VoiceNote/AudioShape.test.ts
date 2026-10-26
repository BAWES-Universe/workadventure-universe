import { afterEach, describe, expect, it, vi } from "vitest";
import { readAudioShape } from "./AudioShape";

describe("reading the shape of an audio file", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("stops downloading a file over the limit even when the answer has no size header", async () => {
        const cancelled = vi.fn();
        let sent = 0;
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                sent++;
                controller.enqueue(new Uint8Array(1024 * 1024));
                if (sent > 50) controller.close();
            },
            cancel: cancelled,
        });
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response(body, { status: 200 })))
        );

        const shape = await readAudioShape("https://example.test/chunked-song.m4a");

        expect(shape).toBeUndefined();
        expect(cancelled).toHaveBeenCalled();
        // 10 MB is the limit: it stopped soon after, not after reading all 51 chunks.
        expect(sent).toBeLessThan(20);
    });

    it("does not download a file whose size header is over the limit", async () => {
        const cancelled = vi.fn();
        const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
        vi.stubGlobal(
            "fetch",
            vi.fn(() =>
                Promise.resolve(
                    new Response(body, { status: 200, headers: { "content-length": String(50 * 1024 * 1024) } })
                )
            )
        );

        expect(await readAudioShape("https://example.test/big.m4a")).toBeUndefined();
        expect(cancelled).toHaveBeenCalled();
    });

    it("reads the length and shape of a small file that has no size header", async () => {
        const decoded = vi.fn(() =>
            Promise.resolve({ duration: 4, getChannelData: () => new Float32Array(1000).fill(0.5) })
        );
        vi.stubGlobal(
            "OfflineAudioContext",
            class {
                decodeAudioData = decoded;
            }
        );
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response(new Uint8Array(2048), { status: 200 })))
        );

        const shape = await readAudioShape("https://example.test/small.m4a");

        expect(shape?.duration).toBe(4);
        expect(shape?.levels.length).toBeGreaterThan(0);
        expect(decoded).toHaveBeenCalledTimes(1);
    });
});
