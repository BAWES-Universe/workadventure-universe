import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the generated message types hang on these; the hello needs none of them
vi.mock("../../admin-api/orbitAccessToken", () => ({ freshOrbitAccessToken: vi.fn(() => Promise.resolve(null)) }));
vi.mock("../../../Chat/Components/Room/Details/NearbySaved", () => ({ savedNearbyPage: vi.fn() }));
vi.mock("../../../Notification/Push/PushChat", () => ({ ChatPusherSchema: {} }));
vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: { getAuthToken: vi.fn(() => null), setAuthToken: vi.fn() },
}));
vi.mock("../../../Connection/AxiosUtils", () => ({ axiosToPusher: { get: vi.fn() } }));

import { helloFailureOf } from "../voiceModel";
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
});
