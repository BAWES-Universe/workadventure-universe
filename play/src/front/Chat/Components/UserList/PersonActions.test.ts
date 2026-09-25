import { AvailabilityStatus } from "@workadventure/messages";
import { describe, expect, it } from "vitest";
import type { PersonActionsInput } from "./PersonActions";
import { getPersonActions, isConnected, isSelf } from "./PersonActions";

const HERE = "http://play.test/_/global/maps/here.json";
const ELSEWHERE = "http://play.test/_/global/maps/elsewhere.json";

function input(overrides: Partial<PersonActionsInput> = {}): PersonActionsInput {
    return {
        isSelf: false,
        status: AvailabilityStatus.ONLINE,
        uuid: "uuid-bob",
        chatId: "@bob:matrix.test",
        playUri: HERE,
        currentRoomUrl: HERE,
        visitCardUrl: undefined,
        isMatrixChatEnabled: true,
        roomCreationInProgress: false,
        iAmAdmin: false,
        ...overrides,
    };
}

describe("isSelf", () => {
    const me = { spaceUserId: "space-1", chatId: "@me:matrix.test", uuid: "uuid-me" };

    it("is true for this tab's own avatar", () => {
        expect(isSelf({ spaceUserId: "space-1", chatId: "@me:matrix.test", uuid: "uuid-me" }, me)).toBe(true);
    });

    it("treats another tab of the same account (a clone) as another person", () => {
        expect(isSelf({ spaceUserId: "space-2", chatId: "@me:matrix.test", uuid: "uuid-me" }, me)).toBe(false);
    });

    it("is false for someone else", () => {
        expect(isSelf({ spaceUserId: "space-3", chatId: "@bob:matrix.test", uuid: "uuid-bob" }, me)).toBe(false);
    });

    it("falls back to the account for entries without a space user id", () => {
        expect(isSelf({ spaceUserId: undefined, chatId: "@me:matrix.test", uuid: undefined }, me)).toBe(true);
        expect(isSelf({ spaceUserId: undefined, chatId: undefined, uuid: "uuid-me" }, me)).toBe(true);
        expect(isSelf({ spaceUserId: undefined, chatId: "@bob:matrix.test", uuid: undefined }, me)).toBe(false);
    });

    it("falls back to the account when this tab's space user id is not known yet", () => {
        const meWithoutSpace = { ...me, spaceUserId: undefined };
        expect(isSelf({ spaceUserId: "space-1", chatId: "@me:matrix.test", uuid: "uuid-me" }, meWithoutSpace)).toBe(
            true
        );
        expect(isSelf({ spaceUserId: "space-3", chatId: "@bob:matrix.test", uuid: "uuid-bob" }, meWithoutSpace)).toBe(
            false
        );
    });

    it("never matches on missing ids", () => {
        expect(
            isSelf(
                { spaceUserId: undefined, chatId: undefined, uuid: undefined },
                { spaceUserId: undefined, chatId: undefined, uuid: undefined }
            )
        ).toBe(false);
    });
});

describe("isConnected", () => {
    it("treats UNCHANGED and undefined as disconnected", () => {
        expect(isConnected(undefined)).toBe(false);
        expect(isConnected(AvailabilityStatus.UNCHANGED)).toBe(false);
        expect(isConnected(AvailabilityStatus.ONLINE)).toBe(true);
        expect(isConnected(AvailabilityStatus.AWAY)).toBe(true);
    });
});

describe("getPersonActions", () => {
    it("offers Walk to, Message and Locate for someone on this map", () => {
        const actions = getPersonActions(input());
        expect(actions.walkTo).toBe(true);
        expect(actions.goToRoom).toBe(false);
        expect(actions.message).toBe("enabled");
        expect(actions.locate).toBe(true);
        expect(actions.hasMenu).toBe(true);
    });

    it("offers Go to room instead of Walk to for someone on another map", () => {
        const actions = getPersonActions(input({ playUri: ELSEWHERE }));
        expect(actions.walkTo).toBe(false);
        expect(actions.goToRoom).toBe(true);
        expect(actions.locate).toBe(false);
        expect(actions.message).toBe("enabled");
    });

    it("offers nothing on yourself", () => {
        const actions = getPersonActions(input({ isSelf: true, visitCardUrl: "https://card.test", iAmAdmin: true }));
        expect(actions).toEqual({
            walkTo: false,
            goToRoom: false,
            message: "hidden",
            locate: false,
            businessCard: false,
            ban: false,
            hasMenu: false,
        });
    });

    it("offers no Walk to, Go to room or menu for a disconnected member, but keeps Message", () => {
        for (const status of [AvailabilityStatus.UNCHANGED, undefined]) {
            const actions = getPersonActions(
                input({ status, playUri: undefined, visitCardUrl: "https://card.test", iAmAdmin: true })
            );
            expect(actions.walkTo).toBe(false);
            expect(actions.goToRoom).toBe(false);
            expect(actions.hasMenu).toBe(false);
            expect(actions.message).toBe("enabled");
        }
    });

    it("offers no Walk to when the position is unknown", () => {
        expect(getPersonActions(input({ uuid: undefined })).walkTo).toBe(false);
        expect(getPersonActions(input({ uuid: "" })).walkTo).toBe(false);
        const noPlayUri = getPersonActions(input({ playUri: undefined }));
        expect(noPlayUri.walkTo).toBe(false);
        expect(noPlayUri.goToRoom).toBe(false);
    });

    it("shows no Message button for someone without a chat id, but keeps Walk to", () => {
        const actions = getPersonActions(input({ chatId: "" }));
        expect(actions.message).toBe("hidden");
        expect(actions.walkTo).toBe(true);
        expect(getPersonActions(input({ chatId: undefined })).message).toBe("hidden");
    });

    it("hides Message when the Matrix chat is disabled or a room is being created", () => {
        expect(getPersonActions(input({ isMatrixChatEnabled: false })).message).toBe("hidden");
        expect(getPersonActions(input({ roomCreationInProgress: true })).message).toBe("hidden");
    });

    it("keeps Business card and Ban in the menu", () => {
        const actions = getPersonActions(
            input({ playUri: ELSEWHERE, visitCardUrl: "https://card.test", iAmAdmin: true })
        );
        expect(actions.businessCard).toBe(true);
        expect(actions.ban).toBe(true);
        expect(actions.hasMenu).toBe(true);
    });

    it("shows Ban only to admins", () => {
        expect(getPersonActions(input()).ban).toBe(false);
        expect(getPersonActions(input({ iAmAdmin: true })).ban).toBe(true);
    });

    it("has no menu for someone on another map without card when not admin", () => {
        expect(getPersonActions(input({ playUri: ELSEWHERE })).hasMenu).toBe(false);
    });
});
