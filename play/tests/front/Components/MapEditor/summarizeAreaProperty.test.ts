import { describe, expect, it, vi } from "vitest";
import type { AreaDataProperty } from "@workadventure/map-editor";
import type { TranslationFunctions } from "../../../../src/i18n/i18n-types";

// The module also builds the "Add to this area" rows, which reach for the running game and the environment.
vi.mock("../../../../src/front/Phaser/Game/GameManager", () => ({
    gameManager: { tryGetCurrentGameScene: () => undefined },
}));
vi.mock("../../../../src/front/Stores/MapEditorStore", () => ({ mapEditorSelectedAreaPreviewStore: {} }));
vi.mock("../../../../src/front/Enum/EnvironmentVariable", () => ({
    ADMIN_URL: "",
    FEATURE_FLAG_BROADCAST_AREAS: false,
    MATRIX_PUBLIC_URI: "",
}));
vi.mock("../../../../src/front/Enum/ComputedConst", () => ({ ABSOLUTE_PUSHER_URL: "http://pusher.localhost/" }));
vi.mock("../../../../src/front/WebRtc/LayoutManager", () => ({ ON_ACTION_TRIGGER_ENTER: "onaction" }));

import { createAreaProperty, summarizeAreaProperty } from "../../../../src/front/Components/MapEditor/EditMode/areaProperties";

// The summary words, as the English dictionary has them.
const LL = {
    mapEditor: {
        edit: {
            areas: {
                summary: {
                    toRoom: ({ room }: { room: string }) => `To ${room}`,
                    toRoomAt: ({ room, area }: { room: string; area: string }) => `To ${room} · at ${area}`,
                    chatOn: ({ name }: { name: string }) => `${name} · chat on`,
                    hears: ({ stage }: { stage: string }) => `Hears ${stage}`,
                    onlyTags: ({ tags }: { tags: string }) => `Only: ${tags}`,
                },
            },
        },
    },
} as unknown as TranslationFunctions;

const FALLBACK = "fixed line";
const summary = (property: object, stages = new Map<string, string>()) =>
    summarizeAreaProperty(LL, { id: "p", ...property } as AreaDataProperty, FALLBACK, stages);

describe("summarizeAreaProperty", () => {
    it("names the room an exit goes to, and the area it lands at", () => {
        expect(summary({ type: "exit", url: "/_/global/example.com/maps/Big%20Lobby.wam#start", areaName: "" })).toBe(
            "To Big Lobby"
        );
        expect(summary({ type: "exit", url: "/@/acme/office/lobby.wam", areaName: "Front door" })).toBe(
            "To lobby · at Front door"
        );
        expect(summary({ type: "exit", url: "", areaName: "" })).toBe(FALLBACK);
    });

    it("gives a stage's name, and says when its chat is on", () => {
        expect(summary({ type: "speakerMegaphone", name: "Keynote", chatEnabled: false })).toBe("Keynote");
        expect(summary({ type: "speakerMegaphone", name: "Keynote", chatEnabled: true })).toBe("Keynote · chat on");
        expect(summary({ type: "speakerMegaphone", name: " ", chatEnabled: false })).toBe(FALLBACK);
    });

    it("says which stage an audience hears", () => {
        const stages = new Map([["stage-1", "Keynote"]]);
        expect(summary({ type: "listenerMegaphone", speakerZoneName: "stage-1", chatEnabled: false }, stages)).toBe(
            "Hears Keynote"
        );
        expect(summary({ type: "listenerMegaphone", speakerZoneName: "gone", chatEnabled: false }, stages)).toBe(
            FALLBACK
        );
    });

    it("lists the roles allowed in, once each", () => {
        expect(
            summary({ type: "restrictedRightsPropertyData", readTags: ["admin", "staff"], writeTags: ["staff"] })
        ).toBe("Only: admin, staff");
        expect(summary({ type: "restrictedRightsPropertyData", readTags: [], writeTags: [] })).toBe(FALLBACK);
    });

    it("shows the host of a link, without www", () => {
        expect(summary({ type: "openWebsite", link: "https://www.example.com/some/page?x=1" })).toBe("example.com");
        expect(summary({ type: "openWebsite", link: "" })).toBe(FALLBACK);
        expect(summary({ type: "openWebsite", link: "not a link" })).toBe(FALLBACK);
    });

    it("shows the name of a file", () => {
        expect(summary({ type: "openFile", link: "https://x/y.pdf", name: "Handbook.pdf" })).toBe("Handbook.pdf");
        expect(summary({ type: "openFile", link: "https://x/y.pdf", name: null })).toBe(FALLBACK);
    });

    it("shows the sound's file name, and the volume when it is not full", () => {
        const audioLink = "https://example.com/files/Lobby%20music.mp3";
        expect(summary({ type: "playAudio", audioLink })).toBe("Lobby music.mp3");
        expect(summary({ type: "playAudio", audioLink, volume: 1 })).toBe("Lobby music.mp3");
        expect(summary({ type: "playAudio", audioLink, volume: 0.5 })).toBe("Lobby music.mp3 · 50%");
        expect(summary({ type: "playAudio", audioLink: "" })).toBe(FALLBACK);
    });

    it("quotes a message, cut short when it is long", () => {
        expect(summary({ type: "tooltipPropertyData", content: "Welcome!" })).toBe("“Welcome!”");
        const long = summary({ type: "tooltipPropertyData", content: "a".repeat(60) });
        expect(long).toBe(`“${"a".repeat(40)}…”`);
        expect(summary({ type: "tooltipPropertyData", content: "" })).toBe(FALLBACK);
    });

    it("shows a chat room's name", () => {
        expect(summary({ type: "matrixRoomPropertyData", displayName: "Lounge", shouldOpenAutomatically: false })).toBe(
            "Lounge"
        );
        expect(summary({ type: "matrixRoomPropertyData", displayName: "", shouldOpenAutomatically: false })).toBe(
            FALLBACK
        );
    });

    it("keeps the fixed line for everything else", () => {
        expect(summary({ type: "silent" })).toBe(FALLBACK);
        expect(summary({ type: "highlight" })).toBe(FALLBACK);
    });
});

describe("createAreaProperty", () => {
    it("shows our own site as the example address of a new Open Link", () => {
        const property = createAreaProperty(LL, "openWebsite") as AreaDataProperty & { placeholder?: string };
        expect(property.placeholder).toBe("https://bawes.net");
    });
});
