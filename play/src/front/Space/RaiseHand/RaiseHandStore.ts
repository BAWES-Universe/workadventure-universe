import type { Readable } from "svelte/store";
import { derived, get, readable, writable } from "svelte/store";
import type { Subscription } from "rxjs";
import type { SpaceInterface, SpaceUserExtended } from "../SpaceInterface";

/**
 * Raising your hand in a conversation (a bubble or a meeting room), or in the audience of a podium.
 *
 * The hand is a field of the user in each conversation space (handRaisedAt), synchronized like the microphone and
 * the camera. The pusher stamps it with its own clock, so everybody sees the same order.
 */

export interface RaisedHand {
    uuid: string;
    spaceUserId: string;
    name: string;
    raisedAt: number;
    /** 1 for the first hand raised, 2 for the next one... */
    position: number;
    user: SpaceUserExtended;
}

/** The spaces whose raised hands we see, each with whether we can raise ours there (not while on a podium's stage). */
const conversationSpacesStore = writable<ReadonlyMap<SpaceInterface, Readable<boolean>>>(new Map());

/** True while we are in a conversation where a hand can be raised. */
export const canRaiseHandStore: Readable<boolean> = derived(
    conversationSpacesStore,
    (spaces, set) => {
        const canRaiseBySpace = new Map<SpaceInterface, boolean>();
        set(false);
        const unsubscribers = Array.from(spaces).map(([space, canRaise]) =>
            canRaise.subscribe((value) => {
                canRaiseBySpace.set(space, value);
                set(Array.from(canRaiseBySpace.values()).some(Boolean));
            })
        );
        return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    },
    false
);

/** Whether we want our hand up. Sent to every conversation we are in. */
export const myHandRaisedStore = writable(false);

export function raiseHand(): void {
    if (!get(canRaiseHandStore)) return;
    myHandRaisedStore.set(true);
}

export function lowerHand(): void {
    myHandRaisedStore.set(false);
}

/**
 * Called by a conversation space while it shares our microphone and camera state, and by a podium while we are in it
 * (where only the audience can raise a hand).
 * Returns the function to call when it stops: once we are in no conversation any more, our hand goes down.
 */
export function registerConversationSpace(
    space: SpaceInterface,
    canRaise: Readable<boolean> = readable(true)
): () => void {
    conversationSpacesStore.update((spaces) => new Map(spaces).set(space, canRaise));
    return () => {
        conversationSpacesStore.update((spaces) => {
            const remaining = new Map(spaces);
            remaining.delete(space);
            return remaining;
        });
        if (get(conversationSpacesStore).size === 0) {
            myHandRaisedStore.set(false);
        }
    };
}

/**
 * Orders the raised hands of a list of users: first raised first. A person in several conversations at once is
 * listed once, at their earliest hand.
 */
export function orderRaisedHands(users: Iterable<SpaceUserExtended>): RaisedHand[] {
    const byUuid = new Map<string, SpaceUserExtended>();
    for (const user of users) {
        const raisedAt = user.handRaisedAt ?? 0;
        if (raisedAt <= 0) continue;
        const known = byUuid.get(user.uuid);
        if (!known || raisedAt < (known.handRaisedAt ?? 0)) {
            byUuid.set(user.uuid, user);
        }
    }
    return Array.from(byUuid.values())
        .sort((a, b) => (a.handRaisedAt ?? 0) - (b.handRaisedAt ?? 0) || a.name.localeCompare(b.name))
        .map((user, index) => ({
            uuid: user.uuid,
            spaceUserId: user.spaceUserId,
            name: user.name,
            raisedAt: user.handRaisedAt ?? 0,
            position: index + 1,
            user,
        }));
}

/** Everyone with a raised hand in our conversations, ourselves included, in the order they raised it. */
export const raisedHandsStore: Readable<RaisedHand[]> = derived(conversationSpacesStore, (spaces, set) => {
    if (spaces.size === 0) {
        set([]);
        return;
    }
    const usersBySpace = new Map<SpaceInterface, ReadonlyMap<string, SpaceUserExtended>>();
    const audienceBySpace = new Map<SpaceInterface, ReadonlyMap<string, SpaceUserExtended>>();
    const recompute = () => {
        const users: SpaceUserExtended[] = [];
        for (const spaceUsers of [...usersBySpace.values(), ...audienceBySpace.values()]) {
            users.push(...spaceUsers.values());
        }
        set(orderRaisedHands(users));
    };
    const unsubscribers: (() => void)[] = [];
    const subscriptions: Subscription[] = [];
    for (const space of spaces.keys()) {
        unsubscribers.push(
            space.usersStore.subscribe((spaceUsers) => {
                usersBySpace.set(space, spaceUsers);
                recompute();
            })
        );
        unsubscribers.push(
            space.audienceHandsStore.subscribe((audienceHands) => {
                audienceBySpace.set(space, audienceHands);
                recompute();
            })
        );
        subscriptions.push(
            space.observeUserUpdated.subscribe((event) => {
                if (event.updateMask.includes("handRaisedAt")) recompute();
            })
        );
    }
    return () => {
        unsubscribers.forEach((unsubscribe) => unsubscribe());
        subscriptions.forEach((subscription) => subscription.unsubscribe());
    };
});

/**
 * Our place in line (1 = next), or undefined while our hand is down. Right after raising, before the server
 * answers, the hand is up with no number yet (0).
 */
export function myHandPositionStore(myUuid: string): Readable<number | undefined> {
    return derived([myHandRaisedStore, raisedHandsStore], ([raised, hands]) => {
        if (!raised) return undefined;
        return hands.find((hand) => hand.uuid === myUuid)?.position ?? 0;
    });
}
