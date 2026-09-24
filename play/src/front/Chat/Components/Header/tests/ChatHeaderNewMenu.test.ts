import { describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { focusChatSearchRequest, getNewChatOptions, nextMenuIndex } from "../ChatHeaderNewMenu";

const signedIn = { isSignedIn: true, isMatrixGuest: false, chatStatus: "ONLINE", isPeopleListEnabled: true };

describe("getNewChatOptions", () => {
    it("offers New message, New room and New folder when signed in and online", () => {
        expect(getNewChatOptions(signedIn)).toEqual(["newMessage", "newRoom", "newFolder"]);
    });

    it("offers nothing to a guest, so the + is hidden", () => {
        expect(getNewChatOptions({ ...signedIn, isSignedIn: false })).toEqual([]);
    });

    it("offers nothing to a Matrix guest session", () => {
        expect(getNewChatOptions({ ...signedIn, isMatrixGuest: true })).toEqual([]);
    });

    it.each(["OFFLINE", "CONNECTING", "ON_ERROR"])("offers nothing while the chat is %s", (chatStatus) => {
        expect(getNewChatOptions({ ...signedIn, chatStatus })).toEqual([]);
    });

    it("leaves out New message when the map has no People tab", () => {
        expect(getNewChatOptions({ ...signedIn, isPeopleListEnabled: false })).toEqual(["newRoom", "newFolder"]);
    });
});

describe("nextMenuIndex", () => {
    it("moves down and wraps", () => {
        expect(nextMenuIndex(0, "ArrowDown", 3)).toBe(1);
        expect(nextMenuIndex(2, "ArrowDown", 3)).toBe(0);
    });

    it("moves up and wraps", () => {
        expect(nextMenuIndex(1, "ArrowUp", 3)).toBe(0);
        expect(nextMenuIndex(0, "ArrowUp", 3)).toBe(2);
    });

    it("starts at the ends when nothing has focus yet", () => {
        expect(nextMenuIndex(-1, "ArrowDown", 3)).toBe(0);
        expect(nextMenuIndex(-1, "ArrowUp", 3)).toBe(2);
    });

    it("jumps with Home and End", () => {
        expect(nextMenuIndex(1, "Home", 3)).toBe(0);
        expect(nextMenuIndex(1, "End", 3)).toBe(2);
    });

    it("ignores other keys and empty menus", () => {
        expect(nextMenuIndex(0, "a", 3)).toBeUndefined();
        expect(nextMenuIndex(0, "ArrowDown", 0)).toBeUndefined();
    });
});

describe("focusChatSearchRequest", () => {
    it("starts cleared", () => {
        expect(get(focusChatSearchRequest)).toBe(false);
    });
});
