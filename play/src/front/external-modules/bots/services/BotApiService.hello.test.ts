import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the generated message types hang on these; the hello needs none of them
vi.mock("../../admin-api/orbitAccessToken", () => ({ freshOrbitAccessToken: vi.fn(() => Promise.resolve(null)) }));
vi.mock("../../../Chat/Components/Room/Details/NearbySaved", () => ({ savedNearbyPage: vi.fn() }));
vi.mock("../../../Notification/Push/PushChat", () => ({ ChatPusherSchema: {} }));
vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: { getAuthToken: vi.fn(() => null), setAuthToken: vi.fn() },
}));
vi.mock("../../../Connection/AxiosUtils", () => ({ axiosToPusher: { get: vi.fn() } }));

import { helloFailureOf, voiceNameFailureOf } from "../voiceModel";
import { BotApiService } from "./BotApiService";

const SESSION = `orb_sess_v2_${"a".repeat(64)}`;

function jwtWith(payload: Record<string, unknown>): string {
    const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, "");
    return `${encode({ alg: "none" })}.${encode(payload)}.sig`;
}

const reply = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("BotApiService.sayBotHello (#1852)", () => {
    const fetchMock = vi.fn();
    const urls: Blob[] = [];

    beforeEach(() => {
        sessionStorage.clear();
        fetchMock.mockReset();
        urls.length = 0;
        vi.stubGlobal("fetch", fetchMock);
        URL.createObjectURL = (blob: Blob | MediaSource) => {
            urls.push(blob as Blob);
            return `blob:hello-${urls.length}`;
        };
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function service(): BotApiService {
        const api = new BotApiService();
        api.initialize(
            jwtWith({ identifier: "maker-uuid" }),
            "https://orbit.example.com",
            "https://play.example.com/@/u/w/r",
            "https://bots.example.com"
        );
        // The Orbit session the page signed in with
        sessionStorage.setItem("orbit_admin_session_v2", SESSION);
        sessionStorage.setItem("orbit_admin_session_v2_expires", String(Date.now() + 60 * 60 * 1000));
        return api;
    }

    it("asks the bot server for this bot's hello with the Orbit session and the game's language, and gives back the words and a playable address", async () => {
        const wav = Uint8Array.from([82, 73, 70, 70, 1, 2, 3]);
        fetchMock.mockResolvedValue(
            reply(200, {
                text: "Hello, Universe. This is how I sound.",
                mime: "audio/wav",
                audio: btoa(String.fromCharCode(...wav)),
                ms: 2300,
            })
        );
        const hello = await service().sayBotHello("b 1", "ar-SA");
        expect(hello).toEqual({ text: "Hello, Universe. This is how I sound.", url: "blob:hello-1" });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://bots.example.com/api/bots/b%201/voice/hello");
        expect(init.method).toBe("POST");
        expect(init.headers.Authorization).toBe(`Bearer ${SESSION}`);
        expect(JSON.parse(init.body)).toEqual({ locale: "ar-SA" });
        expect(urls[0].type).toBe("audio/wav");
        const bytes = await new Promise<Uint8Array>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
            reader.readAsArrayBuffer(urls[0]);
        });
        expect([...bytes]).toEqual([...wav]);
    });

    it("keeps what the bot server answered with a refusal, so the page can say until when, and what to do", async () => {
        fetchMock.mockResolvedValue(reply(429, { error: "used_up", resetsAt: "2026-11-06T18:40:00.000Z" }));
        const failure = await service()
            .sayBotHello("b1", "en-US")
            .catch((e: unknown) => e);
        expect(failure).toMatchObject({
            status: 429,
            body: { error: "used_up", resetsAt: "2026-11-06T18:40:00.000Z" },
        });
        expect(helloFailureOf(failure)).toEqual({ kind: "used-up", resetsAt: new Date("2026-11-06T18:40:00.000Z") });
    });

    it("does not take an answer it can't read for a hello", async () => {
        fetchMock.mockResolvedValue(reply(200, { text: "", audio: "" }));
        await expect(service().sayBotHello("b1", "en-US")).rejects.toThrow("can't read");
        expect(urls).toHaveLength(0);
    });

    it("says the voice name typed and where to hear it from, only when there is one (#1874)", async () => {
        const wav = btoa("RIFF....WAVE");
        fetchMock.mockImplementation(() =>
            Promise.resolve(reply(200, { text: "Hello, Universe.", mime: "audio/wav", audio: wav, ms: 1000 }))
        );
        const api = service();
        await api.sayBotHello("b1", "en-US", { voiceId: "bm_george" });
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ locale: "en-US", voiceId: "bm_george" });
        await api.sayBotHello("b1", "en-US", {
            voiceId: "bm_george",
            source: { providerId: "my-server", model: "kokoro" },
        });
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
            locale: "en-US",
            voiceId: "bm_george",
            source: { providerId: "my-server", model: "kokoro" },
        });
    });

    it("checks a typed name with the same hello and plays nothing (#1874)", async () => {
        fetchMock.mockResolvedValue(
            reply(200, { text: "Hello, Universe.", mime: "audio/wav", audio: btoa("RIFF....WAVE"), ms: 1000 })
        );
        await expect(service().checkBotVoiceName("b1", "en-US", { voiceId: "af_heart" })).resolves.toBeUndefined();
        expect(urls).toHaveLength(0);
        expect(fetchMock.mock.calls[0][0]).toBe("https://bots.example.com/api/bots/b1/voice/hello");
    });

    it("throws what the server answered when the check fails, so the page can tell a refused name from a silent server (#1874)", async () => {
        fetchMock.mockResolvedValue(reply(502, { error: "provider", providerStatus: 404, rejected: false }));
        const failure = await service()
            .checkBotVoiceName("b1", "en-US", { voiceId: "nope" })
            .catch((e: unknown) => e);
        expect(voiceNameFailureOf(failure)).toBe("rejected");
        fetchMock.mockResolvedValue(reply(503, { error: "unavailable" }));
        const silent = await service()
            .checkBotVoiceName("b1", "en-US", { voiceId: "nope" })
            .catch((e: unknown) => e);
        expect(voiceNameFailureOf(silent)).toBe("unreachable");
    });

    it("asks for a source's speaking voices, or its talking model's when told to (#1910)", async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(
                reply(200, [{ voiceId: "tiffany", name: "Tiffany", talk: true, model: "amazon.nova-2-sonic-v1:0" }])
            )
        );
        const api = service();
        await api.getBotVoices("b1", "key-aws");
        await expect(api.getBotVoices("b1", "key-aws", "talk")).resolves.toMatchObject([
            { voiceId: "tiffany", talk: true },
        ]);
        expect(String(fetchMock.mock.calls[0][0])).toMatch(
            /\/api\/bots\/b1\/voice\/voices\?part=speech&source=key-aws$/
        );
        expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/api\/bots\/b1\/voice\/voices\?part=talk&source=key-aws$/);
    });
});
