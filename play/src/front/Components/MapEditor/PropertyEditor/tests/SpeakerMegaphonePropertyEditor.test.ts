import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

// The Stages already on the map, by area id: their speaker property and name.
const areas = new Map<string, { id: string; properties: unknown[] }>();

vi.mock("../../../../Phaser/Game/GameManager", () => ({
    gameManager: {
        tryGetCurrentGameScene: () => ({
            getGameMap: () => ({ getGameMapAreas: () => ({ getAreas: () => areas }) }),
        }),
    },
}));
vi.mock("../../../../Stores/UserInputStore", async () => {
    const { writable } = await import("svelte/store");
    return { inputFormFocusStore: writable(false) };
});
vi.mock("../../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const text = (value: string) => () => value;
    const LL = readable({
        mapEditor: {
            properties: {
                chatEnabled: text("Associate a dedicated chat channel"),
                speakerMegaphone: {
                    label: text("Podium"),
                    nameLabel: text("Name"),
                    namePlaceholder: text("MainStage"),
                    nameTaken: ({ name }: { name: string }) => `A Stage called ${name} already exists.`,
                    nameEmpty: text("Give this Stage a name."),
                },
            },
        },
        form: { optional: text("Optional") },
    });
    return { LL, default: LL };
});

import SpeakerMegaphonePropertyEditor from "../SpeakerMegaphonePropertyEditor.svelte";

function stage(areaId: string, name: string) {
    areas.set(areaId, {
        id: areaId,
        properties: [{ id: `${areaId}-stage`, type: "speakerMegaphone", name, chatEnabled: false }],
    });
}

describe("the Stage name field", () => {
    let target: HTMLElement;
    let editor: SpeakerMegaphonePropertyEditor | undefined;
    let changes: number;
    const property = { id: "mine", type: "speakerMegaphone" as const, name: "MySpeakerZone2", chatEnabled: false };

    beforeEach(() => {
        areas.clear();
        stage("hall", "Main Stage");
        target = document.createElement("div");
        document.body.appendChild(target);
        changes = 0;
        editor = new SpeakerMegaphonePropertyEditor({ target, props: { property: { ...property } } });
        editor.$on("change", () => changes++);
    });

    afterEach(() => {
        editor?.$destroy();
        editor = undefined;
        target.remove();
    });

    async function type(value: string): Promise<HTMLInputElement> {
        const input = target.querySelector<HTMLInputElement>("input#tabLink");
        if (!input) throw new Error("no name field");
        input.value = value;
        input.dispatchEvent(new Event("input"));
        input.dispatchEvent(new Event("change"));
        await tick();
        return input;
    }

    it("keeps spaces, capitals and Arabic as typed", async () => {
        expect((await type("  Keynote Hall ")).value).toBe("Keynote Hall");
        expect((await type("المسرح الرئيسي")).value).toBe("المسرح الرئيسي");
        expect(changes).toBe(2);
        expect(target.textContent).not.toContain("already exists");
    });

    it.each(["Main Stage", "main stage", "MAINSTAGE", "Main-Stage"])(
        "refuses %s next to a Stage called Main Stage, and saves nothing",
        async (name) => {
            await type(name);
            expect(target.textContent).toContain("A Stage called Main Stage already exists.");
            expect(changes).toBe(0);
        }
    );

    it("refuses an empty name", async () => {
        await type("   ");
        expect(target.textContent).toContain("Give this Stage a name.");
        expect(changes).toBe(0);
    });

    it("lets the Stage keep its own name", async () => {
        areas.set("mine-area", {
            id: "mine-area",
            properties: [{ ...property, name: "Main Stage 2" }],
        });
        await type("Main Stage 2");
        expect(changes).toBe(1);
    });

    it("puts the last saved name back when the chat switch changes after a refused name", async () => {
        const input = await type("main stage");
        const chat = target.querySelector<HTMLInputElement>("input#chatEnabled");
        chat?.click();
        await tick();
        expect(input.value).toBe("MySpeakerZone2");
        expect(target.textContent).not.toContain("already exists");
        expect(changes).toBe(1);
    });
});
