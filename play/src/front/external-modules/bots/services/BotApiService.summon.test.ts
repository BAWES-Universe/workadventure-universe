import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BotApiService } from "./BotApiService";

vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: { getAuthToken: vi.fn(() => null), setAuthToken: vi.fn() },
}));

vi.mock("../../../Connection/AxiosUtils", () => ({
    axiosToPusher: { get: vi.fn() },
}));

const SESSION = `orb_sess_v2_${"a".repeat(64)}`;

function jwtWith(payload: Record<string, unknown>): string {
    const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, "");
    return `${encode({ alg: "none" })}.${encode(payload)}.sig`;
}

function reply(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("BotApiService.summonBot", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        sessionStorage.clear();
        fetchMock.mockReset();
        vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function guestService(): BotApiService {
        const service = new BotApiService();
        // A guest: a game token with no OIDC access token inside, and no Orbit session.
        service.initialize(
            jwtWith({ identifier: "guest-uuid" }),
            undefined,
            "https://play.example.com/@/u/w/r",
            "https://bots.example.com"
        );
        return service;
    }

    it("summons for a guest with the game token alone, and asks for no Orbit session", async () => {
        fetchMock.mockResolvedValue(reply(200, { summoned: true, targetPosition: { x: 1, y: 2 } }));
        const result = await guestService().summonBot("b1", "guest-uuid", 1, 2);

        expect(result).toEqual({ summoned: true });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://bots.example.com/api/bots/b1/summon");
        expect(init.headers["X-WA-Auth"]).toBeTruthy();
        expect(init.headers.Authorization).toBeUndefined();
        expect(JSON.parse(init.body).playerUuid).toBe("guest-uuid");
    });

    it("asks a guest whether they may summon with the game token alone, so a limited bot hides Summon from them too", async () => {
        fetchMock.mockResolvedValue(reply(200, { allowed: false, code: "not_allowed", reason: "Limited" }));
        const result = await guestService().getBotAccess("b1", "summon");

        expect(result).toEqual({ allowed: false, reason: "Limited" });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://bots.example.com/api/bots/b1/access");
        expect(init.headers["X-WA-Auth"]).toBeTruthy();
        expect(init.headers.Authorization).toBeUndefined();
    });

    it("tells a guest the owner limits who can summon the bot, in the owner's line", async () => {
        fetchMock.mockResolvedValue(
            reply(403, { summoned: false, error: "Nora's owner limits who can summon it.", code: "not_allowed" })
        );
        await expect(guestService().summonBot("b1", "guest-uuid", 1, 2)).resolves.toEqual({
            summoned: false,
            failure: "not_allowed",
            reason: "Nora's owner limits who can summon it.",
        });
    });

    it("keeps sending the Orbit session for a signed-in player", async () => {
        const service = new BotApiService();
        service.initialize(
            jwtWith({ identifier: "a@b.c" }),
            undefined,
            "https://play.example.com/@/u/w/r",
            "https://bots.example.com"
        );
        sessionStorage.setItem("orbit_admin_session_v2", SESSION);
        sessionStorage.setItem("orbit_admin_session_v2_expires", String(Date.now() + 60 * 60 * 1000));
        fetchMock.mockResolvedValue(reply(200, { summoned: true }));

        expect(await service.summonBot("b1", "uuid-1", 1, 2)).toEqual({ summoned: true });
        const [, init] = fetchMock.mock.calls[0];
        expect(init.headers.Authorization).toBe(`Bearer ${SESSION}`);
        expect(init.headers["X-WA-Auth"]).toBeTruthy();
    });

    it.each([
        [
            409,
            { summoned: false, reason: "The bot cannot see you in its room", code: "cannot_see_you" },
            "cannot_see_you",
        ],
        [409, { summoned: false, reason: "busy", code: "busy" }, "busy"],
        [409, { summoned: false, reason: "busy", code: "already_with_you" }, "already_with_you"],
        [404, { error: "Bot not found or not spawned", code: "not_here" }, "not_here"],
        [500, { error: "boom", code: "failed" }, "failed"],
        [403, { error: "You can only summon a bot to yourself", code: "not_you" }, "sign_in"],
    ])("hands back why a %s refusal happened (%j) instead of nothing", async (status, body, failure) => {
        fetchMock.mockResolvedValue(reply(status, body));
        expect(await guestService().summonBot("b1", "guest-uuid", 1, 2)).toEqual({ summoned: false, failure });
    });

    it("classifies a refused game token as sign_in (a guest is shown the plain could-not-reach line for it)", async () => {
        fetchMock.mockResolvedValue(reply(401, { error: "Invalid game token" }));
        expect(await guestService().summonBot("b1", "guest-uuid", 1, 2)).toEqual({
            summoned: false,
            failure: "sign_in",
        });
    });

    it("hands back a failure when the bot server cannot be reached", async () => {
        fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
        expect(await guestService().summonBot("b1", "guest-uuid", 1, 2)).toEqual({
            summoned: false,
            failure: "failed",
        });
    });

    it("hands back a failure when the bot server answers summoned: false with a 200", async () => {
        fetchMock.mockResolvedValue(reply(200, { summoned: false }));
        expect(await guestService().summonBot("b1", "guest-uuid", 1, 2)).toEqual({
            summoned: false,
            failure: "failed",
        });
    });

    it("hands back a failure when the bot server address was refused as unsafe", async () => {
        const service = new BotApiService();
        service.initialize(
            jwtWith({ identifier: "guest-uuid" }),
            undefined,
            "https://play.example.com/@/u/w/r",
            "http://bots.example.com"
        );
        expect(await service.summonBot("b1", "guest-uuid", 1, 2)).toEqual({ summoned: false, failure: "failed" });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
