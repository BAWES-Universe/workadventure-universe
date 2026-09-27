import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    isLogged: vi.fn(() => true),
    userIsConnectedSubscribe: vi.fn((callback: (connected: boolean) => void) => {
        callback(true);
        return vi.fn();
    }),
    adminDashboardActivatedSet: vi.fn(),
    modalIframeSet: vi.fn(),
    modalIframeWindowSet: vi.fn(),
    modalVisibilitySet: vi.fn(),
    modalVisibilitySubscribe: vi.fn(() => vi.fn()),
    // The Orbit frame's window, as the modal store holds it (none unless a test sets one).
    frame: undefined as unknown,
    setAuthToken: vi.fn(),
    getAuthToken: vi.fn((): string | null => "game-token"),
    pusherGet: vi.fn(),
}));

vi.mock("../../Connection/LocalUserStore", () => ({
    localUserStore: { isLogged: mocks.isLogged, setAuthToken: mocks.setAuthToken, getAuthToken: mocks.getAuthToken },
}));

vi.mock("../../Connection/AxiosUtils", () => ({
    axiosToPusher: { get: mocks.pusherGet },
}));

vi.mock("../../Stores/MenuStore", () => ({
    userIsConnected: { subscribe: mocks.userIsConnectedSubscribe },
    adminDashboardActivatedStore: { set: mocks.adminDashboardActivatedSet },
}));

vi.mock("../../Stores/ModalStore", () => ({
    modalIframeStore: { set: mocks.modalIframeSet },
    modalIframeWindowStore: {
        set: mocks.modalIframeWindowSet,
        subscribe: vi.fn((callback: (value: unknown) => void) => {
            callback(mocks.frame);
            return vi.fn();
        }),
    },
    modalVisibilityStore: {
        set: mocks.modalVisibilitySet,
        subscribe: mocks.modalVisibilitySubscribe,
    },
}));

/**
 * Build a REAL three-part JWT whose payload JSON carries an `accessToken`.
 * The previous fixture ("header.payload.signature") made atob("payload") throw,
 * so getAccessTokenFromJwt returned null, initializeAdminIntegration exited at
 * its first line, and every assertion passed trivially. This fixture actually
 * exercises the init -> timer -> openAdminModal path.
 */
