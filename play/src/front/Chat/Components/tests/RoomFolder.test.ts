// @vitest-environment jsdom
import { readable, writable } from "svelte/store";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

// The tests run Svelte's server build; the folder needs the browser one.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));

vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: { hasFolderOpened: () => true, addFolderOpened: vi.fn(), removeFolderOpened: vi.fn() },
}));
vi.mock("../../Stores/AreaPresenceStore", () => ({
    areaChatRooms: { hiddenRoomIds: readable(new Set<string>()) },
    withoutAreaChatRooms: <T>(rooms: T[]) => rooms,
}));
vi.mock("../../Bricks/MyBricksStore", () => ({ myDeletedBrickChatIds: readable(new Set<string>()) }));
vi.mock("../Room/Room.svelte", async () => ({ default: (await import("./RoomStub.svelte")).default }));
vi.mock("../Room/CreateRoomOrFolderOption.svelte", async () => ({
    default: (await import("./RoomStub.svelte")).default,
}));
vi.mock("../Room/RoomInvitation.svelte", async () => ({ default: (await import("./RoomStub.svelte")).default }));
vi.mock("../Room/RoomSuggested.svelte", async () => ({ default: (await import("./RoomStub.svelte")).default }));
vi.mock("../../Stores/ChatStore", async () => {
    const { writable: store } = await import("svelte/store");
    return { chatSearchBarValue: store("") };
});
vi.mock("../OneList/MinuteClock", () => ({ minuteClock: readable(0) }));

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import type { ChatRoom } from "../../Connection/ChatConnection";
import { chatSearchBarValue } from "../../Stores/ChatStore";
import RoomFolder from "../RoomFolder.svelte";

const BOT = "@bot_2d9e3f40-3333-4444-8555-b66677778888:chat.test";

describe("a folder of chats shown with a search for Bot or Brick", () => {
    let component: RoomFolder | undefined;
    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    afterEach(() => {
        component?.$destroy();
        component = undefined;
        chatSearchBarValue.set("");
        document.body.innerHTML = "";
    });

    const direct = (id: string, name: string, members: ReturnType<typeof writable<{ id: string }[]>>) =>
        ({
            id,
            type: "direct",
            name: writable(name),
            members,
            lastMessageTimestamp: 1,
        } as unknown as ChatRoom);

    function mount(rooms: ChatRoom[]) {
        const target = document.createElement("div");
        document.body.append(target);
        const roomsStore = writable(rooms);
        const folder = {
            id: "folder-1",
            name: writable("Folder"),
            rooms: roomsStore,
            folders: writable([]),
            invitations: writable([]),
            suggestedRooms: writable([]),
            joinableRooms: writable([]),
        };
        component = new RoomFolder({ target, props: { rootFolder: false, folder: folder as never } });
        return { roomsStore };
    }
    const shown = () => [...document.querySelectorAll('[data-testid="stub-room"]')].map((one) => one.textContent);

    it("shows a chat with a bot that joins while the folder is open, whatever the chat is named", async () => {
        const members = writable<{ id: string }[]>([{ id: "@me:chat.test" }]);
        mount([direct("!melody", "Melody", members)]);
        chatSearchBarValue.set("Brick");
        await tick();
        expect(shown()).toEqual([]);
        // The bot's membership arrives after the chat is on the list
        members.set([{ id: "@me:chat.test" }, { id: BOT }]);
        await tick();
        expect(shown()).toEqual(["!melody"]);
    });

    it("shows a chat with a bot that arrives in the folder while it is open", async () => {
        const { roomsStore } = mount([
            direct("!sara", "Sara", writable([{ id: "@me:chat.test" }, { id: "@sara:chat.test" }])),
        ]);
        chatSearchBarValue.set("bot");
        await tick();
        expect(shown()).toEqual([]);
        roomsStore.update((rooms) => [
            ...rooms,
            direct("!melody", "Melody", writable([{ id: "@me:chat.test" }, { id: BOT }])),
        ]);
        await tick();
        expect(shown()).toEqual(["!melody"]);
    });
});
