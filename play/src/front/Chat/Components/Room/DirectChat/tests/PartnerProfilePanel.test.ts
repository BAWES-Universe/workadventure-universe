import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { readable, writable } from "svelte/store";

vi.hoisted(() => {
    (window as unknown as { env: Record<string, unknown> }).env = {};
});

// Who the person's own Bricks are, and what the panel opens from here
type MyBrick = { id: string; name: string; description: string | null; characterTextureId: string | null };
const bricks = vi.hoisted(() => ({
    // A tiny store, made before the modules load
    byChatId: {
        value: new Map<string, unknown>(),
        subscribe(run: (value: Map<string, unknown>) => void) {
            run(bricks.byChatId.value);
            return () => undefined;
        },
    },
    mine: [] as MyBrick[],
    openBrickPage: vi.fn<(id: string, options?: { backToChat?: boolean }) => void>(),
    openBrickChat: vi.fn(() => Promise.resolve(undefined)),
    toasts: [] as string[],
    // Where the bot server says a Brick lives, when a test gives it a room
    home: undefined as unknown,
}));
vi.mock("../../../../Bricks/MyBricksStore", () => ({ myBricksByChatId: bricks.byChatId }));
vi.mock("../../../../Bricks/Templates/OpenBrick", () => ({ openBrickPage: bricks.openBrickPage }));
vi.mock("../../../../Bricks/BrickChat", () => ({ openBrickChat: bricks.openBrickChat }));
// Its visit card and picture have their own tests (BricksPage.test.ts): here only that the profile draws them
vi.mock("../../../../Bricks/BrickVisitCard.svelte", async () => await import("./brickVisitCardStub.svelte"));
vi.mock("../../../../Bricks/BrickPicture.svelte", async () => await import("./brickPictureStub.svelte"));
vi.mock("../../../../../Stores/ChatDoneToastStore", () => ({
    showChatDoneToast: (text: string) => bricks.toasts.push(text),
}));
vi.mock("../../../../../Stores/ErrorStore", () => ({ warningMessageStore: { addWarningMessage: vi.fn() } }));
vi.mock("../../../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: { getDmRoom: () => Promise.resolve(bricks.home), getLiveView: () => Promise.resolve(undefined) },
}));
vi.mock("../../../../../Connection/LocalUserStore", () => ({
    localUserStore: new Proxy(
        {},
        { get: (_store, key) => (key === "getChatId" ? () => "@me:chat.example.com" : () => undefined) }
    ),
}));
vi.mock("../../../../Stores/ChatPeopleLookup", () => ({ requestChatPerson: () => undefined }));
vi.mock("../../../../Stores/FriendsStore", async () => {
    const { writable: store } = await import("svelte/store");
    return { friendsEnabledStore: store(false), relationshipsStore: store(new Map()) };
});
vi.mock("../../../../Stores/RingStore", async () => {
    const { writable: store } = await import("svelte/store");
    return { invitesEnabledStore: store(false) };
});
vi.mock("../../../../../Stores/GameSceneStore", async () => {
    const { writable: store } = await import("svelte/store");
    return { gameSceneStore: store(undefined) };
});
vi.mock("../../../../Stores/SelectRoomStore", async () => {
    const { writable: store } = await import("svelte/store");
    return { selectedRoomStore: store(undefined) };
});
vi.mock("../../../../Bots/visitBotRoom", () => ({ visitBotRoom: vi.fn() }));
vi.mock("../PartnerNowIn", async () => {
    const { readable: store } = await import("svelte/store");
    return { partnerNowIn: () => store(undefined), sameRoom: () => false, visitPerson: vi.fn() };
});
vi.mock("../PartnerActions", async () => {
    const actual: object = await vi.importActual("../PartnerActions");
    return {
        ...actual,
        canOpenPartnerProfile: () => false,
        canReportPartner: () => false,
        partnerFriendAction: () => undefined,
    };
});
// The profile's own summaries, the visit card of a person and the avatar draw from the game; none matter here
vi.mock(
    "../../Details/SharedSummary.svelte",
    async () => await import("../../../../../external-modules/bots/components/testStub.svelte")
);
vi.mock(
    "../../Details/ArtifactsSummary.svelte",
    async () => await import("../../../../../external-modules/bots/components/testStub.svelte")
);
vi.mock(
    "../../Details/PinnedSummary.svelte",
    async () => await import("../../../../../external-modules/bots/components/testStub.svelte")
);
vi.mock("../PartnerRoomBlock.svelte", async () => await import("./brickRoomBlockStub.svelte"));
vi.mock("../../../../../Components/VisitCard/VisitCard.svelte", async () => await import("./brickPictureStub.svelte"));
vi.mock("../../../TopRow/TopRowAvatar.svelte", async () => await import("./brickPictureStub.svelte"));
vi.mock("../../../../../Phaser/Game/GameManager", () => ({ gameManager: {} }));
vi.mock("../../../../../Administration/AnalyticsClient", () => ({ analyticsClient: {} }));
vi.mock("../../../../../WebRtc/BlackListManager", () => ({ blackListManager: {} }));
vi.mock("../../../../../Stores/ShowReportScreenStore", () => ({ showReportScreenStore: {} }));
vi.mock("../../../../../external-modules/admin-api/index", () => ({ canOpenOrbit: () => false }));
vi.mock("../../../UserList/PersonNavigation", () => ({
    goToPersonRoom: vi.fn(),
    locatePerson: vi.fn(),
    walkToPerson: vi.fn(),
}));

