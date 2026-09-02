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
