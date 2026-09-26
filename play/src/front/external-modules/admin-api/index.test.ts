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
    modalIframeWindowStore: { set: mocks.modalIframeWindowSet, subscribe: vi.fn(() => vi.fn()) },
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
