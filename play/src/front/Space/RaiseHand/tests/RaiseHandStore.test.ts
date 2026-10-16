import { describe, expect, it } from "vitest";
import { get, readable, writable } from "svelte/store";
import { Subject } from "rxjs";
import type { SpaceInterface, SpaceUserExtended, UpdateSpaceUserEvent } from "../../SpaceInterface";
import {
    canRaiseHandStore,
    lowerHand,
    myHandPositionStore,
    myHandRaisedStore,
    orderRaisedHands,
    raiseHand,
    raisedHandsStore,
    registerConversationSpace,
} from "../RaiseHandStore";

function user(uuid: string, name: string, handRaisedAt?: number): SpaceUserExtended {
    return { uuid, name, spaceUserId: "space-" + uuid, handRaisedAt } as unknown as SpaceUserExtended;
}

function fakeSpace(users: SpaceUserExtended[], audience: SpaceUserExtended[] = []) {
    const usersStore = writable(new Map(users.map((u) => [u.spaceUserId, u])));
    const audienceHandsStore = writable(new Map(audience.map((u) => [u.spaceUserId, u])));
    const updated = new Subject<UpdateSpaceUserEvent>();
    const space = {
        usersStore,
        audienceHandsStore,
        observeUserUpdated: updated.asObservable(),
    } as unknown as SpaceInterface;
    return { space, usersStore, audienceHandsStore, updated };
}

describe("orderRaisedHands", () => {
    it("lists raised hands first raised first, numbered from 1", () => {
        const hands = orderRaisedHands([user("a", "Ann", 300), user("b", "Bob", 0), user("c", "Cid", 100)]);
        expect(hands.map((hand) => [hand.name, hand.position])).toEqual([
            ["Cid", 1],
            ["Ann", 2],
        ]);
    });

    it("lists a person in two conversations once, at their earliest hand", () => {
        const hands = orderRaisedHands([user("a", "Ann", 300), user("b", "Bob", 200), user("a", "Ann", 100)]);
        expect(hands.map((hand) => [hand.name, hand.raisedAt])).toEqual([
            ["Ann", 100],
            ["Bob", 200],
        ]);
    });

    it("ignores users from servers that don't send the field", () => {
        expect(orderRaisedHands([user("a", "Ann")])).toEqual([]);
    });
});

describe("raise hand stores", () => {
    it("can only raise a hand in a conversation, and lowers it on leaving the last one", () => {
        raiseHand();
        expect(get(myHandRaisedStore)).toBe(false);

        const first = registerConversationSpace(fakeSpace([]).space);
        const second = registerConversationSpace(fakeSpace([]).space);
        expect(get(canRaiseHandStore)).toBe(true);

        raiseHand();
        expect(get(myHandRaisedStore)).toBe(true);
        first();
        expect(get(myHandRaisedStore)).toBe(true);
        second();
        expect(get(myHandRaisedStore)).toBe(false);
        expect(get(canRaiseHandStore)).toBe(false);
    });

    it("follows hands going up in the conversations, and gives our place in line", () => {
        const me = user("me", "Me", 0);
        const ann = user("ann", "Ann", 0);
        const { space, updated } = fakeSpace([me, ann]);
        const leave = registerConversationSpace(space);
        const myPosition = myHandPositionStore("me");
        const unsubscribe = myPosition.subscribe(() => {});

        expect(get(raisedHandsStore)).toEqual([]);

        ann.handRaisedAt = 100;
        updated.next({ newUser: ann, changes: { handRaisedAt: 100 }, updateMask: ["handRaisedAt"] });
        expect(get(raisedHandsStore).map((hand) => hand.name)).toEqual(["Ann"]);

        raiseHand();
        // Up at once, with no number until the server answers.
        expect(get(myPosition)).toBe(0);

        me.handRaisedAt = 200;
        updated.next({ newUser: me, changes: { handRaisedAt: 200 }, updateMask: ["handRaisedAt"] });
        expect(get(myPosition)).toBe(2);

        lowerHand();
        expect(get(myPosition)).toBeUndefined();

        unsubscribe();
        leave();
    });

    it("on a podium, lists the audience's hands and lets only the audience raise one", () => {
        const speaker = user("speaker", "Sam", 0);
        const { space, audienceHandsStore } = fakeSpace([speaker]);
        const inAudience = writable(false);
        const leave = registerConversationSpace(space, inAudience);
        expect(get(canRaiseHandStore)).toBe(false);
        raiseHand();
        expect(get(myHandRaisedStore)).toBe(false);

        audienceHandsStore.set(new Map([["space-ann", user("ann", "Ann", 100)]]));
        expect(get(raisedHandsStore).map((hand) => hand.name)).toEqual(["Ann"]);

        inAudience.set(true);
        expect(get(canRaiseHandStore)).toBe(true);
        leave();
    });

    it("can raise a hand while one space allows it", () => {
        const stage = registerConversationSpace(fakeSpace([]).space, readable(false));
        const bubble = registerConversationSpace(fakeSpace([]).space);
        expect(get(canRaiseHandStore)).toBe(true);
        bubble();
        expect(get(canRaiseHandStore)).toBe(false);
        stage();
    });
});
