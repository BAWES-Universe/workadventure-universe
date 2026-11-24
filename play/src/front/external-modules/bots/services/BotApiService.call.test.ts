import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BotApiService } from "./BotApiService";

vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: { getAuthToken: () => null, setAuthToken: vi.fn() },
}));
vi.mock("../../../Connection/AxiosUtils", () => ({ axiosToPusher: { get: vi.fn() } }));

const SESSION = `orb_sess_v2_${"c".repeat(64)}`;
const SIGNED_IN = `header.${btoa(JSON.stringify({ accessToken: "access-1" }))}.signature`;

function service(): BotApiService {
    const api = new BotApiService();
    api.initialize(SIGNED_IN, "https://orbit.test", "room-1", "https://bots.test");
    vi.spyOn(
        api as unknown as { getAdminApiSessionToken: () => Promise<string> },
        "getAdminApiSessionToken"
    ).mockResolvedValue(SESSION);
    return api;
}

const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

describe("calling a Brick names the call (#2004)", () => {
    beforeEach(() => vi.restoreAllMocks());
    afterEach(() => vi.restoreAllMocks());

    it("sends the call's id with the start and with the hang-up, so the server ends only that call", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockImplementation(() => Promise.resolve(json({ started: true, spaceName: "call__x", ended: true })));
        const api = service();
        await expect(api.startCall("b1", "uuid-1", "call-1234-5678")).resolves.toEqual({
            started: true,
            spaceName: "call__x",
        });
        await expect(api.endCall("b1", "uuid-1", "call-1234-5678")).resolves.toBe(true);
        const bodies = fetchMock.mock.calls.map(([url, init]) => [
            typeof url === "string" ? url : "",
            JSON.parse(init?.body as string),
        ]);
        expect(bodies).toEqual([
            ["https://bots.test/api/bots/b1/call", { playerUuid: "uuid-1", callId: "call-1234-5678" }],
            ["https://bots.test/api/bots/b1/call/end", { playerUuid: "uuid-1", callId: "call-1234-5678" }],
        ]);
    });
});
