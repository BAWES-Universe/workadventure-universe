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

const answer = (status: number, body: unknown = { error: "no" }) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("the lists Orbit may not have yet (#2001)", () => {
    beforeEach(() => {
        sessionStorage.clear();
        vi.restoreAllMocks();
    });
    afterEach(() => vi.restoreAllMocks());

    it("reads a 404 from the ready-made apps as an empty list, and any other failure as a failure", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(answer(404)));
        await expect(service().getReadyMadeApps()).resolves.toEqual({ apps: [] });
        fetchMock.mockImplementation(() => Promise.resolve(answer(500)));
        await expect(service().getReadyMadeApps()).rejects.toMatchObject({ status: 500 });
    });

    it("reads a 404 from the Instant Apps as an empty list, and any other failure as a failure", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(answer(404)));
        await expect(service().getInstantApps()).resolves.toEqual({ apps: [] });
        fetchMock.mockImplementation(() => Promise.resolve(answer(503)));
        await expect(service().getInstantApps()).rejects.toMatchObject({ status: 503 });
    });
});
