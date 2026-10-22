import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get, readable } from "svelte/store";

// The window is measured when the stores load: an upright phone.
vi.hoisted(() => {
    window.innerWidth = 390;
    window.innerHeight = 844;
});
vi.mock("../Administration/AnalyticsClient", () => ({
    analyticsClient: { closeCowebsite: vi.fn(), chatPanelOpened: vi.fn() },
}));
vi.mock("./MobileLayoutStore", () => ({ mobileLayoutStore: readable(true) }));

import { chatSheetSnapStore } from "../Chat/ChatSheetStore";
import { openChat } from "../Chat/openChat";
import type { CoWebsite } from "../WebRtc/CoWebsite/CoWebsite";
import { chatVisibilityStore } from "./ChatStore";
import { coWebsites } from "./CoWebsiteStore";
import { openHereSheetTuckedStore } from "./SideWindowInFrontStore";
import {
    lowerChatForFile,
    openHereSheetLayoutStore,
    openHereSheetRestStore,
    openHereSheetTuckedRowStore,
    openHereSheetUpStore,
    restoreChatAfterFile,
    showFileOnPhone,
} from "./OpenHereSheetStore";

function item(id: string): CoWebsite {
    return {
        getId: () => id,
        getUrl: () => new URL("about:blank"),
        getIframe: () => undefined,
        getLoadIframe: () => undefined,
        getWidthPercent: () => undefined,
        isClosable: () => true,
        getHideUrl: () => false,
    };
}

describe("the Open here sheet on a phone", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        coWebsites.removeAll();
        chatVisibilityStore.set(false);
        chatSheetSnapStore.set("half");
        openHereSheetTuckedStore.set(false);
        openHereSheetRestStore.set("half");
        // Settle whatever an earlier test left pending.
        restoreChatAfterFile();
        vi.runAllTimers();
        chatSheetSnapStore.set("half");
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("is a sheet on an upright phone, resting at the chat's opening height", () => {
        expect(get(openHereSheetLayoutStore)).toBe(true);
        expect(get(openHereSheetRestStore)).toBe("half");
    });

    it("is up while something is open, and tucked into its row once dragged down", () => {
        expect(get(openHereSheetUpStore)).toBe(false);

        coWebsites.add(item("a"));
        expect(get(openHereSheetUpStore)).toBe(true);
        expect(get(openHereSheetTuckedRowStore)).toBe(false);

        openHereSheetTuckedStore.set(true);
        expect(get(openHereSheetUpStore)).toBe(false);
        expect(get(openHereSheetTuckedRowStore)).toBe(true);
    });

    it("opening something brings a tucked sheet back up", () => {
        openHereSheetTuckedStore.set(true);

        coWebsites.add(item("a"));

        expect(get(openHereSheetTuckedStore)).toBe(false);
    });

    it("lowers the chat to its lowest height under a file, and puts it back when they part", () => {
        coWebsites.add(item("a"));
        chatVisibilityStore.set(true);
        chatSheetSnapStore.set("full");

        lowerChatForFile(true);
        vi.runAllTimers();
        expect(get(chatSheetSnapStore)).toBe("peek");

        restoreChatAfterFile();
        vi.runAllTimers();
        expect(get(chatSheetSnapStore)).toBe("full");
    });

    it("leaves a chat a person moved since where they put it", () => {
        chatVisibilityStore.set(true);
        lowerChatForFile(true);
        vi.runAllTimers();

        chatSheetSnapStore.set(0.7);
        restoreChatAfterFile();
        vi.runAllTimers();

        expect(get(chatSheetSnapStore)).toBe(0.7);
    });

    it("keeps the height a chat opened by a message in a bubble came at, unless a file was tapped in it", () => {
        openChat("bubble");
        coWebsites.add(item("a"));

        lowerChatForFile();
        vi.runAllTimers();
        expect(get(chatSheetSnapStore)).toBe("half");

        lowerChatForFile(true);
        vi.runAllTimers();
        expect(get(chatSheetSnapStore)).toBe("peek");
    });

    it("shows a file tapped in chat: the sheet comes back up and the chat drops to its lowest height", () => {
        coWebsites.add(item("a"));
        openHereSheetTuckedStore.set(true);
        chatVisibilityStore.set(true);

        showFileOnPhone();
        vi.runAllTimers();

        expect(get(openHereSheetTuckedStore)).toBe(false);
        expect(get(chatSheetSnapStore)).toBe("peek");
    });

    it("leaves the chat alone when it is closed", () => {
        lowerChatForFile(true);
        vi.runAllTimers();

        expect(get(chatSheetSnapStore)).toBe("half");
    });
});
