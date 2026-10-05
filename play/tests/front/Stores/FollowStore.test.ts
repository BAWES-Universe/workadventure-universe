import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { FOLLOW_REQUEST_TIMEOUT_MS } from "@workadventure/shared-utils";
// vi.mock() calls are hoisted above these imports: the store loads without the game and the popups.
import {
    FOLLOW_NOTE_DURATION_MS,
    followAskedStore,
    followNoteStore,
    followRequestStartedAtStore,
    followRoleStore,
    followStateStore,
    followUsersStore,
} from "../../../src/front/Stores/FollowStore";

vi.mock("../../../src/front/Phaser/Game/GameManager", () => ({ gameManager: {} }));
vi.mock("../../../src/front/Components/PopUp/PopUpFollow.svelte", () => ({ default: {} }));
vi.mock("../../../src/front/Stores/PopupStore", () => ({
    popupStore: { addPopup: vi.fn(), removePopup: vi.fn() },
}));

const bossman = { userId: 2, name: "Bossman Tester" };
const sara = { userId: 3, name: "Sara" };
const khalid = { userId: 1, name: "Khalid" };

describe("FollowStore", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        followUsersStore.stopFollowing();
        followNoteStore.set(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("the leader", () => {
        it("keeps the card while others are still deciding when the first one says no", () => {
            followUsersStore.startRequest([bossman, sara]);

            followUsersStore.removeFollower(bossman.userId);

            expect(get(followStateStore)).toBe("requesting");
            expect(get(followAskedStore).map((person) => person.answer)).toEqual(["declined", "waiting"]);

            followUsersStore.addFollower(sara);

            // Everyone answered and one follows: the card becomes the pill.
            expect(get(followStateStore)).toBe("active");
            expect(get(followUsersStore)).toEqual([sara.userId]);
            expect(get(followRequestStartedAtStore)).toBeUndefined();
        });

        it("shows who follows while waiting for the others, then leads when the time is up", () => {
            followUsersStore.startRequest([bossman, sara]);
            followUsersStore.addFollower(bossman);

            expect(get(followStateStore)).toBe("requesting");
            expect(get(followAskedStore).map((person) => person.answer)).toEqual(["following", "waiting"]);

            vi.advanceTimersByTime(FOLLOW_REQUEST_TIMEOUT_MS);

            expect(get(followStateStore)).toBe("active");
            expect(get(followRoleStore)).toBe("leader");
            expect(get(followUsersStore)).toEqual([bossman.userId]);
        });

        it("says who said no when the only one asked declines", () => {
            followUsersStore.startRequest([bossman]);

            followUsersStore.removeFollower(bossman.userId);

            expect(get(followStateStore)).toBe("off");
            expect(get(followNoteStore)).toEqual({ kind: "saidNo", person: { ...bossman, answer: "declined" } });

            vi.advanceTimersByTime(FOLLOW_NOTE_DURATION_MS);
            expect(get(followNoteStore)).toBeUndefined();
        });

        it("says nobody answered when the time runs out", () => {
            followUsersStore.startRequest([bossman]);
            vi.advanceTimersByTime(FOLLOW_REQUEST_TIMEOUT_MS);

            expect(get(followStateStore)).toBe("off");
            expect(get(followNoteStore)?.kind).toBe("noAnswer");

            followUsersStore.startRequest([bossman, sara]);
            followUsersStore.removeFollower(bossman.userId);
            vi.advanceTimersByTime(FOLLOW_REQUEST_TIMEOUT_MS);

            expect(get(followStateStore)).toBe("off");
            expect(get(followNoteStore)?.kind).toBe("nobodySaidYes");
        });

        it("stops leading once the last follower stops", () => {
            followUsersStore.startRequest([bossman]);
            followUsersStore.addFollower(bossman);
            expect(get(followStateStore)).toBe("active");

            followUsersStore.removeFollower(bossman.userId);

            expect(get(followStateStore)).toBe("off");
            expect(get(followNoteStore)).toBeUndefined();
        });

        it("leads straight away when a script made the others follow", () => {
            followUsersStore.addFollower(bossman);

            expect(get(followStateStore)).toBe("active");
            expect(get(followRoleStore)).toBe("leader");
        });
    });

    describe("the one asked", () => {
        it("closes the question when the time is up", () => {
            followUsersStore.addFollowRequest(khalid);
            expect(get(followStateStore)).toBe("requesting");
            expect(get(followRoleStore)).toBe("follower");

            vi.advanceTimersByTime(FOLLOW_REQUEST_TIMEOUT_MS);

            expect(get(followStateStore)).toBe("off");
            expect(get(followNoteStore)).toEqual({ kind: "timedOut", person: khalid });
        });

        it("closes the question when the leader cancels", () => {
            followUsersStore.addFollowRequest(khalid);

            followUsersStore.endFromLeader(khalid.userId, 0);

            expect(get(followStateStore)).toBe("off");
            expect(get(followNoteStore)).toEqual({ kind: "cancelled", person: khalid });
        });

        it("says the leader stopped leading", () => {
            followUsersStore.addFollowRequest(khalid);
            followUsersStore.follow();
            vi.advanceTimersByTime(FOLLOW_REQUEST_TIMEOUT_MS);
            expect(get(followStateStore)).toBe("active");

            followUsersStore.endFromLeader(khalid.userId, 5);

            expect(get(followStateStore)).toBe("off");
            expect(get(followNoteStore)?.kind).toBe("stoppedLeading");
        });

        it("ignores the end of someone else's request", () => {
            followUsersStore.addFollowRequest(khalid);

            followUsersStore.endFromLeader(sara.userId, 0);

            expect(get(followStateStore)).toBe("requesting");
        });
    });
});
