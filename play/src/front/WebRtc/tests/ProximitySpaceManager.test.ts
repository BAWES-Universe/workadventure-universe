import { describe, expect, it, vi } from "vitest";
import { Subject } from "rxjs";
import { FilterType } from "@workadventure/messages";

vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        PUBLIC_MAP_STORAGE_URL: "http://map-storage.example.com",
    };
});

describe("ProximitySpaceManager in an Audience (#1624)", { timeout: 60_000 }, () => {
    async function setUp(audienceCanTalk: boolean, chatSpace: string | undefined) {
        const { ProximitySpaceManager } = await import("../ProximitySpaceManager");
        const { audienceCanTalkStore } = await import("../../Stores/MediaStore");
        audienceCanTalkStore.set(audienceCanTalk);

        const joinSpaceRequestMessage = new Subject<{ spaceName: string; propertiesToSync: string[] }>();
        const leaveSpaceRequestMessage = new Subject<{ spaceName: string }>();
        const chat = {
            currentSpaceName: chatSpace,
            isJoiningSpace: false,
            joinSpace: vi.fn(() => Promise.resolve()),
            leaveSpace: vi.fn(() => Promise.resolve()),
        };
        const joined = new Set<string>();
        const registry = {
            joinSpace: vi.fn((name: string) => {
                joined.add(name);
                return Promise.resolve({ name });
            }),
            exist: (name: string) => joined.has(name),
            get: (name: string) => ({ name }),
            leaveSpace: vi.fn(({ name }: { name: string }) => {
                joined.delete(name);
                return Promise.resolve();
            }),
        };
        const manager = new ProximitySpaceManager(
            { joinSpaceRequestMessage, leaveSpaceRequestMessage } as never,
            chat as never,
            registry as never
        );
        return { manager, chat, registry, joinSpaceRequestMessage, leaveSpaceRequestMessage };
    }

    it("joins a bubble beside the Audience's own chat, for its sound and pictures, and leaves it", async () => {
        const { manager, chat, registry, joinSpaceRequestMessage, leaveSpaceRequestMessage } = await setUp(
            true,
            "audience-chat"
        );

        joinSpaceRequestMessage.next({ spaceName: "bubble-1", propertiesToSync: ["cameraState"] });
        await Promise.resolve();
        expect(chat.joinSpace).not.toHaveBeenCalled();
        expect(registry.joinSpace).toHaveBeenCalledWith(
            "bubble-1",
            FilterType.ALL_USERS,
            ["cameraState"],
            expect.any(AbortSignal)
        );

        leaveSpaceRequestMessage.next({ spaceName: "bubble-1" });
        await Promise.resolve();
        expect(chat.leaveSpace).not.toHaveBeenCalled();
        expect(registry.leaveSpace).toHaveBeenCalledWith({ name: "bubble-1" });
        manager.destroy();
    });

    it("keeps using the nearby chat for a bubble anywhere else", async () => {
        const { manager, chat, registry, joinSpaceRequestMessage, leaveSpaceRequestMessage } = await setUp(
            false,
            undefined
        );

        joinSpaceRequestMessage.next({ spaceName: "bubble-2", propertiesToSync: [] });
        leaveSpaceRequestMessage.next({ spaceName: "bubble-2" });
        await Promise.resolve();
        expect(chat.joinSpace).toHaveBeenCalledWith("bubble-2", []);
        expect(chat.leaveSpace).toHaveBeenCalledWith("bubble-2");
        expect(registry.joinSpace).not.toHaveBeenCalled();
        manager.destroy();
    });
});
