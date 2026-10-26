import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import type * as SvelteRuntime from "svelte";
import { get, readable } from "svelte/store";

vi.mock("svelte", async (importOriginal) => {
    const svelte = await importOriginal<typeof SvelteRuntime>();
    // eslint-disable-next-line svelte/no-svelte-internal
    const { onMount } = await import("svelte/internal");
    return { ...svelte, onMount };
});

const sheet = vi.hoisted(() => ({ lowerChatSheet: vi.fn(), bringOpenHereInFront: vi.fn() }));
vi.mock("../../../src/front/Chat/ChatSheetStore", () => ({ lowerChatSheet: sheet.lowerChatSheet }));
vi.mock("../../../src/front/Stores/SideWindowInFrontStore", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    bringOpenHereInFront: sheet.bringOpenHereInFront,
}));
vi.mock("../../../src/i18n/i18n-svelte", () => {
    const deep = (): unknown => new Proxy(() => "", { get: () => deep() });
    return { default: readable(deep()) };
});

import ArtifactCardView from "../../../src/front/Artifacts/ArtifactCardView.svelte";
import { ARTIFACT_CHAT_CONTEXT } from "../../../src/front/Artifacts/artifactChatContext";
import { openArtifactWindow } from "../../../src/front/Artifacts/openArtifact";
import { coWebsites } from "../../../src/front/Stores/CoWebsiteStore";
import type { ArtifactCard } from "../../../src/front/Artifacts/artifactCard";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const card = (version: number): ArtifactCard => ({
    id: ID,
    version,
    title: "Quests board",
    kind: "app",
    maker: undefined,
});

describe("an artifact card in the chat", () => {
    let target: HTMLElement;
    let component: { $destroy(): void } | undefined;

    beforeEach(() => {
        vi.clearAllMocks();
        coWebsites.empty();
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
        coWebsites.empty();
    });

    function mountCard(version: number): HTMLButtonElement {
        component = new ArtifactCardView({
            target,
            props: { card: card(version), makerName: "Scout" },
            context: new Map([[ARTIFACT_CHAT_CONTEXT, () => ({ kind: "nearby", ref: "bubble" })]]),
        });
        return [
            ...target.querySelectorAll<HTMLButtonElement>('[data-testid="artifactCard"]'),
        ].pop() as HTMLButtonElement;
    }

    it("shows its title and opens the window at its version, naming the chat and the maker", async () => {
        const button = mountCard(2);
        expect(button.textContent).toContain("Quests board");
        expect(button.classList.contains("open")).toBe(false);

        button.click();
        await tick();

        const opened = openArtifactWindow(ID);
        expect(opened?.chat).toEqual({ kind: "nearby", ref: "bubble" });
        expect(get(opened!.version)).toBe(2);
        expect(get(opened!.summary).makerName).toBe("Scout");
        expect(sheet.lowerChatSheet).toHaveBeenCalledTimes(1);
        expect(button.classList.contains("open")).toBe(true);
    });

    it("reuses the open window for another card of the same artifact and moves it to that version", async () => {
        const first = mountCard(1);
        first.click();
        await tick();
        const opened = openArtifactWindow(ID);

        const second = mountCard(3);
        second.click();
        await tick();

        expect(get(coWebsites)).toHaveLength(1);
        expect(openArtifactWindow(ID)).toBe(opened);
        expect(get(opened!.version)).toBe(3);
        expect(sheet.bringOpenHereInFront).toHaveBeenCalledTimes(2);
    });
});
