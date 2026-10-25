import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get, readable } from "svelte/store";
import type { MatrixClient, MatrixEvent, RoomMember } from "matrix-js-sdk";
import { RoomMemberEvent } from "matrix-js-sdk";
import { MatrixChatRoomMember } from "../MatrixChatRoomMember";
import { TYPING_STOP_GRACE_MS } from "../../ChatConnection";

vi.mock("../MatrixMedia", () => ({
    changingMatrixAvatarStore: () => readable(undefined),
}));

class FakeRoomMember extends EventEmitter {
    userId = "@sara:chat.test";
    name = "Sara";
    membership = "join";
    powerLevelNorm = 0;
    typing = false;
    getMxcAvatarUrl(): string | undefined {
        return undefined;
    }
    setTyping(typing: boolean): void {
        this.typing = typing;
        this.emit(RoomMemberEvent.Typing, {} as MatrixEvent, this);
    }
}

describe("MatrixChatRoomMember typing (#1379)", () => {
    let roomMember: FakeRoomMember;
    let member: MatrixChatRoomMember;
    const typing = () => get(member.isTypingInformation) !== null;

    beforeEach(() => {
        vi.useFakeTimers();
        roomMember = new FakeRoomMember();
        member = new MatrixChatRoomMember(roomMember as unknown as RoomMember, {} as MatrixClient);
    });

    afterEach(() => {
        member.destroy();
        vi.useRealTimers();
    });

    it("shows the dots as soon as they type", () => {
        roomMember.setTyping(true);
        expect(get(member.isTypingInformation)).toMatchObject({ id: "@sara:chat.test", name: "Sara" });
    });

    it("keeps the dots a moment after they stop, then hides them", () => {
        roomMember.setTyping(true);
        roomMember.setTyping(false);
        vi.advanceTimersByTime(TYPING_STOP_GRACE_MS - 1);
        expect(typing()).toBe(true);
        vi.advanceTimersByTime(1);
        expect(typing()).toBe(false);
    });

    it("never blinks when they start again within that moment", () => {
        roomMember.setTyping(true);
        roomMember.setTyping(false);
        vi.advanceTimersByTime(TYPING_STOP_GRACE_MS / 2);
        roomMember.setTyping(true);
        vi.advanceTimersByTime(TYPING_STOP_GRACE_MS * 2);
        expect(typing()).toBe(true);
    });

    it("hides the dots at once when their message arrives", () => {
        roomMember.setTyping(true);
        roomMember.setTyping(false);
        member.stoppedTyping();
        expect(typing()).toBe(false);
        vi.advanceTimersByTime(TYPING_STOP_GRACE_MS * 2);
        expect(typing()).toBe(false);
    });

    it("does nothing on a stop from someone who was not typing", () => {
        roomMember.setTyping(false);
        expect(typing()).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });
});
