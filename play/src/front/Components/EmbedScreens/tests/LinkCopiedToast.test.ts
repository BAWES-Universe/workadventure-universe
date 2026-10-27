// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import LinkCopiedToast from "../LinkCopiedToast.svelte";
import { LINK_COPIED_TOAST_MS, linkCopiedToastStore, showLinkCopiedToast } from "../../../Stores/LinkCopiedToastStore";

// The tests run Svelte's server build; the note needs the browser one.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));

vi.mock("../../../../i18n/i18n-svelte", async () => (await import("../../Woka/tests/i18nStub")).i18nStub);

describe("the note shown after copying a link", () => {
    let component: LinkCopiedToast | undefined;
    afterEach(() => {
        vi.useRealTimers();
        component?.$destroy();
        component = undefined;
        linkCopiedToastStore.set(undefined);
        document.body.innerHTML = "";
    });

    function mount() {
        const target = document.createElement("div");
        document.body.append(target);
        component = new LinkCopiedToast({ target });
    }

    it("shows the words, with nothing to press, and goes away by itself", async () => {
        vi.useFakeTimers();
        mount();
        expect(document.querySelector('[data-testid="linkCopiedToast"]')).toBeNull();

        showLinkCopiedToast();
        await tick();
        const toast = document.querySelector('[data-testid="linkCopiedToast"]');
        expect(toast?.textContent).toContain("notification.urlCopiedToClipboard");
        expect(toast?.querySelector("button")).toBeNull();

        vi.advanceTimersByTime(LINK_COPIED_TOAST_MS);
        await tick();
        // It fades out first: step the animation frames the fade runs on.
        for (let elapsed = 0; elapsed < 500; elapsed += 16) vi.advanceTimersByTime(16);
        await tick();
        expect(document.querySelector('[data-testid="linkCopiedToast"]')).toBeNull();
    });

    it("stays a full while again when the link is copied again", () => {
        vi.useFakeTimers();
        showLinkCopiedToast();
        vi.advanceTimersByTime(LINK_COPIED_TOAST_MS - 100);
        showLinkCopiedToast();
        vi.advanceTimersByTime(LINK_COPIED_TOAST_MS - 100);
        let shown: object | undefined;
        linkCopiedToastStore.subscribe((value) => (shown = value))();
        expect(shown).toBeDefined();

        vi.advanceTimersByTime(100);
        linkCopiedToastStore.subscribe((value) => (shown = value))();
        expect(shown).toBeUndefined();
    });
});
