import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The tests run Svelte's server build, where onMount and actions do nothing; the guide needs the browser one
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));

const mocks = vi.hoisted(() => ({ guideOpenStore: undefined as unknown, closeGuide: vi.fn() }));

vi.mock("../../../Install/InstallWiring", async () => {
    const { writable } = await import("svelte/store");
    mocks.guideOpenStore = writable(undefined);
    return { installApp: { guideOpenStore: mocks.guideOpenStore, closeGuide: mocks.closeGuide } };
});
// The game's keys are switched off while a text field has focus
vi.mock("../../../Stores/UserInputStore", async () => {
    const { writable } = await import("svelte/store");
    return { enableUserInputsStore: writable(true) };
});
vi.mock("../../../Install/InstallIcon", () => ({ installIconSrc: () => undefined }));
vi.mock("../../../../i18n/i18n-svelte", async () => (await import("../../Woka/tests/i18nStub")).i18nStub);

import type { Writable } from "svelte/store";
import { enableUserInputsStore } from "../../../Stores/UserInputStore";
import type { InstallGuide as InstallGuideKind } from "../../../Install/InstallPlatform";
import InstallGuide from "../InstallGuide.svelte";
import { settle, stubBrowser } from "../../Woka/tests/i18nStub";

const userInputs = () => enableUserInputsStore as unknown as Writable<boolean>;
const guideOpenStore = () => mocks.guideOpenStore as Writable<InstallGuideKind | undefined>;

// #911: the guide opens without moving keyboard focus to it, and Escape does nothing
describe("the install guide and the keyboard", () => {
    let component: InstallGuide | undefined;
    let target: HTMLElement;
    let profileButton: HTMLButtonElement;

    beforeEach(() => {
        stubBrowser();
        vi.clearAllMocks();
        guideOpenStore().set(undefined);
        // The profile button of the action bar, where the focus was before the menu closed
        const bar = document.createElement("div");
        bar.setAttribute("data-testid", "action-user");
        profileButton = document.createElement("button");
        profileButton.className = "profile-button";
        bar.appendChild(profileButton);
        document.body.appendChild(bar);
        target = document.createElement("div");
        document.body.appendChild(target);
        component = new InstallGuide({ target });
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
        profileButton.parentElement?.remove();
    });

    /** The guides leave with a short animation; the focus moves once they are gone. */
    async function leaves() {
        await vi.waitFor(() => expect(guide()).toBeNull(), { timeout: 3000 });
        await settle();
    }

    const guide = () => target.querySelector<HTMLElement>('[data-testid="install-guide"]');

    describe.each<InstallGuideKind>(["iphone-safari", "open-in-safari", "browser-chrome-android", "mac-safari"])(
        "%s",
        (kind) => {
            it("puts focus on the Close button when it opens", async () => {
                guideOpenStore().set(kind);
                await settle();
                expect(guide()).not.toBeNull();
                const active = document.activeElement as HTMLElement | null;
                expect(active).not.toBeNull();
                expect(guide()?.contains(active)).toBe(true);
                expect(active?.tagName).toBe("BUTTON");
                expect(active?.matches('.u-close, [data-testid="install-guide-close"]')).toBe(true);
            });

            it("closes on Escape", async () => {
                guideOpenStore().set(kind);
                await settle();
                document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
                expect(mocks.closeGuide).toHaveBeenCalledTimes(1);
            });

            it("gives focus back to the profile button when it closes", async () => {
                guideOpenStore().set(kind);
                await settle();
                guideOpenStore().set(undefined);
                await leaves();
                expect(guide()).toBeNull();
                expect(document.activeElement).toBe(profileButton);
            });
        }
    );

    it("does nothing on Escape while no guide is open, and ignores other keys", async () => {
        await settle();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        guideOpenStore().set("mac-safari");
        await settle();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
        expect(mocks.closeGuide).not.toHaveBeenCalled();
    });

    it("leaves Escape to a text field the player is typing in", async () => {
        guideOpenStore().set("mac-safari");
        await settle();
        // The chat and the forms switch the game's keys off while a field has focus
        userInputs().set(false);
        try {
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            expect(mocks.closeGuide).not.toHaveBeenCalled();
        } finally {
            userInputs().set(true);
        }
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(mocks.closeGuide).toHaveBeenCalledTimes(1);
    });

    it("does not pull focus away when the player has already moved on", async () => {
        guideOpenStore().set("mac-safari");
        await settle();
        const elsewhere = document.createElement("input");
        document.body.appendChild(elsewhere);
        elsewhere.focus();
        guideOpenStore().set(undefined);
        await leaves();
        expect(guide()).toBeNull();
        expect(document.activeElement).toBe(elsewhere);
        elsewhere.remove();
    });
});
