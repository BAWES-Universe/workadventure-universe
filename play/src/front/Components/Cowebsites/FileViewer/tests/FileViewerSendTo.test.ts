/* eslint-disable no-await-in-loop -- each tick has to finish before the next one starts */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {};
});
import { tick } from "svelte";

// The tests run Svelte's server build, where onMount does nothing; the readers need the browser one.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../../../../../i18n/i18n-svelte", async () => (await import("../../../Woka/tests/i18nStub")).i18nStub);
vi.mock("../../../../Administration/AnalyticsClient", () => ({
    analyticsClient: new Proxy({}, { get: () => () => {} }),
}));

import { FileViewerCoWebsite, type FileViewerSource } from "../../../../WebRtc/CoWebsite/FileViewerCoWebsite";
import FileViewerCowebsiteComponent from "../../FileViewerCowebsiteComponent.svelte";

describe("Send to in the file viewer's header", () => {
    let component: FileViewerCowebsiteComponent | undefined;
    let target: HTMLDivElement;

    const flush = async () => {
        for (let i = 0; i < 6; i++) await tick();
    };

    beforeEach(() => {
        target = document.createElement("div");
        document.body.append(target);
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
    });

    async function show(extra: Partial<FileViewerSource>) {
        const viewer = new FileViewerCoWebsite({
            key: "chat:blob:http://play/notes.md",
            name: "notes.md",
            load: () => Promise.resolve(new TextEncoder().encode("# Notes").buffer),
            download: () => Promise.resolve(),
            ...extra,
        });
        component = new FileViewerCowebsiteComponent({
            target,
            props: { actualCowebsite: viewer, visible: true, parked: false },
        });
        await flush();
    }

    const sendTo = () => target.querySelector<HTMLButtonElement>('[data-testid="fileViewerSendTo"]');
    const download = () => target.querySelector<HTMLButtonElement>('[data-testid="fileViewerDownload"]');

    it("is a button beside Download for a chat's file, and opens the pick of who and what", async () => {
        const open = vi.fn();
        await show({ sendTo: open });
        expect(sendTo()).not.toBeNull();
        expect(download()).not.toBeNull();
        // Beside Download: the same row, Send to just before it
        expect(sendTo()?.nextElementSibling).toBe(download());
        expect(sendTo()?.getAttribute("aria-label")).toBe("chat.sendTo.title");

        sendTo()?.click();
        expect(open).toHaveBeenCalledOnce();
    });

    it("is not there for a file that is not the person's to pass on, such as a map's", async () => {
        await show({});
        expect(sendTo()).toBeNull();
        expect(download()).not.toBeNull();
    });
});
