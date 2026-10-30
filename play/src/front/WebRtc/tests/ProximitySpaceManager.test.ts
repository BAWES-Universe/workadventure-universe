import { describe, expect, it, vi } from "vitest";
import { Subject } from "rxjs";
import { readable } from "svelte/store";
import { FilterType } from "@workadventure/messages";

vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        PUBLIC_MAP_STORAGE_URL: "http://map-storage.example.com",
    };
});

describe("ProximitySpaceManager in an Audience (#1624)", { timeout: 60_000 }, () => {
    async function setUp(audienceCanTalk: boolean, chatSpace: string | undefined, chatSpaceKind = "none") {
        const { ProximitySpaceManager } = await import("../ProximitySpaceManager");
        const { audienceCanTalkStore } = await import("../../Stores/MediaStore");
        audienceCanTalkStore.set(audienceCanTalk);

        const joinSpaceRequestMessage = new Subject<{ spaceName: string; propertiesToSync: string[] }>();
        const leaveSpaceRequestMessage = new Subject<{ spaceName: string }>();
        const chat = {
            currentSpaceName: chatSpace,
            spaceKind: readable(chatSpaceKind),
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

    it("moves a bubble we walk in with beside the Audience chat, so the Audience does not wait for it to end", async () => {
        const { manager, chat, registry, joinSpaceRequestMessage, leaveSpaceRequestMessage } = await setUp(
            false,
            "bubble-3",
            "bubble"
        );
        joinSpaceRequestMessage.next({ spaceName: "bubble-3", propertiesToSync: ["microphoneState"] });
        await Promise.resolve();

        await manager.moveBubbleBesideChat();
        expect(chat.leaveSpace).toHaveBeenCalledWith("bubble-3");
        expect(registry.joinSpace).toHaveBeenCalledWith(
            "bubble-3",
            FilterType.ALL_USERS,
            ["microphoneState"],
            expect.any(AbortSignal)
        );

        // When the bubble ends, it is left where it now is
        chat.leaveSpace.mockClear();
        leaveSpaceRequestMessage.next({ spaceName: "bubble-3" });
        await Promise.resolve();
        expect(chat.leaveSpace).not.toHaveBeenCalled();
        expect(registry.leaveSpace).toHaveBeenCalledWith({ name: "bubble-3" });
        manager.destroy();
    });

    it("lets the Audience carry on when the moved bubble is gone before it is joined again", async () => {
        const { AbortError } = await import("@workadventure/shared-utils/src/Abort/AbortError");
        const { manager, registry } = await setUp(false, "bubble-4", "bubble");
        registry.joinSpace.mockImplementationOnce(() => Promise.reject(new AbortError("Left the bubble")));
        await expect(manager.moveBubbleBesideChat()).resolves.toBeUndefined();
        manager.destroy();
    });

    it("brings a bubble back to the nearby chat when its people walk out of the Audience together", async () => {
        const { manager, chat, registry, joinSpaceRequestMessage, leaveSpaceRequestMessage } = await setUp(
            true,
            "audience-chat"
        );
        joinSpaceRequestMessage.next({ spaceName: "bubble-5", propertiesToSync: ["cameraState"] });
        await Promise.resolve();
        expect(chat.joinSpace).not.toHaveBeenCalled();

        await manager.moveBubblesBackToChat();
        expect(registry.leaveSpace).toHaveBeenCalledWith({ name: "bubble-5" });
        expect(chat.joinSpace).toHaveBeenCalledWith("bubble-5", ["cameraState"]);

        // When the bubble ends, the nearby chat leaves it
        registry.leaveSpace.mockClear();
        leaveSpaceRequestMessage.next({ spaceName: "bubble-5" });
        await Promise.resolve();
        expect(chat.leaveSpace).toHaveBeenCalledWith("bubble-5");
        expect(registry.leaveSpace).not.toHaveBeenCalled();
        manager.destroy();
    });

    it("does not join a bubble again when it ends while it moves", async () => {
        const { manager, chat, registry, joinSpaceRequestMessage, leaveSpaceRequestMessage } = await setUp(
            true,
            "audience-chat"
        );
        joinSpaceRequestMessage.next({ spaceName: "bubble-6", propertiesToSync: [] });
        await Promise.resolve();
        registry.leaveSpace.mockImplementationOnce(() => {
            leaveSpaceRequestMessage.next({ spaceName: "bubble-6" });
            return Promise.resolve();
        });
        await manager.moveBubblesBackToChat();
        expect(chat.joinSpace).not.toHaveBeenCalled();

        // Same when walking in
        const walkIn = await setUp(false, "bubble-7", "bubble");
        walkIn.joinSpaceRequestMessage.next({ spaceName: "bubble-7", propertiesToSync: [] });
        walkIn.chat.leaveSpace.mockImplementationOnce(() => {
            walkIn.leaveSpaceRequestMessage.next({ spaceName: "bubble-7" });
            return Promise.resolve();
        });
        await walkIn.manager.moveBubbleBesideChat();
        expect(walkIn.registry.joinSpace).not.toHaveBeenCalled();
        manager.destroy();
        walkIn.manager.destroy();
    });

    it("leaves a meeting room's chat where it is", async () => {
        const { manager, chat, registry } = await setUp(true, "meeting-room", "meeting");
        await manager.moveBubbleBesideChat();
        expect(chat.leaveSpace).not.toHaveBeenCalled();
        expect(registry.joinSpace).not.toHaveBeenCalled();
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