function b64u(input: unknown): string {
    return btoa(JSON.stringify(input)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** An OIDC access token (itself a JWT) that runs out at `exp` (seconds), or never says. */
function makeOidcToken(exp?: number): string {
    return `${b64u({ alg: "none" })}.${b64u(exp === undefined ? { sub: "user-1" } : { sub: "user-1", exp })}.sig`;
}

function makeAccessTokenJwt(accessToken = "test-access-token"): string {
    return `${b64u({ alg: "none" })}.${b64u({ accessToken })}.${b64u({})}`;
}

interface AdminModuleLike {
    init(roomMetadata: unknown, options: unknown): void;
    destroy(): void;
}

async function freshModule(): Promise<AdminModuleLike> {
    vi.resetModules();
    const mod = (await import("./index")) as { default: AdminModuleLike };
    return mod.default;
}

function makeOptions(userAccessToken = makeAccessTokenJwt()): unknown {
    return {
        adminUrl: "https://admin.example.com",
        roomId: "https://play.example.com/@/room",
        userAccessToken,
    };
}

describe("Admin integration lifecycle", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        mocks.isLogged.mockReturnValue(true);
        vi.stubGlobal("window", {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            location: { href: "https://play.example.com/@/room" },
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("initializes and opens the admin iframe when NOT destroyed (positive control)", async () => {
        const mod = await freshModule();
        mod.init({}, makeOptions());
        vi.advanceTimersByTime(3000);

        // If the timer path is dead, these fail — the test cannot pass on an early return alone.
        expect(mocks.adminDashboardActivatedSet).toHaveBeenCalledWith(true);
        expect(mocks.modalVisibilitySet).toHaveBeenCalledWith(true);
        expect(mocks.modalIframeSet).toHaveBeenCalledWith(
            expect.objectContaining({ src: expect.stringContaining("admin.example.com") })
        );
    });

    it("does not initialize or open the iframe after destruction", async () => {
        const mod = await freshModule();
        mod.init({}, makeOptions());
        mod.destroy();
        vi.advanceTimersByTime(3000);

        // Without cancelPendingTimers in destroy(), the +1000ms init timer fires,
        // activates the dashboard and opens the modal at +2500ms — this would fail.
        expect(mocks.adminDashboardActivatedSet).not.toHaveBeenCalledWith(true);
        expect(mocks.modalVisibilitySet).not.toHaveBeenCalledWith(true);
        // No admin iframe may be opened after teardown. (destroy() does close the
        // modal via modalIframeStore.set(null) — that cleanup call is expected.)
        expect(mocks.modalIframeSet).not.toHaveBeenCalledWith(
            expect.objectContaining({ src: expect.stringContaining("admin.example.com") })
        );
        // destroy() itself deactivates the dashboard flag
        expect(mocks.adminDashboardActivatedSet).toHaveBeenCalledWith(false);
    });

    it("treats a malformed access token as a no-op with no side effects", async () => {
        const mod = await freshModule();
        mod.init({}, makeOptions("header.payload.signature"));
        vi.advanceTimersByTime(3000);

        expect(mocks.modalIframeSet).not.toHaveBeenCalled();
        expect(mocks.modalVisibilitySet).not.toHaveBeenCalledWith(true);
        expect(mocks.adminDashboardActivatedSet).not.toHaveBeenCalledWith(true);
    });
});

describe("Opening Orbit on one of its pages", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        mocks.isLogged.mockReturnValue(true);
        vi.stubGlobal("window", {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            location: { href: "https://play.example.com/@/room" },
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    async function freshIndex() {
        vi.resetModules();
        return (await import("./index")) as unknown as {
            default: AdminModuleLike;
            canOpenOrbit(): boolean;
            openOrbitPage(path: string): void;
        };
    }

    it("doesn't offer Orbit when no Orbit address is configured", async () => {
        const index = await freshIndex();
        index.default.init({}, { ...(makeOptions() as object), adminUrl: "" });
        vi.advanceTimersByTime(3000);
        expect(index.canOpenOrbit()).toBe(false);
    });

    it("can't open Orbit before the integration is set up (a guest)", async () => {
        const index = await freshIndex();
        expect(index.canOpenOrbit()).toBe(false);
        index.openOrbitPage("/admin/profile");
        expect(mocks.modalIframeSet).not.toHaveBeenCalled();
    });

    it("opens Orbit on the requested page, switching to it when Orbit is already open", async () => {
        const index = await freshIndex();
        index.default.init({}, makeOptions());
        vi.advanceTimersByTime(3000);
        expect(index.canOpenOrbit()).toBe(true);
        mocks.modalIframeSet.mockClear();

        index.openOrbitPage("/admin/profile");

        // Closed, then opened again on the page.
        expect(mocks.modalIframeSet).toHaveBeenNthCalledWith(1, null);
        const opened = mocks.modalIframeSet.mock.calls[1][0] as { src: string };
        const url = new URL(opened.src);
        expect(url.pathname).toBe("/admin/login");
        expect(url.searchParams.get("redirect")).toBe("/admin/profile");
        expect(url.searchParams.get("playUri")).toBe("https://play.example.com/@/room");
    });
});

describe("Signing Orbit in when the OIDC access token has run out", () => {
    const ADMIN = "https://admin.example.com";
    let frame: { postMessage: ReturnType<typeof vi.fn> };
    let listeners: ((event: MessageEvent<unknown>) => void)[];

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        mocks.isLogged.mockReturnValue(true);
        mocks.getAuthToken.mockReturnValue("game-token");
        frame = { postMessage: vi.fn() };
        mocks.frame = frame;
        listeners = [];
        vi.stubGlobal("window", {
            addEventListener: vi.fn((type: string, listener: (event: Event) => void) => {
                if (type === "message") listeners.push(listener as (event: MessageEvent<unknown>) => void);
            }),
            removeEventListener: vi.fn((type: string, listener: (event: Event) => void) => {
                listeners = listeners.filter((candidate) => candidate !== listener);
            }),
            location: { href: "https://play.example.com/@/room" },
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    const nowSeconds = () => Math.floor(Date.now() / 1000);

    /** A /me answer as the pusher sends it, which the real MeResponse parser accepts. */
    function meAnswer(authToken: string) {
        return {
            data: {
                status: "ok",
                authToken,
                userUuid: "user-1",
                isCharacterTexturesValid: true,
                isCompanionTextureValid: true,
            },
        };
    }

    /** A /me answer the test releases when it wants to. */
    function pendingMe() {
        let resolve: (value: unknown) => void = () => {};
        mocks.pusherGet.mockImplementationOnce(
            () =>
                new Promise((done) => {
                    resolve = done;
                })
        );
        return (authToken: string) => resolve(meAnswer(authToken));
    }

    function orbitSends(refresh?: boolean) {
        const data = {
            type: "orbit-auth-ready-v2",
            version: 2,
            nonce: "n".repeat(16),
            ...(refresh ? { refresh } : {}),
        };
        for (const listener of listeners)
            listener({ data, source: frame, origin: ADMIN } as unknown as MessageEvent<unknown>);
    }

    async function openedWith(gameToken: string) {
        vi.resetModules();
        const index = (await import("./index")) as { default: AdminModuleLike };
        index.default.init({}, makeOptions(gameToken));
        vi.advanceTimersByTime(3000);
        return index;
    }

    async function orbitAsks(refresh?: boolean) {
        orbitSends(refresh);
        // The answer comes after the (possible) renewal.
        await vi.runAllTimersAsync();
    }

    it("answers with the token it has while that token is still good", async () => {
        const good = makeOidcToken(nowSeconds() + 3600);
        await openedWith(makeAccessTokenJwt(good));
        await orbitAsks();
        expect(mocks.pusherGet).not.toHaveBeenCalled();
        expect(frame.postMessage).toHaveBeenCalledWith(
            { type: "orbit-auth-token-v2", version: 2, nonce: "n".repeat(16), accessToken: good },
            ADMIN
        );
    });

    it("renews an expired token through /me before answering, and keeps the renewed one", async () => {
        const expired = makeOidcToken(nowSeconds() - 10);
        const renewed = makeOidcToken(nowSeconds() + 3600);
        const renewedGameToken = makeAccessTokenJwt(renewed);
        mocks.pusherGet.mockResolvedValue(meAnswer(renewedGameToken));
        await openedWith(makeAccessTokenJwt(expired));
        await orbitAsks();
        expect(mocks.pusherGet).toHaveBeenCalledWith("me", {
            params: { token: makeAccessTokenJwt(expired), playUri: "https://play.example.com/@/room" },
        });
        expect(mocks.setAuthToken).toHaveBeenCalledWith(renewedGameToken);
        expect(frame.postMessage).toHaveBeenCalledWith(expect.objectContaining({ accessToken: renewed }), ADMIN);

        // The next time Orbit asks, the renewed token is the one it has, with no second trip to /me.
        mocks.pusherGet.mockClear();
        frame.postMessage.mockClear();
        await orbitAsks();
        expect(mocks.pusherGet).not.toHaveBeenCalled();
        expect(frame.postMessage).toHaveBeenCalledWith(expect.objectContaining({ accessToken: renewed }), ADMIN);
    });

    it("renews when Orbit says the token was refused, even if it doesn't look expired", async () => {
        const opaque = makeOidcToken();
        const renewed = makeOidcToken(nowSeconds() + 3600);
        mocks.pusherGet.mockResolvedValue(meAnswer(makeAccessTokenJwt(renewed)));
        await openedWith(makeAccessTokenJwt(opaque));
        await orbitAsks(true);
        expect(mocks.pusherGet).toHaveBeenCalledTimes(1);
        expect(frame.postMessage).toHaveBeenCalledWith(expect.objectContaining({ accessToken: renewed }), ADMIN);
    });

    it("still answers with what it has when /me can't renew", async () => {
        const expired = makeOidcToken(nowSeconds() - 10);
        mocks.pusherGet.mockRejectedValue(new Error("pusher down"));
        await openedWith(makeAccessTokenJwt(expired));
        await orbitAsks();
        expect(mocks.setAuthToken).not.toHaveBeenCalled();
        expect(frame.postMessage).toHaveBeenCalledWith(expect.objectContaining({ accessToken: expired }), ADMIN);
    });

    it("keeps nothing from a /me answer that doesn't match the pusher's schema", async () => {
        const expired = makeOidcToken(nowSeconds() - 10);
        mocks.pusherGet.mockResolvedValue({
            data: { status: "ok", authToken: makeAccessTokenJwt(makeOidcToken(nowSeconds() + 3600)) },
        });
        await openedWith(makeAccessTokenJwt(expired));
        await orbitAsks();
        expect(mocks.setAuthToken).not.toHaveBeenCalled();
        expect(frame.postMessage).toHaveBeenCalledWith(expect.objectContaining({ accessToken: expired }), ADMIN);
    });

    it("shares one /me renewal between Orbit requests that overlap", async () => {
        const expired = makeOidcToken(nowSeconds() - 10);
        const renewed = makeOidcToken(nowSeconds() + 3600);
        const release = pendingMe();
        await openedWith(makeAccessTokenJwt(expired));
        orbitSends();
        orbitSends(true);
        await vi.runAllTimersAsync();
        expect(mocks.pusherGet).toHaveBeenCalledTimes(1);

        release(makeAccessTokenJwt(renewed));
        await vi.runAllTimersAsync();
        expect(mocks.setAuthToken).toHaveBeenCalledTimes(1);
        expect(frame.postMessage).toHaveBeenCalledTimes(2);
        for (const [message] of frame.postMessage.mock.calls)
            expect(message).toEqual(expect.objectContaining({ accessToken: renewed }));
    });

    it("keeps nothing, and answers nothing, when /me comes back after Orbit's integration was torn down", async () => {
        const release = pendingMe();
        const index = await openedWith(makeAccessTokenJwt(makeOidcToken(nowSeconds() - 10)));
        orbitSends();
        await vi.runAllTimersAsync();
        index.default.destroy();

        release(makeAccessTokenJwt(makeOidcToken(nowSeconds() + 3600)));
        await vi.runAllTimersAsync();
        expect(mocks.setAuthToken).not.toHaveBeenCalled();
        expect(frame.postMessage).not.toHaveBeenCalled();
    });

    it("doesn't bring a token back when /me comes back after the player signed out", async () => {
        const release = pendingMe();
        await openedWith(makeAccessTokenJwt(makeOidcToken(nowSeconds() - 10)));
        orbitSends();
        await vi.runAllTimersAsync();
        // Logging out clears the stored token before redirecting.
        mocks.getAuthToken.mockReturnValue(null);

        release(makeAccessTokenJwt(makeOidcToken(nowSeconds() + 3600)));
        await vi.runAllTimersAsync();
        expect(mocks.setAuthToken).not.toHaveBeenCalled();
        expect(frame.postMessage).not.toHaveBeenCalled();
    });

    it("says nothing to a window that isn't Orbit's frame", async () => {
        await openedWith(makeAccessTokenJwt(makeOidcToken(nowSeconds() + 3600)));
        const stranger = { postMessage: vi.fn() };
        for (const listener of listeners) {
            listener({
                data: { type: "orbit-auth-ready-v2", version: 2, nonce: "n".repeat(16) },
                source: stranger,
                origin: ADMIN,
            } as unknown as MessageEvent<unknown>);
        }
        await vi.runAllTimersAsync();
        expect(stranger.postMessage).not.toHaveBeenCalled();
        expect(frame.postMessage).not.toHaveBeenCalled();
    });
});
