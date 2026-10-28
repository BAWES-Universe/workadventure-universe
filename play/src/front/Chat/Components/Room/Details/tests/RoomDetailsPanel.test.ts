import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { readable, writable } from "svelte/store";

vi.mock("svelte-modals", () => ({ openModal: vi.fn() }));
vi.mock("../../ManageParticipantsModal.svelte", () => ({ default: {} }));
vi.mock("../../../TopRow/TopRowAvatar.svelte", async () => await import("./PartStub.svelte"));
vi.mock("../SharedSummary.svelte", async () => await import("./PartStub.svelte"));
vi.mock("../MemberRow.svelte", async () => await import("./PartStub.svelte"));
// Every text is the path it was asked by, except the note after leaving, which carries the name it was given.
vi.mock("../../../../../../i18n/i18n-svelte", () => {
    const text = (path: string[]): unknown =>
        new Proxy(() => path.join("."), {
            get: (_target, key) => text([...path, String(key)]),
            apply: (_target, _this, args: { name?: string }[]) =>
                path.at(-1) === "notification" ? `${path.join(".")}:${args[0]?.name}` : path.join("."),
        });
    return { default: readable(text([])), LL: readable(text([])) };
});

import type { MatrixChatRoom } from "../../../../Connection/Matrix/MatrixChatRoom";
import { chatDoneToastStore } from "../../../../../Stores/ChatDoneToastStore";
import RoomDetailsPanel from "../RoomDetailsPanel.svelte";

function groupRoom(name: string, leaveRoom: () => Promise<void>): MatrixChatRoom {
    return {
        id: "!group:chat.example.com",
        name: writable(name),
        members: readable([]),
        areNotificationsMuted: writable(false),
        hasPermissionTo: () => readable(false),
        currentRoomMember: readable(undefined),
        leaveRoom,
    } as unknown as MatrixChatRoom;
}

function shownNote(): string | undefined {
    let note: { text: string } | undefined;
    chatDoneToastStore.subscribe((value) => (note = value))();
    return note?.text;
}

describe("a group's details", () => {
    let component: RoomDetailsPanel | undefined;
    let target: HTMLElement;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
        chatDoneToastStore.set(undefined);
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
    });

    it("says which group was left, like the ⋯ menu", async () => {
        const leaveRoom = vi.fn(() => Promise.resolve());
        const room = groupRoom("Design team", leaveRoom);
        component = new RoomDetailsPanel({ target, props: { room } });
        await tick();

        target.querySelector<HTMLElement>('[data-testid="roomDetailsLeave"]')?.click();
        for (let i = 0; i < 3; i++) {
            // eslint-disable-next-line no-await-in-loop
            await tick();
        }

        expect(leaveRoom).toHaveBeenCalled();
        expect(shownNote()).toBe("chat.roomMenu.leaveRoom.notification:Design team");
    });
});
