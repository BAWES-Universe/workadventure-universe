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

    it("tries a file again when it could not be fetched, but not one the browser cannot decode", async () => {
        // The module keeps its decoder: a fresh copy picks up this test's.
        vi.resetModules();
        const { readAudioShape } = await import("./AudioShape");
        const decodable = vi.fn(() =>
            Promise.resolve({ duration: 2, getChannelData: () => new Float32Array(1000).fill(0.5) })
        );
        const decoding = vi.fn(decodable);
        vi.stubGlobal(
            "OfflineAudioContext",
            class {
                decodeAudioData = decoding;
            }
        );
        const fetching = vi
            .fn()
            .mockRejectedValueOnce(new Error("offline"))
            .mockImplementation(() => Promise.resolve(new Response(new Uint8Array(2048), { status: 200 })));
        vi.stubGlobal("fetch", fetching);

        expect(await readAudioShape("https://example.test/retry.m4a")).toBeUndefined();
        expect((await readAudioShape("https://example.test/retry.m4a"))?.duration).toBe(2);

        decoding.mockRejectedValueOnce(new Error("cannot decode"));
        expect(await readAudioShape("https://example.test/broken.m4a")).toBeUndefined();
        expect(await readAudioShape("https://example.test/broken.m4a")).toBeUndefined();
        // retry.m4a fetched twice, broken.m4a once: an undecodable file is remembered.
        expect(fetching).toHaveBeenCalledTimes(3);
    });

    it("gives up on a download that stalls, so the notes behind it are still read", async () => {
        vi.resetModules();
        const { readAudioShape } = await import("./AudioShape");
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        try {
            vi.stubGlobal(
                "OfflineAudioContext",
                class {
                    decodeAudioData = () =>
                        Promise.resolve({ duration: 3, getChannelData: () => new Float32Array(1000).fill(0.5) });
                }
            );
            vi.stubGlobal(
                "fetch",
                vi.fn((url: string, init?: RequestInit) =>
                    url.includes("stalled")
                        ? new Promise((_, reject) => {
                              const signal = init?.signal;
                              const onAbort = () => {
                                  signal?.removeEventListener("abort", onAbort);
                                  reject(new Error("aborted"));
                              };
                              signal?.addEventListener("abort", onAbort);
                          })
                        : Promise.resolve(new Response(new Uint8Array(2048), { status: 200 }))
                )
            );

            const stalled = readAudioShape("https://example.test/stalled.m4a");
            const next = readAudioShape("https://example.test/next-one.m4a");
            await vi.advanceTimersByTimeAsync(20_001);

            expect(await stalled).toBeUndefined();
            expect((await next)?.duration).toBe(3);
        } finally {
            vi.useRealTimers();
        }
    });
});