import { loadLocale } from "../../../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../../../i18n/i18n-svelte";
import type { DirectPartner } from "../DirectPartnerStore";
import PartnerProfilePanel from "../PartnerProfilePanel.svelte";

const BRICK = "0b7c1d2e-1111-4222-8333-944455556666";
const OTHER = "9a1b2c3d-1111-4222-8333-944455556666";
const brickChat = (id: string) => `@bot_${id}:chat.example.com`;

function partner(over: Partial<DirectPartner> = {}): DirectPartner {
    return {
        chatId: "@ada:chat.example.com",
        user: undefined,
        uuid: "uuid-ada",
        place: { kind: "offline" } as DirectPartner["place"],
        actions: { walkTo: false, locate: false },
        isBot: false,
        isBlocked: false,
        isGameBlocked: false,
        ...over,
    };
}

function chatRoom() {
    return {
        id: "!dm:chat.example.com",
        name: writable("Brick"),
        pictureStore: writable(undefined),
        members: readable([]),
        areNotificationsMuted: writable(false),
        muteNotification: vi.fn(() => Promise.resolve()),
        unmuteNotification: vi.fn(() => Promise.resolve()),
        leaveRoom: vi.fn(() => Promise.resolve()),
    };
}

/** Lets the panel draw and what a tap starts finish. */
async function settle() {
    for (let i = 0; i < 3; i++) {
        // eslint-disable-next-line no-await-in-loop
        await tick();
    }
}

