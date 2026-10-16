import { describe, expect, it } from "vitest";
import { get, writable } from "svelte/store";
import type { ChatRoomMember, ChatRoomMembership } from "../../../../Connection/ChatConnection";
import { holdsTheChat, partnerStillInChat } from "../partnerStillInChat";

function member(id: string, membership: ChatRoomMembership) {
    const store = writable<ChatRoomMembership>(membership);
    return { member: { id, membership: store } as unknown as ChatRoomMember, store };
}

describe("holdsTheChat", () => {
    it("is true for someone joined or invited, false once they left, were kicked or banned", () => {
        expect(holdsTheChat("join")).toBe(true);
        expect(holdsTheChat("invite")).toBe(true);
        expect(holdsTheChat("leave")).toBe(false);
        expect(holdsTheChat("ban")).toBe(false);
    });
});

describe("partnerStillInChat", () => {
    it("is true while the other person is in the room", () => {
        const me = member("@me:x", "join");
        const partner = member("@you:x", "join");

        expect(get(partnerStillInChat(writable([me.member, partner.member]), "@me:x"))).toBe(true);
    });

    it("is true while the other person has only been invited", () => {
        const me = member("@me:x", "join");
        const partner = member("@you:x", "invite");

        expect(get(partnerStillInChat(writable([me.member, partner.member]), "@me:x"))).toBe(true);
    });

    it("is false once the other person has left", () => {
        const me = member("@me:x", "join");
        const partner = member("@you:x", "leave");

        expect(get(partnerStillInChat(writable([me.member, partner.member]), "@me:x"))).toBe(false);
    });

    it("follows the other person leaving while the panel is open", () => {
        const me = member("@me:x", "join");
        const partner = member("@you:x", "join");
        const seen: boolean[] = [];
        const unsubscribe = partnerStillInChat(writable([me.member, partner.member]), "@me:x").subscribe((value) =>
            seen.push(value)
        );

        partner.store.set("leave");
        unsubscribe();

        expect(seen).toEqual([true, false]);
    });

    it("is true while the members are not known yet", () => {
        expect(get(partnerStillInChat(writable([]), "@me:x"))).toBe(true);
    });
});
