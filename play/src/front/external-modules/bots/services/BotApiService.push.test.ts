import { beforeEach, describe, expect, it, vi } from "vitest";
import { BotApiService } from "./BotApiService";

vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: { getAuthToken: () => null, setAuthToken: vi.fn() },
}));
vi.mock("../../../Connection/AxiosUtils", () => ({ axiosToPusher: { get: vi.fn() } }));

const ORBIT = "https://orbit.test";
const ROOM = "https://play.test/@/bawes/hq/lobby";
const SESSION = `orb_sess_v2_${"d".repeat(64)}`;

function service(adminUrl: string | undefined = ORBIT): BotApiService {
    const api = new BotApiService();
    api.initialize("header.e30.signature", adminUrl, ROOM, "https://bots.test");
    (api as unknown as { accessToken: string }).accessToken = "token";
    vi.spyOn(
        api as unknown as { getAdminApiSessionToken: () => Promise<string> },
        "getAdminApiSessionToken"
    ).mockResolvedValue(SESSION);
    return api;
}

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("removing a device in Your devices", () => {
    beforeEach(() => {
        sessionStorage.clear();
        vi.restoreAllMocks();
    });

    it("is gone when Orbit removes it", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ ok: true }));
        await expect(service().removePushDevice("d1")).resolves.toBe(true);
    });

    it("is gone when Orbit had already removed it", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ error: "Not found" }, 404));
        await expect(service().removePushDevice("d1")).resolves.toBe(true);
    });

    it("leaves on the saved session on the way out of the account, without renewing, and outlives the page", async () => {
        const api = service();
        const renew = vi.spyOn(
            api as unknown as { getAdminApiSessionToken: () => Promise<string> },
            "getAdminApiSessionToken"
        );
        const saved = `orb_sess_v2_${"f".repeat(64)}`;
        sessionStorage.setItem("orbit_admin_session_v2", saved);
        sessionStorage.setItem("orbit_admin_session_v2_expires", String(Date.now() + 60_000));
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ ok: true }));

        await expect(api.removePushDevice("d1", true)).resolves.toBe(true);

        expect(renew).not.toHaveBeenCalled();
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(init.method).toBe("DELETE");
        expect(init.keepalive).toBe(true);
        expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${saved}`);
    });

    it.each([
        ["an error", () => Promise.resolve(json({ error: "nope" }, 500))],
        ["no answer", () => Promise.reject(new Error("offline"))],
    ])("is not gone on %s", async (_name, answer) => {
        vi.spyOn(globalThis, "fetch").mockImplementation(answer);
        await expect(service().removePushDevice("d1")).resolves.toBe(false);
    });
});

describe("loading Settings > Notifications", () => {
    beforeEach(() => {
        sessionStorage.clear();
        vi.restoreAllMocks();
    });

    it("is null on a server without Orbit, so only the switch shows", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch");
        await expect(service("").getPushOverview()).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("is not known before a room has set the service up, so nothing saved for this device is forgotten", async () => {
        vi.stubGlobal("env", { ADMIN_URL: ORBIT });
        const fetchMock = vi.spyOn(globalThis, "fetch");
        const api = new BotApiService();
        await expect(api.getPushOverview()).resolves.toBeUndefined();
        await expect(api.getPushPublicKey()).resolves.toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it("is null before a room has set the service up on a server without Orbit, so only the switch shows", async () => {
        vi.stubGlobal("env", { ADMIN_URL: "" });
        const api = new BotApiService();
        await expect(api.getPushOverview()).resolves.toBeNull();
        await expect(api.getPushPublicKey()).resolves.toBeNull();
        vi.unstubAllGlobals();
    });

    it("is undefined when Orbit can't be reached, so it says so", async () => {
        vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
        await expect(service().getPushOverview()).resolves.toBeUndefined();
    });
});

describe("the report a closing tab sends", () => {
    it("goes out on the saved session even when it runs out soon, since renewing first would be cut off", async () => {
        const api = service();
        const renew = vi.spyOn(
            api as unknown as { getAdminApiSessionToken: () => Promise<string> },
            "getAdminApiSessionToken"
        );
        const saved = `orb_sess_v2_${"e".repeat(64)}`;
        sessionStorage.setItem("orbit_admin_session_v2", saved);
        sessionStorage.setItem("orbit_admin_session_v2_expires", String(Date.now() + 60_000));
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({}));

        await api.reportPushActivity({ tabId: "t1", front: false, chatRoomId: null }, true);

        expect(renew).not.toHaveBeenCalled();
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(init.keepalive).toBe(true);
        expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${saved}`);
        sessionStorage.clear();
        vi.restoreAllMocks();
    });
});

describe("saving Settings > Notifications", () => {
    it("gives up on a save Orbit does not answer, so the saves after it are not held back", async () => {
        vi.useFakeTimers();
        // Never answers
        vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(() => {}));
        const saving = service().updatePushSettings({ previews: false });
        await vi.advanceTimersByTimeAsync(20_000);
        await expect(saving).resolves.toBeUndefined();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });
});
