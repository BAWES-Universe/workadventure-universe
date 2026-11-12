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
// Who the chat is with: a person by default; a test can make it a bot
const partner = vi.hoisted(() => ({ chatId: "@ada:chat.example.com", isBot: false }));
const sheet = vi.hoisted(() => ({ openModal: vi.fn(), own: [] as { id: string }[] }));
vi.mock("../../DirectChat/DirectPartnerStore", async () => {
    const { readable: store } = await import("svelte/store");
    return {
        directPartnerStore: () =>
            store({
                chatId: partner.chatId,
                isBot: partner.isBot,
                actions: { walkTo: true, locate: true },
            }),
    };
});
// What a bot remembers about the person has its own tests; here only that the chat menu offers it
vi.mock("../../../../Bricks/MemorySheet.svelte", () => ({ default: {} }));
vi.mock("../../../../Bricks/MyBricksStore", async () => {
    const { readable: store } = await import("svelte/store");
    return { myBricksStore: store(sheet.own) };
});
vi.mock("../../DirectChat/partnerStillInChat", async () => {
    const { readable: store } = await import("svelte/store");
    return { partnerStillInChat: () => store(true) };
});
vi.mock("svelte-modals", () => ({ openModal: sheet.openModal }));
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
// Every text is the path it was asked by, except the delete hints and the notes after deleting or leaving, which carry
// the name they were given.
vi.mock("../../../../../../i18n/i18n-svelte", () => {
    const text = (path: string[]): unknown =>
        new Proxy(() => path.join("."), {
            get: (_target, key) => text([...path, String(key)]),
            apply: (_target, _this, args: { name?: string }[]) =>
                path.at(-1)?.startsWith("hint")
                    ? `${path.at(-1)}:${args[0]?.name}`
                    : path.at(-1) === "notification"
                    ? `${path.join(".")}:${args[0]?.name}`
                    : path.join("."),
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
import { chatDoneToastStore } from "../../../../../Stores/ChatDoneToastStore";
import RoomMenu from "../RoomMenu.svelte";
import { IconDots } from "@wa-icons";

icon.component = IconDots;

type MenuRoom = ChatRoom & ChatRoomMembershipManagement & ChatRoomNotificationControl & ChatRoomModeration;

function directRoom(name: string, type: "direct" | "multiple" = "direct"): MenuRoom {
    return {
        id: "!dm:chat.example.com",
        type,
        name: writable(name),
        members: readable([]),
        areNotificationsMuted: writable(false),
        hasPermissionTo: () => readable(false),
        leaveRoom: vi.fn(() => Promise.resolve()),
    } as unknown as MenuRoom;
}

/** Lets the leave finish and the note show. */
async function settle() {
    for (let i = 0; i < 3; i++) {
        // eslint-disable-next-line no-await-in-loop
        await tick();
    }
}

function shownNote(): string | undefined {
    let note: { text: string } | undefined;
    chatDoneToastStore.subscribe((value) => (note = value))();
    return note?.text;
}

describe("a direct chat's ⋯ menu", () => {
    let component: RoomMenu | undefined;
    let target: HTMLElement;

    /** The menu of a chat whose room kept the name "Old Name" while the person now goes by "New Name". */
    async function open(names: Map<string, string>, room: MenuRoom = directRoom("Old Name")) {
        component = new RoomMenu({
            target,
            props: { room },
            context: new Map([[NAME_BY_CHAT_ID_CONTEXT, readable(names)]]),
        });
        await tick();
    }

    beforeEach(() => {
        target = document.createElement("div");
        document.body.append(target);
        for (const mock of Object.values(partnerActions)) mock.mockClear();
        sheet.openModal.mockClear();
        partner.chatId = "@ada:chat.example.com";
        partner.isBot = false;
        sheet.own.length = 0;
    });

    afterEach(() => {
        component?.$destroy();
        document.body.innerHTML = "";
        chatDoneToastStore.set(undefined);
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

    it("says whose chat was deleted, by the name they go by now", async () => {
        const room = directRoom("Old Name");
        await open(new Map([["@ada:chat.example.com", "New Name"]]), room);

        click('[data-testid="deleteChatOption"]');
        await tick();
        click('[data-testid="deleteChatConfirmButton"]');
        await settle();

        expect(room.leaveRoom).toHaveBeenCalledWith({ forget: true });
        expect(shownNote()).toBe("chat.directChat.deleteChat.notification:New Name");
    });

    it("says which group was left", async () => {
        const room = directRoom("Design team", "multiple");
        await open(new Map(), room);

        click('[data-testid="leaveGroupOption"]');
        await settle();

        expect(room.leaveRoom).toHaveBeenCalledWith(undefined);
        expect(shownNote()).toBe("chat.roomMenu.leaveRoom.notification:Design team");
    });

    describe("what a bot remembers about the person (#2003)", () => {
        const BOT = "0b7c1d2e-1111-4222-8333-944455556666";

        it("offers nothing of the kind in a chat with a person", async () => {
            await open(new Map());
            expect(target.querySelector('[data-testid="botMemoryOption"]')).toBeNull();
        });

        it("offers it in a chat with someone else's bot, and opens the sheet for that bot", async () => {
            partner.chatId = `@bot_${BOT}:chat.example.com`;
            partner.isBot = true;
            await open(new Map([[partner.chatId, "Melody"]]));

            expect(target.querySelector('[data-testid="botMemoryOption"]')?.textContent).toContain(
                "chat.brick.memory.menu"
            );
            click('[data-testid="botMemoryOption"]');
            expect(sheet.openModal).toHaveBeenCalledWith(expect.anything(), { botId: BOT, name: "Melody", own: false });
        });

        it("knows a bot that is the person's own Brick", async () => {
            partner.chatId = `@bot_${BOT}:chat.example.com`;
            partner.isBot = true;
            sheet.own.push({ id: BOT });
            await open(new Map([[partner.chatId, "Brick"]]));

            click('[data-testid="botMemoryOption"]');
            expect(sheet.openModal).toHaveBeenCalledWith(expect.anything(), { botId: BOT, name: "Brick", own: true });
        });

        it("is not offered for a bot whose id cannot be read", async () => {
            partner.chatId = "@someone:chat.example.com";
            partner.isBot = true;
            await open(new Map());
            expect(target.querySelector('[data-testid="botMemoryOption"]')).toBeNull();
        });
    });
});
