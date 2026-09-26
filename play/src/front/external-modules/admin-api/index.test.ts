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
    orbitOpened: vi.fn(),
    // The Orbit frame's window, as the modal store holds it (none unless a test sets one).
    frame: undefined as unknown,
}));

vi.mock("../../Administration/AnalyticsClient", () => ({
    analyticsClient: { orbitOpened: mocks.orbitOpened },
}));

vi.mock("../../Connection/LocalUserStore", () => ({
    localUserStore: { isLogged: mocks.isLogged },
}));

vi.mock("../../Stores/MenuStore", () => ({
    userIsConnected: { subscribe: mocks.userIsConnectedSubscribe },
    adminDashboardActivatedStore: { set: mocks.adminDashboardActivatedSet },
}));

vi.mock("../../Stores/ModalStore", () => ({
    modalIframeStore: { set: mocks.modalIframeSet },
    modalIframeWindowStore: {
        set: mocks.modalIframeWindowSet,
        subscribe: (callback: (value: unknown) => void) => {
            callback(mocks.frame);
            return () => undefined;
        },
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
function makeAccessTokenJwt(): string {
    const b64u = (input: unknown): string =>
        btoa(JSON.stringify(input)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `${b64u({ alg: "none" })}.${b64u({ accessToken: "test-access-token" })}.${b64u({})}`;
}

interface AdminModuleLike {
    init(roomMetadata: unknown, options: unknown): void;
    destroy(): void;
}

interface AdminModuleExports {
    default: AdminModuleLike;
    openAdminModalFromMenu(): void;
}

async function freshExports(): Promise<AdminModuleExports> {
    vi.resetModules();
    return (await import("./index")) as AdminModuleExports;
}

async function freshModule(): Promise<AdminModuleLike> {
    return (await freshExports()).default;
}

function expectOrbitNotOpened(): void {
    expect(mocks.modalVisibilitySet).not.toHaveBeenCalledWith(true);
    expect(mocks.modalIframeSet).not.toHaveBeenCalledWith(
        expect.objectContaining({ src: expect.stringContaining("admin.example.com") })
    );
    expect(mocks.orbitOpened).not.toHaveBeenCalled();
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

    it("activates the Orbit button on init but never opens Orbit by itself (negative control)", async () => {
        const mod = await freshModule();
        mod.init({}, makeOptions());
        vi.advanceTimersByTime(10_000);

        // The init path really ran (the button is activated), so "not opened" isn't an early return.
        expect(mocks.adminDashboardActivatedSet).toHaveBeenCalledWith(true);
        expectOrbitNotOpened();
    });

    it("does not reopen Orbit on a room change (destroy, then init again)", async () => {
        const mod = await freshModule();
        mod.init({}, makeOptions());
        vi.advanceTimersByTime(3000);
        mod.destroy();
        mod.init({}, makeOptions());
        vi.advanceTimersByTime(10_000);

        expect(mocks.adminDashboardActivatedSet).toHaveBeenLastCalledWith(true);
        expectOrbitNotOpened();
    });

    it("does not reopen Orbit on a reconnect (init again without destroy)", async () => {
        const mod = await freshModule();
        mod.init({}, makeOptions());
        vi.advanceTimersByTime(3000);
        mod.init({}, makeOptions());
        vi.advanceTimersByTime(10_000);

        expectOrbitNotOpened();
    });

    it("opens Orbit from the action-bar button and records the source (positive control)", async () => {
        const exports = await freshExports();
        exports.default.init({}, makeOptions());
        vi.advanceTimersByTime(3000);
        exports.openAdminModalFromMenu();

        expect(mocks.modalVisibilitySet).toHaveBeenCalledWith(true);
        expect(mocks.modalIframeSet).toHaveBeenCalledWith(
            expect.objectContaining({ src: expect.stringContaining("admin.example.com") })
        );
        expect(mocks.orbitOpened).toHaveBeenCalledTimes(1);
        expect(mocks.orbitOpened).toHaveBeenCalledWith({ source: "button" });
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
            openAdminModalFromMenu(): void;
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
        // Orbit never opens on its own: the player opened it from the menu.
        index.openAdminModalFromMenu();
        mocks.modalIframeSet.mockClear();

        index.openOrbitPage("/admin/profile");

        // Closed, then opened again on the page.
        expect(mocks.modalIframeSet).toHaveBeenNthCalledWith(1, null);
        const opened = mocks.modalIframeSet.mock.calls[1][0] as { src: string };
        const url = new URL(opened.src);
        expect(url.pathname).toBe("/admin/login");
        expect(url.searchParams.get("redirect")).toBe("/admin/profile");
        expect(url.searchParams.get("playUri")).toBe("https://play.example.com/@/room");
        // Counted as the game asking Orbit for a page.
        expect(mocks.orbitOpened).toHaveBeenLastCalledWith({ source: "link" });
    });
});

describe("The Orbit bridge", () => {
    const ADMIN = "https://admin.example.com";
    let frame: { postMessage: ReturnType<typeof vi.fn> };
    let listeners: ((event: MessageEvent<unknown>) => void)[];

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        mocks.isLogged.mockReturnValue(true);
        frame = { postMessage: vi.fn() };
        mocks.frame = frame;
        listeners = [];
        vi.stubGlobal("window", {
            addEventListener: vi.fn((type: string, listener: (event: MessageEvent<unknown>) => void) => {
                if (type === "message") listeners.push(listener);
            }),
            removeEventListener: vi.fn((type: string, listener: (event: MessageEvent<unknown>) => void) => {
                listeners = listeners.filter((candidate) => candidate !== listener);
            }),
            location: { href: "https://play.example.com/@/room" },
        });
    });

    afterEach(() => {
        mocks.frame = undefined;
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    async function freshIndex() {
        vi.resetModules();
        return (await import("./index")) as unknown as {
            default: AdminModuleLike;
            requestOrbitPage(intent: string, params?: Record<string, string>): boolean;
            notifyOrbitChanged(topic: string): void;
            openAdminModalFromMenu(): void;
        };
    }

    function fromOrbit(data: unknown, source: unknown = frame, origin = ADMIN) {
        for (const listener of listeners) listener({ data, source, origin } as MessageEvent<unknown>);
    }

    /** The room revision the game sent Orbit in its last init message. */
    function lastInitRevision(): string {
        const inits = frame.postMessage.mock.calls
            .map((call) => call[0] as { type: string; roomRevision: string })
            .filter((message) => message.type === "orbit-bridge-init");
        return inits[inits.length - 1].roomRevision;
    }

    it("opens Orbit for a page request, and sends it only once Orbit has signed in and is ready", async () => {
        const index = await freshIndex();
        index.default.init({}, makeOptions());
        vi.advanceTimersByTime(3000);

        expect(index.requestOrbitPage("new-universe")).toBe(true);
        expect(mocks.orbitOpened).toHaveBeenLastCalledWith({ source: "link" });
        expect(frame.postMessage).not.toHaveBeenCalled();

        fromOrbit({ type: "orbit-bridge-ready", version: 1, capabilities: ["navigate", "event"] });
        const revision = lastInitRevision();
        expect(revision).toMatch(/^rev-/);

        expect(frame.postMessage).toHaveBeenNthCalledWith(
            1,
            { type: "orbit-bridge-init", version: 1, roomRevision: revision, capabilities: ["navigate", "event"] },
            ADMIN
        );
        expect(frame.postMessage).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ type: "orbit-navigate", intent: "new-universe", roomRevision: revision }),
            ADMIN
        );
    });

    it("ignores a ready message from another window or origin", async () => {
        const index = await freshIndex();
        index.default.init({}, makeOptions());
        vi.advanceTimersByTime(3000);
        index.requestOrbitPage("new-universe");

        fromOrbit({ type: "orbit-bridge-ready", version: 1, capabilities: [] }, { postMessage: vi.fn() });
        fromOrbit({ type: "orbit-bridge-ready", version: 1, capabilities: [] }, frame, "https://evil.example.com");

        expect(frame.postMessage).not.toHaveBeenCalled();
    });

    it("starts a new visit on every reconnect, so an earlier Orbit frame's revision no longer applies", async () => {
        const index = await freshIndex();
        index.default.init({}, makeOptions());
        vi.advanceTimersByTime(3000);
        index.openAdminModalFromMenu();
        fromOrbit({ type: "orbit-bridge-ready", version: 1, capabilities: [] });
        const first = lastInitRevision();

        index.default.destroy();
        index.default.init({}, makeOptions());
        vi.advanceTimersByTime(3000);
        index.openAdminModalFromMenu();
        fromOrbit({ type: "orbit-bridge-ready", version: 1, capabilities: [] });
        const second = lastInitRevision();

        expect(first).toMatch(/^rev-/);
        expect(second).toMatch(/^rev-/);
        expect(second).not.toBe(first);
    });

    it("doesn't wake a closed Orbit for a refresh hint", async () => {
        const index = await freshIndex();
        index.default.init({}, makeOptions());
        vi.advanceTimersByTime(3000);
        index.notifyOrbitChanged("universes");
        expect(mocks.modalVisibilitySet).not.toHaveBeenCalledWith(true);
        expect(frame.postMessage).not.toHaveBeenCalled();
    });

    it("can't ask for a page before the integration is set up (a guest)", async () => {
        const index = await freshIndex();
        expect(index.requestOrbitPage("new-universe")).toBe(false);
        expect(mocks.modalIframeSet).not.toHaveBeenCalled();
    });

    it("gives focus back to the control that opened Orbit when Orbit closes", async () => {
        let onVisibility: ((visible: boolean) => void) | undefined;
        mocks.modalVisibilitySubscribe.mockImplementation(((callback: (visible: boolean) => void) => {
            onVisibility = callback;
            return vi.fn();
        }) as unknown as () => ReturnType<typeof vi.fn>);
        const button = document.createElement("button");
        document.body.append(button);
        button.focus();

        const index = await freshIndex();
        index.default.init({}, makeOptions());
        vi.advanceTimersByTime(3000);
        index.openAdminModalFromMenu();
        (document.activeElement as HTMLElement | null)?.blur();

        onVisibility?.(false);
        expect(document.activeElement).toBe(button);
        button.remove();
    });
});
