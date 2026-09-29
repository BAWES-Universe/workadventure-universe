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
    clearHeldMovement: vi.fn(),
    playerName: "Khalid" as string | null,
    setPlayerName: vi.fn(),
    rejoinCurrentRoom: vi.fn(),
    setLocalName: vi.fn(),
    // The modal's size, as a small writable.
    fullScreen: (() => {
        let value = false;
        const subscribers = new Set<(value: boolean) => void>();
        return {
            get value() {
                return value;
            },
            set: vi.fn((next: boolean) => {
                value = next;
                subscribers.forEach((subscriber) => subscriber(value));
            }),
            update(fn: (value: boolean) => boolean) {
                this.set(fn(value));
            },
            subscribe(subscriber: (value: boolean) => void) {
                subscribers.add(subscriber);
                subscriber(value);
                return () => subscribers.delete(subscriber);
            },
            reset() {
                value = false;
                subscribers.clear();
                this.set.mockClear();
            },
        };
    })(),
    setAuthToken: vi.fn(),
    getAuthToken: vi.fn((): string | null => "game-token"),
    pusherGet: vi.fn(),
}));

/** The browser's history, small enough to see through: entries and the one being shown. */
function makeHistory() {
    const entries: unknown[] = [null];
    let index = 0;
    const history = {
        get state() {
            return entries[index];
        },
        pushState: vi.fn((state: unknown) => {
            entries.splice(index + 1);
            entries.push(state);
            index = entries.length - 1;
        }),
        back: vi.fn(() => {
            if (index > 0) index -= 1;
        }),
        entries,
    };
    return history;
}

vi.mock("../../Administration/AnalyticsClient", () => ({
    analyticsClient: { orbitOpened: mocks.orbitOpened },
}));

// Quests are off here: the quest log never reaches the bridge (orbitBridge.test.ts covers the message).
vi.mock("../../Quests/QuestOrbitState", () => ({ watchOrbitQuestEntries: () => () => {} }));

vi.mock("../../Connection/LocalUserStore", () => ({
    localUserStore: {
        isLogged: mocks.isLogged,
        setName: mocks.setLocalName,
        setAuthToken: mocks.setAuthToken,
        getAuthToken: mocks.getAuthToken,
    },
}));

vi.mock("../../Connection/Capabilities", () => ({
    hasCapability: (name: string) => name === "api/save-name",
}));

vi.mock("../../Connection/AxiosUtils", () => ({
    axiosToPusher: { get: mocks.pusherGet },
}));

