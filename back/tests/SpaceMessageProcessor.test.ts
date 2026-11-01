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
                    voiceWaveform: [],
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
                spaceMessage: {
                    message: "hello",
                    characterTextures: [],
                    galleryUrls: [],
                    fileNames: [],
                    voiceWaveform: [],
                },
            },
            "room_7",
            [sender]
        );
        expect(processed.$case === "spaceMessage" && processed.spaceMessage.spoken).toBeUndefined();
    });

    it("passes on a voice note's length and shape, so nobody has to read the file to draw it", () => {
        const processed = eventProcessor.processPublicEvent(
            {
                $case: "spaceMessage",
                spaceMessage: {
                    message: "",
                    characterTextures: [],
                    galleryUrls: [],
                    fileNames: [],
                    fileName: "Voice message.m4a",
                    voiceDurationMs: 4200,
                    voiceWaveform: [82, 512, 1024],
                },
            },
            "room_7",
            [sender]
        );
        expect(processed.$case === "spaceMessage" && processed.spaceMessage.voiceDurationMs).toBe(4200);
        expect(processed.$case === "spaceMessage" && processed.spaceMessage.voiceWaveform).toEqual([82, 512, 1024]);
    });
});
