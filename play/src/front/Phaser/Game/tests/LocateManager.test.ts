import { get } from "svelte/store";
import { Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../Chat/Stores/PeopleCardReturnStore", () => ({ peopleCardReturn: { dismissCard: vi.fn() } }));

async function makeLocateManager() {
    const { LocateManager } = await import("../LocateManager");
    const stream = new Subject<unknown>();
    const remotePlayers = new Map<number, unknown>();
    const scene = {
        getRemotePlayersRepository: () => ({
            getPlayers: () => new Map([[5, { name: "Stitch", userUuid: "stitch", visitCardUrl: null }]]),
        }),
        MapPlayersByKey: remotePlayers,
    };
    const cameraManager = {
        setExplorationMode: vi.fn(),
        centerCameraOn: vi.fn(),
        stopFollowRemotePlayer: vi.fn(),
        followRemotePlayer: vi.fn(),
    };
    const manager = new LocateManager(
        scene as never,
        cameraManager as never,
        { locatePositionMessageStream: stream } as never
    );
    const stitch = { userId: 5, showCard: vi.fn() };
    return { manager, stream, remotePlayers, stitch, cameraManager };
}

describe("LocateManager: a search never opens its card over another one", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(async () => {
        vi.useRealTimers();
        const { wokaMenuStore, wokaMenuProgressStore } = await import("../../../Stores/WokaMenuStore");
        wokaMenuStore.clear();
        wokaMenuProgressStore.set(undefined);
    });

    it("opens the found person's card when their search card is still showing (positive control)", async () => {
        const { stream, remotePlayers, stitch } = await makeLocateManager();
        stream.next({ userId: 5, position: { x: 1, y: 2 } });

        remotePlayers.set(5, stitch);
        vi.advanceTimersByTime(1000 + 300);

        expect(stitch.showCard).toHaveBeenCalledTimes(1);
    });

    it("ends the search when your own card replaces it: no progress bar on it, no card opened over it", async () => {
        const { wokaMenuStore, wokaMenuProgressStore } = await import("../../../Stores/WokaMenuStore");
        const { stream, remotePlayers, stitch } = await makeLocateManager();
        stream.next({ userId: 5, position: { x: 1, y: 2 } });
        expect(get(wokaMenuProgressStore)).toBeDefined();

        wokaMenuStore.initialize("Me", 42, "me", undefined, true);

        expect(get(wokaMenuProgressStore)).toBeUndefined();
        remotePlayers.set(5, stitch);
        vi.advanceTimersByTime(15_000);
        expect(stitch.showCard).not.toHaveBeenCalled();
        expect(get(wokaMenuStore)?.isSelf).toBe(true);
    });

    it("ends the search when its card is closed", async () => {
        const { wokaMenuStore } = await import("../../../Stores/WokaMenuStore");
        const { stream, remotePlayers, stitch } = await makeLocateManager();
        stream.next({ userId: 5, position: { x: 1, y: 2 } });

        wokaMenuStore.clear();
        remotePlayers.set(5, stitch);
        vi.advanceTimersByTime(15_000);

        expect(stitch.showCard).not.toHaveBeenCalled();
    });

    it("doesn't open the card over one that replaced it in the last moment before it opens", async () => {
        const { wokaMenuStore } = await import("../../../Stores/WokaMenuStore");
        const { stream, remotePlayers, stitch } = await makeLocateManager();
        stream.next({ userId: 5, position: { x: 1, y: 2 } });
        remotePlayers.set(5, stitch);
        vi.advanceTimersByTime(1000);

        wokaMenuStore.initialize("Me", 42, "me", undefined, true);
        vi.advanceTimersByTime(300);

        expect(stitch.showCard).not.toHaveBeenCalled();
    });

    it("ignores an answer that arrives after another card opened", async () => {
        const { wokaMenuStore, wokaMenuProgressStore } = await import("../../../Stores/WokaMenuStore");
        const { rememberLocateRequest } = await import("../LocateRequest");
        const { stream, remotePlayers, stitch } = await makeLocateManager();
        rememberLocateRequest("Stitch");

        // The player taps themselves before the server answers the search for Stitch.
        wokaMenuStore.initialize("Me", 42, "me", undefined, true);
        stream.next({ userId: 5, position: { x: 1, y: 2 } });

        expect(get(wokaMenuStore)?.isSelf).toBe(true);
        expect(get(wokaMenuProgressStore)).toBeUndefined();
        remotePlayers.set(5, stitch);
        vi.advanceTimersByTime(15_000);
        expect(stitch.showCard).not.toHaveBeenCalled();
    });

    it("still handles the answer when nothing else opened meanwhile", async () => {
        const { wokaMenuStore } = await import("../../../Stores/WokaMenuStore");
        const { rememberLocateRequest } = await import("../LocateRequest");
        const { stream } = await makeLocateManager();
        rememberLocateRequest("Stitch");

        stream.next({ userId: 5, position: { x: 1, y: 2 } });

        expect(get(wokaMenuStore)).toMatchObject({ userId: -1, wokaName: "Stitch" });
    });

    it("opens the found person's card over their own search card, the second time too", async () => {
        const { wokaMenuStore } = await import("../../../Stores/WokaMenuStore");
        const { stream, remotePlayers, stitch } = await makeLocateManager();
        for (let attempt = 1; attempt <= 2; attempt++) {
            stream.next({ userId: 5, position: { x: 1, y: 2 } });
            // Known by the repository: the search card already names Stitch.
            expect(get(wokaMenuStore)).toMatchObject({ userId: -1, userUuid: "stitch" });
            remotePlayers.set(5, stitch);
            vi.advanceTimersByTime(1000 + 300);
            expect(stitch.showCard).toHaveBeenCalledTimes(attempt);
        }
    });
});

describe("LocateManager: the camera and the open card", () => {
    afterEach(async () => {
        const { wokaMenuStore } = await import("../../../Stores/WokaMenuStore");
        wokaMenuStore.clear();
    });

    it("points the camera once per avatar, not on every update of the card", async () => {
        const { wokaMenuStore } = await import("../../../Stores/WokaMenuStore");
        const { cameraManager } = await makeLocateManager();

        wokaMenuStore.initialize("Stitch", 5, "stitch", "https://card.test");
        wokaMenuStore.addAction({ actionName: "Walk to", callback: () => {} });
        wokaMenuStore.addAction({ actionName: "Message", callback: () => {} });
        expect(cameraManager.followRemotePlayer).toHaveBeenCalledTimes(1);
        expect(cameraManager.followRemotePlayer).toHaveBeenCalledWith("stitch", 5);

        // Another session of the same person: the camera turns to that avatar.
        wokaMenuStore.initialize("Stitch", 6, "stitch", "https://card.test");
        expect(cameraManager.followRemotePlayer).toHaveBeenCalledTimes(2);
        expect(cameraManager.followRemotePlayer).toHaveBeenLastCalledWith("stitch", 6);
    });

    it("leaves the camera where a search centred it while the avatar isn't found yet", async () => {
        const { wokaMenuStore } = await import("../../../Stores/WokaMenuStore");
        const { cameraManager } = await makeLocateManager();

        wokaMenuStore.initialize("Stitch", -1, "stitch", undefined);

        expect(cameraManager.followRemotePlayer).not.toHaveBeenCalled();
    });
});
