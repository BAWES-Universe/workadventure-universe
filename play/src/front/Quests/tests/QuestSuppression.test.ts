import { describe, expect, it } from "vitest";
import { AvailabilityStatus } from "@workadventure/messages";
import type { QuestCoverInputs } from "../QuestSuppression";
import { computeQuestQuiet, computeQuestSuppression } from "../QuestSuppression";

const nothing: QuestCoverInputs = {
    chatCoversGame: false,
    chatOpenOnNarrowScreen: false,
    modalOpen: false,
    settingsMenuOpen: false,
    mapEditorOpen: false,
    videoFullScreen: false,
    popupOpen: false,
    personCardOpen: false,
    expressTrayOpen: false,
    keyboardOpen: false,
};

describe("computeQuestSuppression", () => {
    it("shows everything when nothing covers the game", () => {
        expect(computeQuestSuppression(nothing)).toEqual({ surfaces: false, pill: false });
    });

    it.each([
        "chatCoversGame",
        "chatOpenOnNarrowScreen",
        "modalOpen",
        "settingsMenuOpen",
        "mapEditorOpen",
        "videoFullScreen",
        "popupOpen",
        "personCardOpen",
        "keyboardOpen",
    ] as const)("hides every surface and the pill when %s", (key) => {
        expect(computeQuestSuppression({ ...nothing, [key]: true })).toEqual({ surfaces: true, pill: true });
    });

    it("keeps the pill under the Express tray but hides the cards", () => {
        expect(computeQuestSuppression({ ...nothing, expressTrayOpen: true })).toEqual({
            surfaces: true,
            pill: false,
        });
    });
});

describe("computeQuestQuiet", () => {
    const base = { inCall: false, typing: false, availabilityStatus: AvailabilityStatus.ONLINE };

    it("is not quiet when online and idle", () => {
        expect(computeQuestQuiet(base)).toBe(false);
    });

    it("is quiet in a call or while typing", () => {
        expect(computeQuestQuiet({ ...base, inCall: true })).toBe(true);
        expect(computeQuestQuiet({ ...base, typing: true })).toBe(true);
    });

    it.each([
        AvailabilityStatus.DO_NOT_DISTURB,
        AvailabilityStatus.BUSY,
        AvailabilityStatus.BACK_IN_A_MOMENT,
        AvailabilityStatus.SILENT,
    ])("is quiet with status %s", (availabilityStatus) => {
        expect(computeQuestQuiet({ ...base, availabilityStatus })).toBe(true);
    });

    it("is not quiet just for being away", () => {
        expect(computeQuestQuiet({ ...base, availabilityStatus: AvailabilityStatus.AWAY })).toBe(false);
    });
});
