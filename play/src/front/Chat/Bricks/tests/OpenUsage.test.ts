import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

const { leaveChat, bricksPageOpenStore, switchToChat } = vi.hoisted(() => {
    let value = false;
    const subscribers = new Set<(value: boolean) => void>();
    return {
        leaveChat: vi.fn(),
        switchToChat: vi.fn(),
        bricksPageOpenStore: {
            subscribe(run: (value: boolean) => void) {
                run(value);
                subscribers.add(run);
                return () => subscribers.delete(run);
            },
            set(next: boolean) {
                value = next;
                subscribers.forEach((run) => run(value));
            },
        },
    };
});
vi.mock("../../ChatBack", () => ({ leaveChat }));
vi.mock("../../Stores/ChatStore", () => ({ bricksPageOpenStore, navChat: { switchToChat } }));

import { openUsagePage, takeUsagePageRequest, usagePageRequest } from "../OpenUsage";

beforeEach(() => {
    vi.clearAllMocks();
    bricksPageOpenStore.set(false);
    takeUsagePageRequest();
});

describe("opening the Usage page from a chat", () => {
    it("leaves the chat for the list, opens the Bricks page and asks it for Usage with the task's receipt", () => {
        openUsagePage({ receiptId: "act_1" });
        expect(leaveChat).toHaveBeenCalledTimes(1);
        expect(switchToChat).toHaveBeenCalledTimes(1);
        expect(get(bricksPageOpenStore)).toBe(true);
        expect(get(usagePageRequest)).toEqual({ receiptId: "act_1" });
    });

    it("asks for the page alone when no task is named", () => {
        openUsagePage();
        expect(get(usagePageRequest)).toEqual({ receiptId: undefined });
    });

    it("is answered once: the Bricks page takes the request", () => {
        openUsagePage({ receiptId: "act_1" });
        takeUsagePageRequest();
        expect(get(usagePageRequest)).toBeUndefined();
    });
});
