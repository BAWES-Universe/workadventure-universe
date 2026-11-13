import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BotApiService } from "./BotApiService";

vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: { getAuthToken: () => null, setAuthToken: vi.fn() },
}));
vi.mock("../../../Connection/AxiosUtils", () => ({ axiosToPusher: { get: vi.fn() } }));

const ORBIT = "https://orbit.test";
const BOTS = "https://bots.test";
const SESSION = `orb_sess_v2_${"c".repeat(64)}`;
const SIGNED_IN = `header.${btoa(JSON.stringify({ accessToken: "access-1" }))}.signature`;

function service(jwt: string): BotApiService {
    const api = new BotApiService();
    api.initialize(jwt, ORBIT, "room-1", BOTS);
    vi.spyOn(
        api as unknown as { getAdminApiSessionToken: () => Promise<string> },
        "getAdminApiSessionToken"
    ).mockResolvedValue(SESSION);
    return api;
}

const ok = () =>
    new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });

describe("keeping the player's time zone in Orbit", () => {
    beforeEach(() => {
        sessionStorage.clear();
        vi.restoreAllMocks();
    });
    afterEach(() => vi.restoreAllMocks());

    it("sends the zone the device is in, once, for a signed-in player", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok());
        const api = service(SIGNED_IN);
        await api.keepTimeZone();
        await api.keepTimeZone();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${ORBIT}/api/me/preferences`);
        expect(init?.method).toBe("PUT");
        expect(JSON.parse(String(init?.body))).toEqual({
            key: "timeZone",
            value: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
    });

    it("sends nothing for a guest", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok());
        await service("header.e30.signature").keepTimeZone();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("never fails loudly when Orbit says no", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "no" }), { status: 400 }));
        await expect(service(SIGNED_IN).keepTimeZone()).resolves.toBeUndefined();
    });
});
