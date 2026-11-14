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

import { appsPageRequest, openAppsPage, takeAppsPageRequest } from "../Apps/OpenApps";
import { appsSearchStart } from "../Apps/AppsSearch";

beforeEach(() => {
    vi.clearAllMocks();
    bricksPageOpenStore.set(false);
    takeAppsPageRequest();
    appsSearchStart.set(undefined);
});

describe("opening the Apps page from a chat", () => {
    it("leaves the chat for the list, opens the Bricks page and asks it for its Apps page", () => {
        openAppsPage();
        expect(leaveChat).toHaveBeenCalledTimes(1);
        expect(switchToChat).toHaveBeenCalledTimes(1);
        expect(get(bricksPageOpenStore)).toBe(true);
        expect(get(appsPageRequest)).toBe(true);
        expect(get(appsSearchStart)).toBeUndefined();
    });

    it("starts Search apps with what the card asked for, trimmed, and with nothing when it asked for nothing", () => {
        openAppsPage({ search: "  calendar " });
        expect(get(appsSearchStart)).toBe("calendar");
        openAppsPage({ search: "   " });
        expect(get(appsSearchStart)).toBeUndefined();
    });

    it("is answered once: the Bricks page takes the request", () => {
        openAppsPage();
        takeAppsPageRequest();
        expect(get(appsPageRequest)).toBe(false);
    });
});
