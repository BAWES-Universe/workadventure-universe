import { describe, expect, it, vi } from "vitest";
import type { EntityDataProperty } from "@workadventure/map-editor";
import { Entity } from "../Entity";

vi.hoisted(() => {
    // An object is a Phaser image; these checks only read its settings.
    (globalThis as unknown as { Phaser: unknown }).Phaser = {
        GameObjects: { Image: class {} },
        Events: { EventEmitter: class {} },
        Scene: class {},
    };
    (window as unknown as { env: Record<string, unknown> }).env = {};
});
vi.mock("../../Game/GameScene", () => ({ GameScene: class {} }));
vi.mock("../../Entity/SpeechDomElement", () => ({ SpeechDomElement: class {} }));
vi.mock("../../../WebRtc/CoWebsite/SimpleCoWebsite", () => ({ SimpleCoWebsite: class {} }));
vi.mock("../../../FileViewer/openFileViewer", () => ({
    createMapFileViewer: vi.fn(),
    mapFileOpensInViewer: vi.fn(),
}));
vi.mock("../../../Stores/CoWebsiteStore", () => ({ coWebsites: {} }));
vi.mock("../../../Artifacts/openArtifactLink", () => ({ openArtifactLink: () => false }));
vi.mock("../../../Utils/TriggerHint", () => ({ getTriggerHint: () => "Press [SPACE] to interact with it" }));
vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    return {
        default: readable({
            trigger: { spaceKeyboard: () => "[SPACE]", object: () => "Press [SPACE] to interact with it" },
            mapEditor: {
                explorer: { details: { moveToEntity: () => "Walk there" } },
                properties: {
                    playAudio: { actionButtonLabel: () => "Play music" },
                    openWebsite: { actionButtonLabel: () => "Open link" },
                    openFile: { actionButtonLabel: () => "Open file" },
                },
            },
        }),
    };
});

function objectWith(properties: Partial<EntityDataProperty>[]): Entity {
    const entity = Object.create(Entity.prototype) as Entity;
    Object.assign(entity, { entityData: { properties } });
    return entity;
}

const rangeSound = { id: "s", type: "playAudio", audioLink: "a.mp3", startsOn: "range" } as const;
const clickSound = { id: "s", type: "playAudio", audioLink: "a.mp3", startsOn: "click" } as const;
const link = { id: "l", type: "openWebsite", link: "https://example.com", newTab: true } as const;

describe("Look around's button on an object (#1739)", () => {
    it("is named after the link when the sound plays in range", () => {
        const speaker = objectWith([rangeSound, link]);
        expect(speaker.hasClickAction()).toBe(true);
        expect(speaker.actionButtonLabel).toBe("Open link");
    });

    it("does not show for a sound that plays in range alone", () => {
        expect(objectWith([rangeSound]).hasClickAction()).toBe(false);
    });

    it("does not show for a link left empty", () => {
        expect(objectWith([{ ...link, link: "" }]).hasClickAction()).toBe(false);
    });

    it("still offers a sound that plays on click", () => {
        const jukebox = objectWith([clickSound]);
        expect(jukebox.hasClickAction()).toBe(true);
        expect(jukebox.actionButtonLabel).toBe("Play music");
    });
});

describe("The hint over an object when you walk near it (#1740)", () => {
    const labelled = { ...link, buttonLabel: "Open the menu" };

    it("names a single click action after its Button Label", () => {
        expect(objectWith([labelled]).getNearHint()).toBe("[SPACE] Open the menu");
    });

    it("lets a Toast Message win", () => {
        expect(objectWith([{ ...labelled, triggerMessage: "Hello!" }]).getNearHint()).toBe("Hello!");
    });

    it("stays the usual hint with two click actions", () => {
        const sound = { ...clickSound, buttonLabel: "Play" };
        expect(objectWith([labelled, sound]).getNearHint()).toBe("Press [SPACE] to interact with it");
    });

    it("stays the usual hint with an empty label", () => {
        expect(objectWith([{ ...link, buttonLabel: "" }]).getNearHint()).toBe("Press [SPACE] to interact with it");
        expect(objectWith([link]).getNearHint()).toBe("Press [SPACE] to interact with it");
    });

    it("does not count a sound that plays in range", () => {
        const sound = { ...rangeSound, buttonLabel: "Play" };
        expect(objectWith([sound]).getNearHint()).toBe("Press [SPACE] to interact with it");
        expect(objectWith([sound, labelled]).getNearHint()).toBe("[SPACE] Open the menu");
    });
});
