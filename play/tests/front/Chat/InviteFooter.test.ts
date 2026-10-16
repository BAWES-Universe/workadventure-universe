import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { readable, writable } from "svelte/store";

const scene = vi.hoisted(() => ({
    CurrentPlayer: { x: 100, y: 200 },
    getStartPositionNames: () => ["start"],
    room: { roomName: "Welcome room", isChatOnlineListEnabled: false },
}));

vi.mock("../../../src/front/Phaser/Game/GameManager", () => ({
    gameManager: {
        tryGetCurrentGameScene: () => scene,
        chatConnection: { connectionStatus: readable("ONLINE"), isGuest: readable(false) },
    },
}));
vi.mock("../../../src/front/Stores/MenuStore", () => ({
    inviteUserActivated: writable(true),
    userIsConnected: writable(true),
}));
vi.mock("../../../src/front/Chat/Stores/ChatStore", () => ({
    chatInviteSheetHeightStore: writable(0),
    chatSearchBarValue: writable(""),
    chatSearchOpenStore: writable(false),
    inviteCardRequestStore: writable(false),
    navChat: writable({ key: "chat" }),
}));
vi.mock("../../../src/front/Administration/AnalyticsClient", () => ({
    analyticsClient: { openInvite: vi.fn(), inviteCopyLink: vi.fn(), inviteCopyLinkWalk: vi.fn() },
}));
vi.mock("../../../src/front/Chat/Components/Header/ChatHeaderNewMenu", () => ({
    focusChatSearchRequest: writable(false),
    getNewChatOptions: () => [],
}));
vi.mock("../../../src/front/Chat/Components/Header/ChatHeaderNewMenu.svelte", async () => ({
    default: (await import("./stubs/Empty.svelte")).default,
}));
vi.mock("../../../src/front/Chat/Components/ChatHeader.svelte", async () => ({
    default: (await import("./stubs/Empty.svelte")).default,
}));
// Every text is "": the test reads the buttons by their test ids.
vi.mock("../../../src/i18n/i18n-svelte", () => {
    const deep = (): unknown => new Proxy(() => "", { get: () => deep() });
    return { default: readable(deep()) };
});

import InviteFooter from "../../../src/front/Chat/Components/InviteFooter.svelte";

function byTestId(id: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!element) throw new Error(`No element with data-testid ${id}`);
    return element;
}

async function openPanelWithNextToMe(): Promise<void> {
    byTestId("chatInviteButton").click();
    await tick();
    const nextToMe = byTestId("chatInviteNextToMe") as HTMLInputElement;
    nextToMe.checked = true;
    nextToMe.dispatchEvent(new Event("change"));
    await tick();
}

describe("InviteFooter link (#1066)", () => {
    const writeText = vi.fn<(text: string) => Promise<void>>();
    let component: InviteFooter;

    beforeEach(() => {
        scene.CurrentPlayer.x = 100;
        scene.CurrentPlayer.y = 200;
        writeText.mockReset().mockResolvedValue();
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
        Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    });
    afterEach(() => {
        component.$destroy();
        document.body.innerHTML = "";
    });

    it("shows where the player stands when the panel opens", async () => {
        component = new InviteFooter({ target: document.body });
        await openPanelWithNextToMe();
        expect(byTestId("chatInviteLink").dataset.link).toContain("#moveTo=100,200");
    });

    it("copies the position the player has moved to, not the one from when the option was turned on", async () => {
        component = new InviteFooter({ target: document.body });
        await openPanelWithNextToMe();
        scene.CurrentPlayer.x = 340.7;
        scene.CurrentPlayer.y = 512.2;
        byTestId("chatInviteCopy").click();
        await tick();
        expect(writeText).toHaveBeenCalledTimes(1);
        expect(writeText.mock.calls[0][0]).toContain("#moveTo=340,512");
        expect(byTestId("chatInviteLink").dataset.link).toContain("#moveTo=340,512");
    });

    it("shares the position the player has moved to", async () => {
        const share = vi.fn<(data: ShareData) => Promise<void>>().mockResolvedValue();
        Object.defineProperty(navigator, "share", { value: share, configurable: true });
        component = new InviteFooter({ target: document.body });
        await openPanelWithNextToMe();
        scene.CurrentPlayer.x = 8;
        scene.CurrentPlayer.y = 9;
        byTestId("chatInviteShare").click();
        await tick();
        expect(share).toHaveBeenCalledTimes(1);
        expect(share.mock.calls[0][0].url).toContain("#moveTo=8,9");
    });

    it("leaves the link without a position when the option is off", async () => {
        component = new InviteFooter({ target: document.body });
        byTestId("chatInviteButton").click();
        await tick();
        scene.CurrentPlayer.x = 5;
        byTestId("chatInviteCopy").click();
        await tick();
        expect(writeText.mock.calls[0][0]).not.toContain("moveTo");
    });
});
