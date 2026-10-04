import { describe, expect, it } from "vitest";
import { readable } from "svelte/store";
import { AvailabilityStatus } from "@workadventure/messages";
import type { ChatUser } from "../../Connection/ChatConnection";
import { blockedPlayerUuids } from "../ChatBlockSync";

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

describe("blockedPlayerUuids", () => {
    it("finds the account ids of blocked people who are in Universe", () => {
        const usersByRoom = new Map([
            ["https://play/a", { users: [user("@bob:x", "bob"), user("@ann:x", "ann")] }],
            [undefined, { users: [user("@eve:x", undefined)] }],
        ]);
        expect(blockedPlayerUuids(["@bob:x", "@eve:x"], usersByRoom)).toEqual(["bob"]);
    });

    it("returns nothing when nobody is blocked", () => {
        expect(blockedPlayerUuids([], new Map([["https://play/a", { users: [user("@bob:x", "bob")] }]]))).toEqual([]);
    });
});
