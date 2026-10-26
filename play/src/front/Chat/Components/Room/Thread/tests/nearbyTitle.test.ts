import { describe, expect, it } from "vitest";
import type { TranslationFunctions } from "../../../../../../i18n/i18n-types";
import { nearbyChatName } from "../nearbyTitle";

const LL = { chat: { nearby: { title: () => "Chat de proximité" } } } as unknown as TranslationFunctions;

describe("the nearby chat's name on its own", () => {
    it("is the chat's name in the player's language, not the room's English default", () => {
        expect(nearbyChatName("bubble", "Proximity Chat", LL)).toBe("Chat de proximité");
        expect(nearbyChatName("none", "Proximity Chat", LL)).toBe("Chat de proximité");
    });

    it("is a meeting or stream area's name", () => {
        expect(nearbyChatName("meeting", "Stand-up", LL)).toBe("Stand-up");
        expect(nearbyChatName("stream", "Stage", LL)).toBe("Stage");
        expect(nearbyChatName("meeting", "", LL)).toBe("Chat de proximité");
    });
});
