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
vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    return {
        default: readable({
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
