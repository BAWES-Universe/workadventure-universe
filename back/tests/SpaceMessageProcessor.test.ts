import { describe, expect, it } from "vitest";
import type { SpaceUser } from "@workadventure/messages";
import { eventProcessor } from "../src/Model/EventProcessorInit";

const sender = { spaceUserId: "room_7", name: "Khalid", characterTextures: [] } as unknown as SpaceUser;

describe("the nearby chat line the server passes on", () => {
    it("keeps what says a line was spoken to a voice bot, so a text-only bot in the bubble can tell it is not a new request", () => {
        const processed = eventProcessor.processPublicEvent(
            {
                $case: "spaceMessage",
                spaceMessage: {
                    message: "Actually which of them replied this week",
                    characterTextures: [],
                    galleryUrls: [],
                    fileNames: [],
                    spoken: { botId: "b-1", turnId: "4-2" },
                },
            },
            "room_7",
            [sender]
        );
        expect(processed.$case === "spaceMessage" && processed.spaceMessage.spoken).toEqual({
            botId: "b-1",
            turnId: "4-2",
        });
    });

    it("leaves a typed line without it", () => {
        const processed = eventProcessor.processPublicEvent(
            {
                $case: "spaceMessage",
                spaceMessage: { message: "hello", characterTextures: [], galleryUrls: [], fileNames: [] },
            },
            "room_7",
            [sender]
        );
        expect(processed.$case === "spaceMessage" && processed.spaceMessage.spoken).toBeUndefined();
    });
});