describe("a chat's profile panel for a Brick", () => {
    let target: HTMLElement;
    let panel: PartnerProfilePanel | undefined;
    let room: ReturnType<typeof chatRoom>;

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    beforeEach(() => {
        target = document.createElement("div");
        document.body.append(target);
        bricks.mine = [
            { id: BRICK, name: "Brick", description: "Your everyday helper", characterTextureId: "brick-orange" },
        ];
        bricks.byChatId.value = new Map(bricks.mine.map((brick) => [`@bot_${brick.id}:chat.example.com`, brick]));
        bricks.openBrickPage.mockClear();
        bricks.openBrickChat.mockClear();
        bricks.toasts.length = 0;
        bricks.home = undefined;
        room = chatRoom();
    });
    afterEach(() => {
        panel?.$destroy();
        panel = undefined;
        target.remove();
    });

    async function open(who: DirectPartner, extra: Record<string, unknown> = {}) {
        panel = new PartnerProfilePanel({
            target,
            props: { room: room as never, partner: who, ...extra },
        });
        await settle();
    }
    const byId = (id: string) => target.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const text = () => target.textContent?.replace(/\s+/g, " ").trim() ?? "";
    // The way the game finds a Brick: isBot is only set while its avatar stands on the map
    const ownBrick = () => partner({ chatId: brickChat(BRICK), isBot: false });

    it("has no Block for a Brick that is not standing on the map, and no Report", async () => {
        await open(ownBrick(), { bot: true, botState: "online" });
        expect(byId("partnerBlock")).toBeNull();
        expect(byId("partnerReport")).toBeNull();
        expect(text()).not.toContain("Block");
    });

    it("has no Block for someone else's Brick either", async () => {
        await open(partner({ chatId: brickChat(OTHER) }), { bot: true, botState: "online" });
        expect(byId("partnerBlock")).toBeNull();
    });

    it("still has Block and Delete chat for a person", async () => {
        await open(partner());
        expect(byId("partnerBlock")).not.toBeNull();
        expect(byId("partnerDeleteChat")?.textContent).toContain("Delete chat");
        expect(byId("partnerBrickSettings")).toBeNull();
    });

    it("starts as the Brick's page does: its look, name and line, and the word the chat header shows", async () => {
        await open(ownBrick(), { bot: true, botState: "online" });
        expect(byId("partnerProfileLook")).not.toBeNull();
        expect(byId("partnerProfileName")?.textContent?.trim()).toBe("Brick");
        expect(byId("partnerProfileLine")?.textContent?.trim()).toBe("Your everyday helper");
        expect(byId("partnerProfileStatus")?.textContent?.trim()).toBe("Online");
    });

    it("says Resting for a Brick that is switched off, as the header does", async () => {
        await open(ownBrick(), { bot: true, botState: "resting" });
        expect(byId("partnerProfileStatus")?.textContent?.trim()).toBe("Resting");
    });

    it("shows the visit card in a frame under the identity, for the person's own Brick only", async () => {
        await open(ownBrick(), { bot: true, botState: "online" });
        expect(byId("brickVisitCardStub")?.dataset.brick).toBe(BRICK);
        expect(byId("brickVisitCardStub")?.dataset.framed).toBe("true");
        expect(byId("brickVisitCardStub")?.dataset.showOff).toBe("true");

        panel?.$destroy();
        target.replaceChildren();
        await open(partner({ chatId: brickChat(OTHER) }), { bot: true, botState: "online" });
        expect(byId("brickVisitCardStub")).toBeNull();
    });

    it("has a Settings row that opens the Brick's page, with Back going to this chat", async () => {
        await open(ownBrick(), { bot: true, botState: "online" });
        expect(byId("partnerBrickSettings")?.textContent).toContain("Settings");
        expect(byId("partnerBrickSettings")?.textContent).toContain("Mind, personality, apps and more");
        byId("partnerBrickSettings")?.click();
        expect(bricks.openBrickPage).toHaveBeenCalledWith(BRICK, { backToChat: true });
    });

    it("has no Settings row for someone else's Brick, which is not the person's to change", async () => {
        await open(partner({ chatId: brickChat(OTHER) }), { bot: true, botState: "online" });
        expect(byId("partnerBrickSettings")).toBeNull();
    });

    it("keeps Mute", async () => {
        await open(ownBrick(), { bot: true, botState: "online" });
        expect(byId("partnerMuteToggle")?.textContent).toContain("Mute notifications");
    });

    it("says Clear chat, and that the Brick still remembers what it learned", async () => {
        await open(ownBrick(), { bot: true, botState: "online" });
        const row = byId("partnerDeleteChat");
        expect(row?.textContent).toContain("Clear chat");
        expect(row?.textContent).toContain("Starts an empty chat. Brick still remembers what it learned about you.");
        expect(text()).not.toContain("Delete chat");

        row?.click();
        await settle();
        const ask = byId("partnerDeleteConfirm")?.textContent?.replace(/\s+/g, " ");
        expect(ask).toContain("Clear this chat?");
        expect(ask).toContain("You start again with an empty chat. Brick still remembers what it learned about you.");
        expect(byId("partnerDeleteConfirmButton")?.textContent?.trim()).toBe("Clear");
    });

    it("clears the chat, says so, and opens a new empty chat with the person's own Brick", async () => {
        await open(ownBrick(), { bot: true, botState: "online" });
        byId("partnerDeleteChat")?.click();
        await settle();
        byId("partnerDeleteConfirmButton")?.click();
        await settle();
        expect(room.leaveRoom).toHaveBeenCalledWith({ forget: true });
        expect(bricks.toasts).toEqual(["Cleared your chat with Brick"]);
        expect(bricks.openBrickChat).toHaveBeenCalledWith(BRICK);
    });

    it("clears the chat with someone else's Brick, and leaves the person on the list", async () => {
        await open(partner({ chatId: brickChat(OTHER) }), { bot: true, botState: "online" });
        byId("partnerDeleteChat")?.click();
        await settle();
        byId("partnerDeleteConfirmButton")?.click();
        await settle();
        expect(room.leaveRoom).toHaveBeenCalledWith({ forget: true });
        expect(bricks.toasts).toEqual(["Cleared your chat with Brick"]);
        expect(bricks.openBrickChat).not.toHaveBeenCalled();
    });

    describe("where a Brick lives", () => {
        beforeEach(() => {
            bricks.home = {
                url: `${window.location.origin}/@/bawes/universe/lobby`,
                room: "Lobby",
                world: "",
                universe: "",
            };
        });

        it("shows Lives in with Visit for someone else's Brick, as it always did", async () => {
            await open(partner({ chatId: brickChat(OTHER) }), { bot: true, botState: "online" });
            expect(byId("partnerRoomBlockStub")).not.toBeNull();
        });

        it("leaves it to the visit card for the person's own Brick, which says where it lives with Take it out", async () => {
            await open(ownBrick(), { bot: true, botState: "online" });
            expect(byId("brickVisitCardStub")).not.toBeNull();
            expect(byId("partnerRoomBlockStub")).toBeNull();
        });
    });
});
