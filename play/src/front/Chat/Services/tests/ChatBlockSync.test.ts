import { describe, expect, it } from "vitest";
import { readable } from "svelte/store";
import { AvailabilityStatus } from "@workadventure/messages";
import type { ChatUser } from "../../Connection/ChatConnection";
import { blockedPlayers, chatBlockSyncStep } from "../ChatBlockSync";

function user(chatId: string, uuid: string | undefined): ChatUser {
    return {
        chatId,
        uuid,
        availabilityStatus: readable(AvailabilityStatus.ONLINE),
        username: chatId,
        pictureStore: undefined,
        roomName: undefined,
        playUri: undefined,
        color: undefined,
        spaceUserId: undefined,
    };
}

describe("blockedPlayers", () => {
    it("finds the account ids of blocked people who are in Universe", () => {
        const usersByRoom = new Map([
            ["https://play/a", { users: [user("@bob:x", "bob"), user("@ann:x", "ann")] }],
            [undefined, { users: [user("@eve:x", undefined)] }],
        ]);
        expect(blockedPlayers(["@bob:x", "@eve:x"], usersByRoom)).toEqual(new Map([["bob", "@bob:x"]]));
    });

    it("returns nothing when nobody is blocked", () => {
        expect(blockedPlayers([], new Map([["https://play/a", { users: [user("@bob:x", "bob")] }]])).size).toBe(0);
    });
});

describe("chatBlockSyncStep", () => {
    const here = new Map([["https://play/a", { users: [user("@bob:x", "bob"), user("@ann:x", "ann")] }]]);

    it("blocks people blocked in chat while they're around", () => {
        const step = chatBlockSyncStep(new Map(), ["@bob:x"], here);
        expect(step.toBlock).toEqual(["bob"]);
        expect(step.toUnblock).toEqual([]);
        expect(step.synced).toEqual(new Map([["bob", "@bob:x"]]));
    });

    it("lifts the game block when they're unblocked in chat, even from another device", () => {
        const step = chatBlockSyncStep(new Map([["bob", "@bob:x"]]), [], here);
        expect(step.toUnblock).toEqual(["bob"]);
        expect(step.toBlock).toEqual([]);
        expect(step.synced.size).toBe(0);
    });

    it("keeps the block when they leave Universe but are still blocked", () => {
        const step = chatBlockSyncStep(new Map([["bob", "@bob:x"]]), ["@bob:x"], new Map());
        expect(step.toUnblock).toEqual([]);
        expect(step.synced).toEqual(new Map([["bob", "@bob:x"]]));
    });

    it("doesn't block them again when someone joins or leaves, so an unblock from the map sticks", () => {
        const step = chatBlockSyncStep(new Map([["bob", "@bob:x"]]), ["@bob:x"], here);
        expect(step.toBlock).toEqual([]);
        expect(step.toUnblock).toEqual([]);
        expect(step.synced).toEqual(new Map([["bob", "@bob:x"]]));
    });

    it("blocks them again after they're unblocked in chat and blocked once more", () => {
        const unblocked = chatBlockSyncStep(new Map([["bob", "@bob:x"]]), [], here);
        expect(chatBlockSyncStep(unblocked.synced, ["@bob:x"], here).toBlock).toEqual(["bob"]);
    });
});