vi.mock("../../Connection/LocalUserUtils", () => ({
    maxUserNameLength: 25,
    isUserNameValid: (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 25,
}));

vi.mock("../../Stores/MenuStore", () => ({
    userIsConnected: { subscribe: mocks.userIsConnectedSubscribe },
    adminDashboardActivatedStore: { set: mocks.adminDashboardActivatedSet },
}));

vi.mock("../../Phaser/Game/GameManager", () => ({
    gameManager: {
        tryGetCurrentGameScene: () => ({ userInputManager: { clearHeldMovement: mocks.clearHeldMovement } }),
        getPlayerName: () => mocks.playerName,
        setPlayerName: mocks.setPlayerName,
        rejoinCurrentRoom: mocks.rejoinCurrentRoom,
    },
}));

vi.mock("../../Stores/ModalStore", () => ({
    modalFullScreenStore: mocks.fullScreen,
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
        mocks.fullScreen.reset();
        vi.stubGlobal("history", makeHistory());
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
        mocks.fullScreen.reset();
        vi.stubGlobal("history", makeHistory());
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

        // The existing frame changes its URL in place; clearing it would lose its bridge WindowProxy.
        expect(mocks.modalIframeSet).toHaveBeenCalledTimes(1);
        const opened = mocks.modalIframeSet.mock.calls[0][0] as { src: string };
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
    let popStateListeners: ((event: PopStateEvent) => void)[];

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        mocks.isLogged.mockReturnValue(true);
        frame = { postMessage: vi.fn() };
        mocks.frame = frame;
        listeners = [];
        popStateListeners = [];
        mocks.fullScreen.reset();
        vi.stubGlobal("history", makeHistory());
        vi.stubGlobal("window", {
            addEventListener: vi.fn((type: string, listener: (event: Event) => void) => {
                if (type === "message") listeners.push(listener as (event: MessageEvent<unknown>) => void);
                if (type === "popstate") popStateListeners.push(listener as (event: PopStateEvent) => void);
            }),
            removeEventListener: vi.fn((type: string, listener: (event: Event) => void) => {
                listeners = listeners.filter((candidate) => candidate !== listener);
                popStateListeners = popStateListeners.filter((candidate) => candidate !== listener);
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
            {
                type: "orbit-bridge-init",
                version: 1,
                roomRevision: revision,
                capabilities: ["navigate", "event", "view", "profile"],
                view: "compact",
                maxNameLength: 25,
            },
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

    async function openAndRename(name: string, revision?: string) {
        let onVisibility: ((visible: boolean) => void) | undefined;
        mocks.modalVisibilitySubscribe.mockImplementation(((callback: (visible: boolean) => void) => {
            onVisibility = callback;
            return vi.fn();
        }) as unknown as () => ReturnType<typeof vi.fn>);
        const index = await freshIndex();
        index.default.init({}, makeOptions());
        vi.advanceTimersByTime(3000);
        index.openAdminModalFromMenu();
        fromOrbit({ type: "orbit-bridge-ready", version: 1, capabilities: [] });
        fromOrbit({ type: "orbit-profile-changed", version: 1, roomRevision: revision ?? lastInitRevision(), name });
        return () => onVisibility?.(false);
    }

    it("shows a name saved in Orbit once Orbit closes, by rejoining the room as a rename in the game does", async () => {
        mocks.playerName = "Khalid";
        const close = await openAndRename("  Khalid A  ");
        expect(mocks.rejoinCurrentRoom).not.toHaveBeenCalled();
        close();
        expect(mocks.setPlayerName).toHaveBeenCalledWith("Khalid A");
        expect(mocks.rejoinCurrentRoom).toHaveBeenCalledTimes(1);
        // Signed in: the server already has it.
        expect(mocks.setLocalName).not.toHaveBeenCalled();
    });

    it("doesn't rejoin for the same name, a name the game refuses, or another visit's frame", async () => {
        mocks.playerName = "Khalid";
        (await openAndRename("Khalid"))();
        (await openAndRename("x".repeat(40)))();
        (await openAndRename("Someone", "rev-from-an-earlier-visit-0000"))();
        expect(mocks.setPlayerName).not.toHaveBeenCalled();
        expect(mocks.rejoinCurrentRoom).not.toHaveBeenCalled();
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

describe("Orbit and the Back button (1C)", () => {
    const ADMIN = "https://admin.example.com";
    let frame: { postMessage: ReturnType<typeof vi.fn> };
    let listeners: ((event: MessageEvent<unknown>) => void)[];
    let popStateListeners: ((event: PopStateEvent) => void)[];
    let onVisibility: ((visible: boolean) => void) | undefined;
    let fakeHistory: ReturnType<typeof makeHistory>;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        mocks.isLogged.mockReturnValue(true);
        frame = { postMessage: vi.fn() };
        mocks.frame = frame;
        listeners = [];
        popStateListeners = [];
        onVisibility = undefined;
        mocks.modalVisibilitySubscribe.mockImplementation(((callback: (visible: boolean) => void) => {
            onVisibility = callback;
            return vi.fn();
        }) as unknown as () => ReturnType<typeof vi.fn>);
        mocks.fullScreen.reset();
        fakeHistory = makeHistory();
        vi.stubGlobal("history", fakeHistory);
        vi.stubGlobal("window", {
            addEventListener: vi.fn((type: string, listener: (event: Event) => void) => {
                if (type === "message") listeners.push(listener as (event: MessageEvent<unknown>) => void);
                if (type === "popstate") popStateListeners.push(listener as (event: PopStateEvent) => void);
            }),
            removeEventListener: vi.fn((type: string, listener: (event: Event) => void) => {
                listeners = listeners.filter((candidate) => candidate !== listener);
                popStateListeners = popStateListeners.filter((candidate) => candidate !== listener);
            }),
            location: { href: "https://play.example.com/@/room" },
        });
    });

    afterEach(() => {
        mocks.frame = undefined;
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    type Index = {
        default: AdminModuleLike;
        openAdminModalFromMenu(): void;
        openOrbitPage(path: string): void;
        requestOrbitPage(intent: string): boolean;
    };

    async function openedIndex(): Promise<Index> {
        vi.resetModules();
        const index = (await import("./index")) as unknown as Index;
        index.default.init({}, makeOptions());
        vi.advanceTimersByTime(3000);
        index.openAdminModalFromMenu();
        return index;
    }

    function fromOrbit(data: unknown) {
        for (const listener of listeners)
            listener({ data, source: frame, origin: ADMIN } as unknown as MessageEvent<unknown>);
    }

    function backPressed() {
        fakeHistory.back();
        for (const listener of popStateListeners) listener({ state: fakeHistory.state } as PopStateEvent);
    }

    /** What the game does when the modal goes (the X, Escape, WA.ui.modal.closeModal): the visibility store flips. */
    function modalClosedByGame() {
        onVisibility?.(false);
    }

    it("adds one history entry when Orbit opens, forgets held movement, and starts compact", async () => {
        await openedIndex();
        expect(fakeHistory.pushState).toHaveBeenCalledTimes(1);
        expect(fakeHistory.state).toEqual({ orbit: true, orbitVisit: expect.any(String) });
        expect(mocks.clearHeldMovement).toHaveBeenCalledTimes(1);
        expect(mocks.fullScreen.set).toHaveBeenCalledWith(false);
    });

    it("closes Orbit on Back and stays in the room", async () => {
        await openedIndex();
        backPressed();
        expect(mocks.modalVisibilitySet).toHaveBeenCalledWith(false);
        // The entry Back took away isn't taken away again.
        expect(fakeHistory.back).toHaveBeenCalledTimes(1);
    });

    it("closes a new opening when Back reaches an older Orbit marker, then skips that stale marker", async () => {
        // A child iframe navigation can consume the close-time history.back(), leaving its parent's marker behind.
        fakeHistory.pushState({ orbit: true, orbitVisit: "an-earlier-opening" });
        await openedIndex();
        expect(fakeHistory.state).not.toEqual({ orbit: true, orbitVisit: "an-earlier-opening" });
        mocks.modalVisibilitySet.mockClear();

        backPressed();

        expect(mocks.modalVisibilitySet).toHaveBeenCalledWith(false);
        expect(fakeHistory.back).toHaveBeenCalledTimes(2);
        expect(fakeHistory.state).toBeNull();
    });

    it("does not close for a popstate still within the current opening", async () => {
        await openedIndex();
        mocks.modalVisibilitySet.mockClear();

        for (const listener of popStateListeners) listener({ state: fakeHistory.state } as PopStateEvent);

        expect(mocks.modalVisibilitySet).not.toHaveBeenCalled();
        expect(fakeHistory.back).not.toHaveBeenCalled();
    });

    it("takes its entry out of the history when Orbit is closed any other way", async () => {
        await openedIndex();
        modalClosedByGame();
        expect(fakeHistory.back).toHaveBeenCalledTimes(1);
        expect(fakeHistory.state).toBeNull();
        // Opening again adds a fresh entry.
        mocks.modalVisibilitySubscribe.mockClear();
    });

    it("steps over an entry left behind by an earlier visit", async () => {
        const index = await openedIndex();
        index.default.destroy();
        // The room changed with Orbit open: the entry stays, and Back on it is stepped over.
        expect(fakeHistory.back).not.toHaveBeenCalled();
        index.default.init({}, makeOptions());
        vi.advanceTimersByTime(3000);
        mocks.modalVisibilitySet.mockClear();
        for (const listener of popStateListeners) listener({ state: { orbit: true } } as PopStateEvent);
        expect(fakeHistory.back).toHaveBeenCalledTimes(1);
        // Stepping over it neither opens nor closes Orbit.
        expect(mocks.modalVisibilitySet).not.toHaveBeenCalled();
    });

    it("tells Orbit which view it is in when the game's maximise button changes it", async () => {
        await openedIndex();
        fromOrbit({ type: "orbit-bridge-ready", version: 1, capabilities: ["navigate", "event", "view"] });
        expect(frame.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: "orbit-bridge-init", view: "compact" }),
            ADMIN
        );

        mocks.fullScreen.update((full) => !full);
        expect(frame.postMessage).toHaveBeenLastCalledWith({ type: "orbit-view", version: 1, view: "full" }, ADMIN);
        mocks.fullScreen.update((full) => !full);
        expect(frame.postMessage).toHaveBeenLastCalledWith({ type: "orbit-view", version: 1, view: "compact" }, ADMIN);
    });

    it("never changes the view because the frame asked", async () => {
        await openedIndex();
        fromOrbit({ type: "orbit-view-request", version: 1, view: "full" });
        expect(mocks.fullScreen.value).toBe(false);
    });

    it("keeps one history entry and the launcher when switching Orbit to another page", async () => {
        const index = await openedIndex();
        index.openOrbitPage("/admin/profile");
        expect(fakeHistory.pushState).toHaveBeenCalledTimes(1);
        expect(fakeHistory.back).not.toHaveBeenCalled();
        expect(fakeHistory.state).toEqual({ orbit: true, orbitVisit: expect.any(String) });
    });

    it("keeps the live frame window and full-screen view when changing Orbit pages", async () => {
        const index = await openedIndex();
        mocks.fullScreen.set(true);
        mocks.modalIframeWindowSet.mockClear();
        mocks.modalVisibilitySet.mockClear();

        index.openOrbitPage("/admin/profile");

        // Svelte batches visibility changes in one turn: false -> true never remounts Modal. The existing WindowProxy
        // must remain registered for the replacement page's sign-in handshake and bridge ready message.
        expect(mocks.modalIframeWindowSet).not.toHaveBeenCalledWith(null);
        expect(mocks.modalVisibilitySet).not.toHaveBeenCalledWith(false);
        expect(mocks.fullScreen.value).toBe(true);
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
        // The game keeps the same token it hands the module, and whatever a renewal saves.
        mocks.getAuthToken.mockReturnValue(gameToken);
        mocks.setAuthToken.mockImplementation((token: string) => mocks.getAuthToken.mockReturnValue(token));
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
        // The pusher is told to renew even though the provider may still accept the old token.
        expect(mocks.pusherGet).toHaveBeenCalledWith("me", {
            params: { token: makeAccessTokenJwt(opaque), playUri: "https://play.example.com/@/room", refresh: "true" },
        });
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
        orbitSends(true);
        orbitSends();
        await vi.runAllTimersAsync();
        expect(mocks.pusherGet).toHaveBeenCalledTimes(1);

        release(makeAccessTokenJwt(renewed));
        await vi.runAllTimersAsync();
        expect(mocks.setAuthToken).toHaveBeenCalledTimes(1);
        expect(frame.postMessage).toHaveBeenCalledTimes(2);
        for (const [message] of frame.postMessage.mock.calls)
            expect(message).toEqual(expect.objectContaining({ accessToken: renewed }));
    });

    it("starts a forced renewal rather than joining an unforced one already running", async () => {
        const expired = makeOidcToken(nowSeconds() - 10);
        const release = pendingMe();
        await openedWith(makeAccessTokenJwt(expired));
        orbitSends();
        orbitSends(true);
        await vi.runAllTimersAsync();
        expect(mocks.pusherGet).toHaveBeenCalledTimes(2);
        expect(mocks.pusherGet.mock.calls[1][1]).toEqual(
            expect.objectContaining({ params: expect.objectContaining({ refresh: "true" }) })
        );
        release(makeAccessTokenJwt(makeOidcToken(nowSeconds() + 3600)));
        await vi.runAllTimersAsync();
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

    it("starts from the game's newest token when the bot editor already renewed it", async () => {
        const expired = makeOidcToken(nowSeconds() - 10);
        const renewed = makeOidcToken(nowSeconds() + 3600);
        await openedWith(makeAccessTokenJwt(expired));
        mocks.getAuthToken.mockReturnValue(makeAccessTokenJwt(renewed));
        await orbitAsks();
        expect(mocks.pusherGet).not.toHaveBeenCalled();
        expect(frame.postMessage).toHaveBeenCalledWith(expect.objectContaining({ accessToken: renewed }), ADMIN);
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
