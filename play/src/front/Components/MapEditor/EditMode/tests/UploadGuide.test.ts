import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import type { EntityPrefab } from "@workadventure/map-editor";

vi.mock("../../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    // Every text is its own key, so the page renders without the real translations
    const texts = (path: string): unknown =>
        new Proxy(() => path, {
            get: (_target, key) => texts(`${path}.${String(key)}`),
        });
    const LL = readable(texts("LL"));
    return { LL, default: LL };
});
vi.mock("../../../../Stores/MapEditorStore", async () => {
    const { writable } = await import("svelte/store");
    return {
        mapEditorEntityUploadEventStore: writable(undefined),
        selectCategoryStore: writable(undefined),
        mapEditorVisibilityStore: writable(true),
    };
});
vi.mock("../../../../Stores/MobileLayoutStore", async () => {
    const { writable } = await import("svelte/store");
    return { mobileLayoutStore: writable(false) };
});
vi.mock("../../../../Stores/CurrentPlayerWokaStore", async () => {
    const { writable } = await import("svelte/store");
    return { currentPlayerWokaStore: writable(undefined) };
});
const warnings = vi.hoisted(() => ({ addWarningMessage: vi.fn() }));
vi.mock("../../../../Stores/ErrorStore", () => ({ warningMessageStore: warnings }));

import UploadGuide from "../UploadGuide.svelte";

function upload(collisionGrid: number[][] | undefined): EntityPrefab {
    return {
        id: "upload",
        name: "Crate",
        tags: ["Custom"],
        imagePath: "https://maps.example.test/crate.png",
        collisionGrid,
        depthOffset: 0,
        direction: "Down",
        color: "",
        collectionName: "custom",
        type: "Custom",
    } as unknown as EntityPrefab;
}

describe("Edit this upload", () => {
    let target: HTMLElement;
    let guide: UploadGuide | undefined;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
        vi.spyOn(console, "error").mockImplementation(() => {});
        // jsdom has no object URLs; the guide lets its picture go when it closes
        URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
        guide?.$destroy();
        guide = undefined;
        target.remove();
        vi.restoreAllMocks();
    });

    /** Opens the guide on the upload, its 64 × 64 picture loaded */
    async function open(editing: EntityPrefab, loadPlacedIn?: () => Promise<never[]>) {
        guide = new UploadGuide({ target, props: { editing, loadPlacedIn } });
        const picture = target.querySelector<HTMLImageElement>(".em-pic img");
        if (!picture) throw new Error("no picture");
        Object.defineProperty(picture, "naturalWidth", { value: 64 });
        Object.defineProperty(picture, "naturalHeight", { value: 64 });
        picture.dispatchEvent(new Event("load"));
        await tick();
        return guide;
    }

    const click = async (testId: string) => {
        const button = target.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
        if (!button) throw new Error(`no ${testId}`);
        button.click();
        await tick();
    };

    async function savedGrid(editing: EntityPrefab): Promise<number[][] | undefined> {
        const opened = await open(editing);
        const saved: EntityPrefab[] = [];
        opened.$on("save", (event: CustomEvent<EntityPrefab>) => saved.push(event.detail));
        await click("meet-through");
        await click("applyEntityModifications");
        expect(saved).toHaveLength(1);
        return saved[0].collisionGrid;
    }

    it('saves no grid once "Walk through it" takes off the red squares it had', async () => {
        expect(
            await savedGrid(
                upload([
                    [0, 0],
                    [1, 1],
                ])
            )
        ).toBeUndefined();
    });

    it("keeps the empty grid an older upload was saved with", async () => {
        expect(
            await savedGrid(
                upload([
                    [0, 0],
                    [0, 0],
                ])
            )
        ).toEqual([
            [0, 0],
            [0, 0],
        ]);
    });

    it("does not delete the upload when Cancel is pressed before the rooms it is placed in are known", async () => {
        let answer: (placedIn: never[]) => void = () => {};
        const opened = await open(
            upload(undefined),
            () =>
                new Promise<never[]>((resolve) => {
                    answer = resolve;
                })
        );
        const removed: unknown[] = [];
        opened.$on("remove", (event: CustomEvent<unknown>) => removed.push(event.detail));

        await click("removeEntity");
        const cancel = [...target.querySelectorAll<HTMLButtonElement>(".em-actions button")].find(
            (button) => button.textContent?.trim() === "LL.mapEditor.edit.upload.cancel"
        );
        cancel?.click();
        // Placed nowhere: had the guide stayed open, the upload would be deleted at once
        answer([]);
        await Promise.resolve();
        await tick();

        expect(removed).toEqual([]);
        expect(warnings.addWarningMessage).not.toHaveBeenCalled();
    });

    it("still deletes an upload placed nowhere while the guide stays open", async () => {
        const opened = await open(upload(undefined), () => Promise.resolve([]));
        const removed: unknown[] = [];
        opened.$on("remove", (event: CustomEvent<unknown>) => removed.push(event.detail));

        await click("removeEntity");
        await Promise.resolve();
        await tick();

        expect(removed).toEqual([{ id: "upload" }]);
    });

    it("names the front and back slider for screen readers", async () => {
        await open(upload(undefined));
        expect(target.querySelector('[data-testid="front-back"] input')?.getAttribute("aria-label")).toBe(
            "LL.mapEditor.edit.upload.lineTitle"
        );
    });
});
