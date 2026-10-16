import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { readable, writable } from "svelte/store";

const icon = vi.hoisted(() => ({ component: undefined as unknown }));
const partnerActions = vi.hoisted(() => ({
    canInvitePartner: vi.fn(() => true),
    canOpenPartnerProfile: vi.fn(() => false),
    invitePartner: vi.fn(),
    locatePartner: vi.fn(),
    openPartnerProfile: vi.fn(),
    partnerFriendAction: vi.fn(() => ({ label: "friend action", icon: icon.component, danger: false, act: () => {} })),
    walkToPartner: vi.fn(),
}));
vi.mock("../../DirectChat/PartnerActions", () => partnerActions);
vi.mock("../../DirectChat/DirectPartnerStore", async () => {
    const { readable: store } = await import("svelte/store");
    return {
        directPartnerStore: () =>
            store({
                chatId: "@ada:chat.example.com",
                actions: { walkTo: true, locate: true },
            }),
    };
});
vi.mock("../../DirectChat/partnerStillInChat", async () => {
    const { readable: store } = await import("svelte/store");
    return { partnerStillInChat: () => store(true) };
});
vi.mock("svelte-modals", () => ({ openModal: vi.fn() }));
vi.mock("../../ManageParticipantsModal.svelte", () => ({ default: {} }));
vi.mock("../../../../../Connection/LocalUserStore", () => ({
    localUserStore: { getChatId: () => "@me:chat.example.com" },
}));
vi.mock("../../../../Stores/FriendsStore", async () => {
    const { writable: store } = await import("svelte/store");
    return { friendsEnabledStore: store(true), relationshipsStore: store(new Map()) };
});
vi.mock("../../../../Stores/RingStore", async () => {
    const { writable: store } = await import("svelte/store");
    return { invitesEnabledStore: store(true) };
});
// Every text is the path it was asked by, except the delete hints, which carry the name they were given.
vi.mock("../../../../../../i18n/i18n-svelte", () => {
    const text = (path: string[]): unknown =>
        new Proxy(() => path.join("."), {
            get: (_target, key) => text([...path, String(key)]),
            apply: (_target, _this, args: { name?: string }[]) =>
                path.at(-1)?.startsWith("hint") ? `${path.at(-1)}:${args[0]?.name}` : path.join("."),
        });
    return { default: readable(text([])), LL: readable(text([])) };
});

import type {
    ChatRoom,
    ChatRoomMembershipManagement,
    ChatRoomModeration,
    ChatRoomNotificationControl,
} from "../../../../Connection/ChatConnection";
import { NAME_BY_CHAT_ID_CONTEXT } from "../../../../Stores/ChatUserWokaStore";
import RoomMenu from "../RoomMenu.svelte";
import { IconDots } from "@wa-icons";

icon.component = IconDots;

type MenuRoom = ChatRoom & ChatRoomMembershipManagement & ChatRoomNotificationControl & ChatRoomModeration;

function directRoom(name: string): MenuRoom {
    return {
        id: "!dm:chat.example.com",
        type: "direct",
        name: writable(name),
        members: readable([]),
        areNotificationsMuted: writable(false),
        hasPermissionTo: () => readable(false),
    } as unknown as MenuRoom;
}

describe("a direct chat's ⋯ menu", () => {
    let component: RoomMenu | undefined;
    let target: HTMLElement;

    /** The menu of a chat whose room kept the name "Old Name" while the person now goes by "New Name". */
    async function open(names: Map<string, string>) {
        component = new RoomMenu({
            target,
            props: { room: directRoom("Old Name") },
            context: new Map([[NAME_BY_CHAT_ID_CONTEXT, readable(names)]]),
        });
        await tick();
    }

    beforeEach(() => {
        target = document.createElement("div");
        document.body.append(target);
        for (const mock of Object.values(partnerActions)) mock.mockClear();
    });

    afterEach(() => {
        component?.$destroy();
        document.body.innerHTML = "";
    });

    function click(selector: string) {
        const button = target.querySelector<HTMLElement>(selector);
        expect(button).not.toBeNull();
        button?.click();
    }

    it("uses the name the person goes by now for Invite, Add friend, Locate and the Delete hint", async () => {
        await open(new Map([["@ada:chat.example.com", "New Name"]]));

        expect(partnerActions.partnerFriendAction).toHaveBeenLastCalledWith(
            expect.anything(),
            "New Name",
            true,
            expect.anything(),
            expect.anything()
        );

        click('[data-testid="inviteOption"]');
        expect(partnerActions.invitePartner).toHaveBeenCalledWith(expect.anything(), "New Name");

        const locate = Array.from(target.querySelectorAll<HTMLElement>("button")).find(
            (button) => button.textContent?.trim() === "chat.userList.follow"
        );
        locate?.click();
        expect(partnerActions.locatePartner).toHaveBeenCalledWith(expect.anything(), "New Name");

        // Choosing an option closes the menu: open it again for the delete row.
        click('[data-testid="toggleRoomMenu"]');
        click('[data-testid="deleteChatOption"]');
        await tick();
        expect(target.querySelector('[data-testid="deleteChatConfirm"]')?.textContent).toContain("hint:New Name");
    });

    it("keeps the room's name for someone Universe does not know", async () => {
        await open(new Map());

        click('[data-testid="inviteOption"]');
        expect(partnerActions.invitePartner).toHaveBeenCalledWith(expect.anything(), "Old Name");
    });
});
