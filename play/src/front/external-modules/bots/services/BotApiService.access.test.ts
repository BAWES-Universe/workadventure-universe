import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BotApiService } from "./BotApiService";

vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: { getAuthToken: () => null, setAuthToken: vi.fn() },
}));
vi.mock("../../../Connection/AxiosUtils", () => ({ axiosToPusher: { get: vi.fn() } }));

const ORBIT = "https://orbit.test";
const BOTS = "https://bots.test";
const SESSION = `orb_sess_v2_${"c".repeat(64)}`;

function service(): BotApiService {
    const api = new BotApiService();
    api.initialize("header.e30.signature", ORBIT, "room-1", BOTS);
    // The Orbit session is not what is under test
    vi.spyOn(
        api as unknown as { getAdminApiSessionToken: () => Promise<string> },
        "getAdminApiSessionToken"
    ).mockResolvedValue(SESSION);
    return api;
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("asking whether the player may use a bot", () => {
    beforeEach(() => {
        sessionStorage.clear();
        vi.restoreAllMocks();
    });

    it("says yes and no, with the owner's line for no", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch");
        fetchMock.mockResolvedValueOnce(json({ allowed: true }));
        await expect(service().getBotAccess("b1", "summon")).resolves.toEqual({ allowed: true });
        expect(fetchMock).toHaveBeenCalledWith(
            `${BOTS}/api/bots/b1/access`,
            expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "summon" }) })
        );

        fetchMock.mockResolvedValueOnce(
            json({ allowed: false, code: "not_allowed", reason: "Nora's owner limits who can call it over" })
        );
        await expect(service().getBotAccess("b1", "summon")).resolves.toEqual({
            allowed: false,
            reason: "Nora's owner limits who can call it over",
        });
    });

    it("does not know when it cannot find out, so the caller keeps showing the button", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch");
        fetchMock.mockResolvedValueOnce(json({ error: "x", code: "cannot_check" }, 503));
        await expect(service().getBotAccess("b1", "summon")).resolves.toEqual({ allowed: null });
        fetchMock.mockRejectedValueOnce(new TypeError("network"));
        await expect(service().getBotAccess("b1", "summon")).resolves.toEqual({ allowed: null });
        fetchMock.mockResolvedValueOnce(json({ nonsense: true }));
        await expect(service().getBotAccess("b1", "summon")).resolves.toEqual({ allowed: null });
    });
});

describe("a bot server that does not answer", () => {
    beforeEach(() => {
        sessionStorage.clear();
        vi.restoreAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("is 'unknown' after a few seconds, so the Summon button is not held back, and the request is cancelled", async () => {
        let signal: AbortSignal | undefined;
        vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
            signal = init?.signal ?? undefined;
            return new Promise<Response>(() => {
                // never answers
            });
        });

        const asked = service().getBotAccess("b1", "summon");
        await vi.advanceTimersByTimeAsync(3000);

        await expect(asked).resolves.toEqual({ allowed: null });
        expect(signal?.aborted).toBe(true);
    });
});

describe("summoning a bot the owner limits", () => {
    beforeEach(() => {
        sessionStorage.clear();
        vi.restoreAllMocks();
    });

    it("hands back the owner's line as it is, as a not_allowed failure", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
            json({ summoned: false, error: "Nora's owner limits who can call it over", code: "not_allowed" }, 403)
        );
        await expect(service().summonBot("b1", "u1", 1, 2)).resolves.toEqual({
            summoned: false,
            failure: "not_allowed",
            reason: "Nora's owner limits who can call it over",
        });
    });

    it("hands back the can't-check line too", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
            json(
                { summoned: false, error: "Nora can't check that right now. Try again soon.", code: "cannot_check" },
                503
            )
        );
        await expect(service().summonBot("b1", "u1", 1, 2)).resolves.toEqual({
            summoned: false,
            failure: "cannot_check",
            reason: "Nora can't check that right now. Try again soon.",
        });
    });

    it("leaves every other failure as it was, with no owner line", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ error: "Bot not found or not spawned" }, 404));
        await expect(service().summonBot("b1", "u1", 1, 2)).resolves.toEqual({ summoned: false, failure: "not_here" });
    });
});

describe("saving who may use a bot", () => {
    beforeEach(() => {
        sessionStorage.clear();
        vi.restoreAllMocks();
    });

    it("sends only what changed, to Orbit", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValue(json({ privateBot: true, rules: [], roles: [] }));
        const saved = await service().saveBotPermissions("b1", { privateBot: true });
        expect(saved.privateBot).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith(
            `${ORBIT}/api/bots/b1/permissions`,
            expect.objectContaining({ method: "PUT", body: JSON.stringify({ privateBot: true }) })
        );
    });

    it("names the subject and only the actions set when saving a rule", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValue(json({ id: "r1", roleId: "role-1", chat: "no" }));
        const rule = await service().saveBotRule("b1", { roleId: "role-1" }, { chat: "no" });
        expect(rule.chat).toBe("no");
        expect(fetchMock).toHaveBeenCalledWith(
            `${ORBIT}/api/bots/b1/permissions/rules`,
            expect.objectContaining({ method: "PUT", body: JSON.stringify({ roleId: "role-1", chat: "no" }) })
        );
    });

    it("takes a row off by role or by person", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ ok: true }));
        await service().deleteBotRule("b1", { roleId: "role 1" });
        await service().deleteBotRule("b1", { userId: "u1" });
        expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
            `${ORBIT}/api/bots/b1/permissions/rules?roleId=role%201`,
            `${ORBIT}/api/bots/b1/permissions/rules?userId=u1`,
        ]);
    });

    it("fails loudly when Orbit refuses, with Orbit's line", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ error: "The bot's owner always has access" }, 400));
        await expect(service().saveBotRule("b1", { userId: "u1" }, { chat: "no" })).rejects.toThrow(
            "The bot's owner always has access"
        );
    });
});
