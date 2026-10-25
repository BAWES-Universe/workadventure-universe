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

import { FileViewerCoWebsite } from "../../../../WebRtc/CoWebsite/FileViewerCoWebsite";
import FileViewerCowebsiteComponent from "../../FileViewerCowebsiteComponent.svelte";

describe("a picture put away with the other items", () => {
    let component: FileViewerCowebsiteComponent | undefined;
    let target: HTMLDivElement;

    const flush = async () => {
        for (let i = 0; i < 6; i++) await tick();
    };

    beforeEach(() => {
        URL.createObjectURL = vi.fn(() => "blob:picture");
        URL.revokeObjectURL = vi.fn();
        target = document.createElement("div");
        document.body.append(target);
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
    });

    it("keeps its controls when it is parked and comes back", async () => {
        const picture = new FileViewerCoWebsite({
            key: "chat:blob:http://play/picture.png",
            name: "picture.png",
            load: () => Promise.resolve(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer),
            download: () => Promise.resolve(),
        });
        component = new FileViewerCowebsiteComponent({
            target,
            props: { actualCowebsite: picture, visible: true, parked: false },
        });
        await flush();
        expect(target.querySelector('button[aria-haspopup="menu"]')).not.toBeNull();

        component.$set({ visible: false, parked: true });
        await flush();
        component.$set({ visible: true, parked: false });
        await flush();

        expect(target.querySelector('button[aria-haspopup="menu"]')).not.toBeNull();
    });
});
