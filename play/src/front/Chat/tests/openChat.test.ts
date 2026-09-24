import { beforeEach, describe, expect, it, vi } from "vitest";

const chatPanelOpened = vi.fn();

vi.mock("../../Administration/AnalyticsClient", () => ({
    analyticsClient: {
        chatPanelOpened: (source: string) => chatPanelOpened(source),
    },
}));

describe("openChat", () => {
    beforeEach(() => {
        chatPanelOpened.mockClear();
    });

    it("records the source only on a closed to open transition", async () => {
        const { chatVisibilityStore } = await import("../../Stores/ChatStore");
        const { openChat } = await import("../openChat");
        chatVisibilityStore.set(false);

        openChat("bubble");
        expect(chatPanelOpened).toHaveBeenCalledTimes(1);
        expect(chatPanelOpened).toHaveBeenLastCalledWith("bubble");

        // Already open: not a new open.
        openChat("notification");
        expect(chatPanelOpened).toHaveBeenCalledTimes(1);

        chatVisibilityStore.set(false);
        openChat("button");
        expect(chatPanelOpened).toHaveBeenCalledTimes(2);
        expect(chatPanelOpened).toHaveBeenLastCalledWith("button");
    });

    it("counts direct store writes as unknown", async () => {
        const { chatVisibilityStore } = await import("../../Stores/ChatStore");
        await import("../openChat");
        chatVisibilityStore.set(false);

        chatVisibilityStore.set(true);
        expect(chatPanelOpened).toHaveBeenCalledTimes(1);
        expect(chatPanelOpened).toHaveBeenLastCalledWith("unknown");
    });
});
