import { describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { AvailabilityStatus } from "@workadventure/messages";

vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        PUBLIC_MAP_STORAGE_URL: "http://map-storage.example.com",
    };
});

describe("people in an Audience talking to each other (#1624)", { timeout: 60_000 }, () => {
    async function enterAudience(allowTalking: boolean) {
        const media = await import("./MediaStore");
        const { bubbleMatesStore } = await import("./CurrentPlayerGroupStore");
        bubbleMatesStore.set([]);
        media.isListenerStore.set(true);
        media.audienceCanTalkStore.set(allowTalking);
        return { media, bubbleMatesStore };
    }

    it("only listens in an Audience that keeps people quiet, even next to someone", async () => {
        const { media, bubbleMatesStore } = await enterAudience(false);
        bubbleMatesStore.set([2]);

        expect(get(media.listensOnlyStore)).toBe(true);
        expect(get(media.availabilityStatusStore)).toBe(AvailabilityStatus.LISTENER);
    });

    it("stays open to bubbles in an Audience that lets people talk, and talks only while in one", async () => {
        const { media, bubbleMatesStore } = await enterAudience(true);

        expect(get(media.availabilityStatusStore)).not.toBe(AvailabilityStatus.LISTENER);
        expect(get(media.listensOnlyStore)).toBe(true);

        bubbleMatesStore.set([2]);
        expect(get(media.listensOnlyStore)).toBe(false);

        bubbleMatesStore.set([]);
        expect(get(media.listensOnlyStore)).toBe(true);
    });

    it("is a normal player again after leaving the Audience", async () => {
        const { media, bubbleMatesStore } = await enterAudience(true);
        media.isListenerStore.set(false);
        media.audienceCanTalkStore.set(false);
        bubbleMatesStore.set([]);

        expect(get(media.listensOnlyStore)).toBe(false);
        expect(get(media.availabilityStatusStore)).not.toBe(AvailabilityStatus.LISTENER);
    });
});
