import { describe, expect, it } from "vitest";
import { AvailabilityStatus } from "@workadventure/messages";
import { readable } from "svelte/store";
import type { ChatUser } from "../../../../Connection/ChatConnection";
import type { PartnerPlaceInput } from "../PartnerPlace";
import { findInUniverse, isInUniverse, partnerActions, resolvePartnerPlace } from "../PartnerPlace";

const inGameHere: PartnerPlaceInput = {
    inGame: true,
    sameMap: true,
    roomName: "Lobby",
    availability: AvailabilityStatus.ONLINE,
    talkingWithYou: false,
    chatPresence: "online",
};

describe("resolvePartnerPlace", () => {
    it("says where they are when they're in Universe", () => {
        expect(resolvePartnerPlace(inGameHere)).toEqual({ kind: "here", roomName: "Lobby" });
        expect(resolvePartnerPlace({ ...inGameHere, sameMap: false, roomName: "Rooftop" })).toEqual({
            kind: "elsewhere",
            roomName: "Rooftop",
        });
    });

    it("puts talking with you before any status", () => {
        expect(
            resolvePartnerPlace({ ...inGameHere, talkingWithYou: true, availability: AvailabilityStatus.AWAY })
        ).toEqual({ kind: "talking" });
    });

    it("shows away and busy statuses", () => {
        expect(resolvePartnerPlace({ ...inGameHere, availability: AvailabilityStatus.BACK_IN_A_MOMENT })).toEqual({
            kind: "away",
            status: AvailabilityStatus.BACK_IN_A_MOMENT,
            roomName: "Lobby",
            sameMap: true,
        });
        expect(
            resolvePartnerPlace({ ...inGameHere, sameMap: false, availability: AvailabilityStatus.DO_NOT_DISTURB })
        ).toEqual({ kind: "busy", status: AvailabilityStatus.DO_NOT_DISTURB, roomName: "Lobby", sameMap: false });
    });

    it("tells chat-only people from offline ones", () => {
        const notInGame = { ...inGameHere, inGame: false };
        expect(resolvePartnerPlace({ ...notInGame, chatPresence: "online" })).toEqual({ kind: "chatOnly" });
        expect(resolvePartnerPlace({ ...notInGame, chatPresence: "away" })).toEqual({ kind: "chatOnly" });
        expect(resolvePartnerPlace({ ...notInGame, chatPresence: "offline" })).toEqual({ kind: "offline" });
    });
});

describe("partnerActions", () => {
    it("offers only what works right now", () => {
        expect(partnerActions({ kind: "here" }, true)).toEqual({ walkTo: true, locate: true });
        expect(partnerActions({ kind: "elsewhere" }, true)).toEqual({ walkTo: true, locate: false });
        expect(partnerActions({ kind: "talking" }, true)).toEqual({ walkTo: false, locate: true });
        expect(partnerActions({ kind: "away", status: AvailabilityStatus.AWAY, sameMap: false }, true)).toEqual({
            walkTo: true,
            locate: false,
        });
        expect(partnerActions({ kind: "busy", status: AvailabilityStatus.BUSY, sameMap: true }, true)).toEqual({
            walkTo: true,
            locate: true,
        });
        expect(partnerActions({ kind: "chatOnly" }, true)).toEqual({ walkTo: false, locate: false });
        expect(partnerActions({ kind: "offline" }, true)).toEqual({ walkTo: false, locate: false });
    });

    it("offers nothing when there is no avatar to reach", () => {
        expect(partnerActions({ kind: "here" }, false)).toEqual({ walkTo: false, locate: false });
    });
});

describe("isInUniverse", () => {
    it("is false only for chat-only and offline people", () => {
        expect(isInUniverse({ kind: "here" })).toBe(true);
        expect(isInUniverse({ kind: "away", status: AvailabilityStatus.AWAY, sameMap: false })).toBe(true);
        expect(isInUniverse({ kind: "chatOnly" })).toBe(false);
        expect(isInUniverse({ kind: "offline" })).toBe(false);
    });
});

function user(chatId: string, playUri: string | undefined): ChatUser {
    return {
        chatId,
        uuid: `uuid-${chatId}`,
        availabilityStatus: readable(AvailabilityStatus.ONLINE),
        username: chatId,
        pictureStore: undefined,
        roomName: undefined,
        playUri,
        color: undefined,
        spaceUserId: undefined,
    };
}

describe("findInUniverse", () => {
    it("ignores chat accounts that have no map", () => {
        const map = new Map([[undefined, { roomName: undefined, users: [user("@bob:x", undefined)] }]]);
        expect(findInUniverse(map, "@bob:x", "https://play/a")).toBeUndefined();
    });

    it("prefers their avatar on your map, with its room name", () => {
        const map = new Map([
            ["https://play/b", { roomName: "Rooftop", users: [user("@bob:x", undefined)] }],
            ["https://play/a", { roomName: "Lobby", users: [user("@bob:x", undefined)] }],
        ]);
        expect(findInUniverse(map, "@bob:x", "https://play/a")).toMatchObject({
            roomName: "Lobby",
            user: { playUri: "https://play/a" },
        });
        expect(findInUniverse(map, "@bob:x", "https://play/c")).toMatchObject({ roomName: "Rooftop" });
    });
});
