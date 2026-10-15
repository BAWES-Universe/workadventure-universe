import { describe, it, expect } from "vitest";
import {
    DEPTH_EMOTE_INDEX,
    DEPTH_INGAME_TEXT_INDEX,
    DEPTH_UI_INDEX,
} from "../../../../src/front/Phaser/Game/DepthIndexes";

describe("DepthIndexes", () => {
    it("draws emotes in front of the player name layer but behind the UI", () => {
        expect(DEPTH_EMOTE_INDEX).toBeGreaterThan(DEPTH_INGAME_TEXT_INDEX);
        expect(DEPTH_EMOTE_INDEX).toBeLessThan(DEPTH_UI_INDEX);
    });
});
