import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import type { MatrixClient, User } from "matrix-js-sdk";
import { UserEvent } from "matrix-js-sdk";
import { AvailabilityStatus } from "@workadventure/messages";

vi.mock("../MatrixMedia", () => ({
    matrixAvatarStore: vi.fn(() => ({ subscribe: () => () => {} })),
}));

import { chatUserFactory } from "../MatrixChatUser";

const MISHARI = "@mishari:matrix.test";
const ALICE = "@alice:matrix.test";

function fakeUser(userId: string, presence: string): User {
    return { userId, presence, rawDisplayName: userId, avatarUrl: undefined } as unknown as User;
}

/** Sets the presence in place, as the SDK does, then announces it from the client. */
function changePresence(client: EventEmitter, user: User, presence: string): void {
    (user as unknown as { presence: string }).presence = presence;
    client.emit(UserEvent.Presence, undefined, user);
}

describe("chatUserFactory availability", () => {
    it("follows their chat status after the list was built (#1732)", () => {
        const client = new EventEmitter();
        const mishari = fakeUser(MISHARI, "online");
        const user = chatUserFactory(mishari, client as unknown as MatrixClient);

        const seen: AvailabilityStatus[] = [];
        const unsubscribe = user.availabilityStatus.subscribe((status) => seen.push(status));
        expect(seen.at(-1)).toBe(AvailabilityStatus.ONLINE);

        changePresence(client, mishari, "offline");
        expect(seen.at(-1)).toBe(AvailabilityStatus.UNCHANGED);

        changePresence(client, mishari, "unavailable");
        expect(seen.at(-1)).toBe(AvailabilityStatus.AWAY);
        unsubscribe();
    });

    it("ignores someone else's status", () => {
        const client = new EventEmitter();
        const mishari = fakeUser(MISHARI, "offline");
        const user = chatUserFactory(mishari, client as unknown as MatrixClient);
        const unsubscribe = user.availabilityStatus.subscribe(() => {});

        changePresence(client, fakeUser(ALICE, "offline"), "online");
        expect(get(user.availabilityStatus)).toBe(AvailabilityStatus.UNCHANGED);
        unsubscribe();
    });

    it("reads the status as it is now when first shown, and stops listening when no longer shown", () => {
        const client = new EventEmitter();
        const mishari = fakeUser(MISHARI, "online");
        const user = chatUserFactory(mishari, client as unknown as MatrixClient);

        (mishari as unknown as { presence: string }).presence = "offline";
        expect(get(user.availabilityStatus)).toBe(AvailabilityStatus.UNCHANGED);
        expect(client.listenerCount(UserEvent.Presence)).toBe(0);

        const unsubscribe = user.availabilityStatus.subscribe(() => {});
        expect(client.listenerCount(UserEvent.Presence)).toBe(1);
        unsubscribe();
        expect(client.listenerCount(UserEvent.Presence)).toBe(0);
    });
});
