// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import ChatDoneToast from "../ChatDoneToast.svelte";
import { CHAT_DONE_TOAST_MS, chatDoneToastStore, showChatDoneToast } from "../../../Stores/ChatDoneToastStore";

// The tests run Svelte's server build; the note needs the browser one.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));

describe("the note shown after deleting a chat or leaving a group", () => {
    let component: ChatDoneToast | undefined;
    afterEach(() => {
        vi.useRealTimers();
        component?.$destroy();
        component = undefined;
        chatDoneToastStore.set(undefined);
        document.body.innerHTML = "";
    });

    function mount() {
        const target = document.createElement("div");
        document.body.append(target);
        component = new ChatDoneToast({ target });
    }

    it("shows the words, with nothing to press, and goes away by itself", async () => {
        vi.useFakeTimers();
        mount();
        expect(document.querySelector('[data-testid="chatDoneToast"]')).toBeNull();

        showChatDoneToast("Deleted your chat with Attio");
        await tick();
        const toast = document.querySelector('[data-testid="chatDoneToast"]');
        expect(toast?.textContent).toContain("Deleted your chat with Attio");
        expect(toast?.getAttribute("role")).toBe("status");
        expect(toast?.querySelector("button")).toBeNull();

        vi.advanceTimersByTime(CHAT_DONE_TOAST_MS);
        await tick();
        // It fades out first: step the animation frames the fade runs on.
        for (let elapsed = 0; elapsed < 500; elapsed += 16) vi.advanceTimersByTime(16);
        await tick();
        expect(document.querySelector('[data-testid="chatDoneToast"]')).toBeNull();
    });

    it("shows the newest note for a full while when a second one follows", () => {
        vi.useFakeTimers();
        showChatDoneToast("Deleted your chat with Mishari");
        vi.advanceTimersByTime(CHAT_DONE_TOAST_MS - 100);
        showChatDoneToast("Left Design team");
        vi.advanceTimersByTime(CHAT_DONE_TOAST_MS - 100);
        let shown: { text: string } | undefined;
        chatDoneToastStore.subscribe((value) => (shown = value))();
        expect(shown?.text).toBe("Left Design team");

        vi.advanceTimersByTime(100);
        chatDoneToastStore.subscribe((value) => (shown = value))();
        expect(shown).toBeUndefined();
    });
});
