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

const refused = (status: number) => new Response(JSON.stringify({ error: "no" }), { status });

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
        expect(JSON.parse(init?.body as string)).toEqual({
            key: "timeZone",
            value: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
    });

    it("sends nothing for a guest", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok());
        await service("header.e30.signature").keepTimeZone();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("never fails loudly when Orbit says no, and tries again later, three times at most", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(refused(400)));
        const api = service(SIGNED_IN);
        await expect(api.keepTimeZone()).resolves.toBeUndefined();
        await api.keepTimeZone();
        await api.keepTimeZone();
        await api.keepTimeZone();
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("keeps trying until it is kept, then stops", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(refused(429))
            .mockImplementation(() => Promise.resolve(ok()));
        const api = service(SIGNED_IN);
        await api.keepTimeZone();
        await api.keepTimeZone();
        await api.keepTimeZone();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("tells a new Orbit or a new account, not only the first one", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(ok()));
        const api = service(SIGNED_IN);
        await api.keepTimeZone();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        api.initialize(SIGNED_IN, "https://other-orbit.test", "room-1", BOTS);
        await api.keepTimeZone();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1][0]).toBe("https://other-orbit.test/api/me/preferences");
        const otherAccount = `header.${btoa(JSON.stringify({ accessToken: "access-2" }))}.signature`;
        api.initialize(otherAccount, "https://other-orbit.test", "room-1", BOTS);
        await api.keepTimeZone();
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("does not count an answer that came after the player moved to another Orbit", async () => {
        let release: (response: Response) => void = () => undefined;
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)))
            .mockImplementation(() => Promise.resolve(ok()));
        const api = service(SIGNED_IN);
        const first = api.keepTimeZone();
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        api.initialize(SIGNED_IN, "https://other-orbit.test", "room-1", BOTS);
        release(ok());
        await first;
        await api.keepTimeZone();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1][0]).toBe("https://other-orbit.test/api/me/preferences");
    });
});
