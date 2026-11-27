import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BotApiService } from "./BotApiService";

vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: { getAuthToken: () => null, setAuthToken: vi.fn() },
}));
vi.mock("../../../Connection/AxiosUtils", () => ({ axiosToPusher: { get: vi.fn() } }));

const ORBIT = "https://orbit.test";
const SESSION = `orb_sess_v2_${"c".repeat(64)}`;

function service(): BotApiService {
    const api = new BotApiService();
    api.initialize("header.e30.signature", ORBIT, "room-1", "https://bots.test");
    vi.spyOn(
        api as unknown as { getAdminApiSessionToken: () => Promise<string> },
        "getAdminApiSessionToken"
    ).mockResolvedValue(SESSION);
    return api;
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("making a new Brick (New Bricks per hour)", () => {
    beforeEach(() => {
        sessionStorage.clear();
        vi.restoreAllMocks();
    });
    afterEach(() => vi.restoreAllMocks());

    it("sends the request key with the Brick, so a repeat of the same request gives back the first one", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ brick: { id: "b1" } }, 201));
        await service().makeMyBrick({ name: "Teal Brick", characterTextureId: "brick-teal", requestKey: "key-1" });
        expect(fetchMock).toHaveBeenCalledWith(
            `${ORBIT}/api/bricks`,
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({ name: "Teal Brick", characterTextureId: "brick-teal", requestKey: "key-1" }),
            })
        );
    });

    it("throws Orbit's refusal for the hour's limit with its status, code and the time they can make another", async () => {
        const line = "You've made a lot of Bricks this hour. Try again at 3:40 PM.";
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
            json({ error: line, code: "new_bricks_limit", retryAt: "2026-11-21T12:40:00.000Z" }, 429)
        );
        await expect(service().makeMyBrick({ name: "Teal Brick" })).rejects.toMatchObject({
            message: line,
            status: 429,
            code: "new_bricks_limit",
            retryAt: "2026-11-21T12:40:00.000Z",
        });
    });
});
