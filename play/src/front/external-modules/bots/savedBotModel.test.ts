import { describe, expect, it } from "vitest";
import type { BotData } from "./types";
import { botDataFromSave } from "./savedBotModel";

const page = {
    id: "b1",
    name: "Micho",
    characterTexture: "old",
    aiProviderRef: "key-1",
    aiModel: "openai/gpt-4o-mini",
    chatInstructions: "Be brief",
    toolTimeoutSeconds: 180,
    maxReplyTokens: 8000,
    maxSteps: 10,
} as BotData;

describe("the bot page's record after a save from its page", () => {
    it("keeps the Patience, reply limits and model that save didn't send (CodeRabbit on #1524)", () => {
        const saved = botDataFromSave(
            {
                id: "b1",
                name: "Micho",
                characterTextureId: "new",
                aiProviderRef: "key-1",
                chatInstructions: "Be brief",
            } as BotData & {
                characterTextureId: string;
            },
            page
        );
        expect(saved).toMatchObject({
            characterTexture: "new",
            characterTextureIds: ["new"],
            aiModel: "openai/gpt-4o-mini",
            toolTimeoutSeconds: 180,
            maxReplyTokens: 8000,
            maxSteps: 10,
        });
    });

    it("leaves limits the bot never had as null", () => {
        const saved = botDataFromSave({ id: "b2", name: "Nora" } as BotData, { id: "b2", name: "Nora" } as BotData);
        expect(saved).toMatchObject({
            toolTimeoutSeconds: null,
            maxReplyTokens: null,
            maxSteps: null,
            behaviorType: "idle",
        });
    });
});
