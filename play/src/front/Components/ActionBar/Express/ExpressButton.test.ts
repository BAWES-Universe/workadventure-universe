import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { readable, writable } from "svelte/store";

vi.mock("../../../Enum/EnvironmentVariable.ts", () => ({
    PEER_SCREEN_SHARE_RECOMMENDED_BANDWIDTH: 0,
    PEER_VIDEO_RECOMMENDED_BANDWIDTH: 0,
    MAX_USERNAME_LENGTH: 10,
}));
vi.mock("../../../Stores/ChatStore", () => ({
    chatInputFocusStore: writable(undefined),
    chatVisibilityStore: writable(false),
    INITIAL_SIDEBAR_WIDTH: 300,
}));
vi.mock("../../../Chat/ChatSidebarWidthStore", () => ({ hideActionBarStoreBecauseOfChatBar: writable(false) }));
vi.mock("../../../Stores/ActionsCamStore", () => ({ highlightFullScreen: writable(false) }));
vi.mock("../../../Stores/MapEditorStore", () => ({ mapEditorModeStore: writable(false) }));
vi.mock("../../../Connection/ConnectionManager", () => ({
    connectionManager: { currentRoom: { isSayEnabled: true } },
}));
vi.mock("../../../Administration/AnalyticsClient", () => ({ analyticsClient: new Proxy({}, { get: () => () => {} }) }));
vi.mock("../../../Utils/svelte-floatingui-show", () => ({ showFloatingUi: () => () => {} }));
vi.mock("../../../Stores/MediaStore", () => ({ availabilityStatusStore: writable(1) }));
vi.mock("../../../Phaser/Game/Say/SayManager", () => ({ popupJustClosed: () => {} }));
vi.mock("../../../Phaser/Game/Say/sendSay", () => ({
    SAY_MAX_LENGTH: 64,
    sayTypeForcedByStatus: () => undefined,
    sendSayBubble: () => {},
}));
vi.mock("../../../../i18n/i18n-svelte", () => {
    const fn: unknown = new Proxy(() => "x", { get: () => fn, apply: () => "x" });
    return { default: readable(fn), LL: readable(fn) };
});

import { expressTrayStore } from "../../../Stores/ExpressStore";
import { mapEditorModeStore } from "../../../Stores/MapEditorStore";
import ExpressButton from "./ExpressButton.svelte";

function trayState(): string {
    let state = "";
    expressTrayStore.subscribe((value) => (state = value))();
    return state;
}

async function settle() {
    await tick();
    await new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
    await tick();
}

const setMapEditor = (on: boolean) => (mapEditorModeStore as unknown as { set: (value: boolean) => void }).set(on);

describe("ExpressButton", () => {
    let component: ExpressButton | undefined;

    afterEach(() => {
        component?.$destroy();
        document.body.innerHTML = "";
        expressTrayStore.close();
        setMapEditor(false);
    });

    it("can still be opened and closed after the map editor hid it while the tray was open", async () => {
        const target = document.createElement("div");
        document.body.appendChild(target);
        component = new ExpressButton({ target });
        const tray = () => target.querySelector('[data-testid="express-tray"]');
        const button = () => target.querySelector<HTMLButtonElement>('[data-testid="express-button"]');

        expressTrayStore.open();
        await settle();
        expect(tray()).not.toBeNull();

        // The map editor hides the button and closes the tray.
        setMapEditor(true);
        await settle();
        expect(button()).toBeNull();
        expect(trayState()).toBe("closed");

        // Back from the map editor: the tray stays closed, and the button works again.
        setMapEditor(false);
        await settle();
        expect(tray()).toBeNull();

        button()?.click();
        await settle();
        expect(trayState()).toBe("open");
        expect(tray()).not.toBeNull();

        button()?.click();
        await settle();
        // jsdom doesn't run the tray's closing animation, so check the state rather than the DOM.
        expect(trayState()).toBe("closed");
        expect(button()?.getAttribute("aria-expanded")).toBe("false");
    });
});
