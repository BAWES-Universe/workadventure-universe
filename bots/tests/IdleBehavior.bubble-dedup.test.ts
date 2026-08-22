/**
 * Bug 3: Greeting + follow-up must NOT double-send as separate messages.
 *
 * When the AI stream emits a tool-call reset, the behavior previously
 * FINALIZED the pre-tool filler ("One moment — my thinking is hiccuping") as
 * its own standalone message and ROTATED to a fresh responseId for the
 * follow-up — the frontend then rendered TWO bubbles from one turn.
 *
 * Desired: the reset CLEARS the pre-tool filler (isFinal=false, reset=true)
 * and the follow-up answer streams into the SAME bubble → one coherent
 * response per turn.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IdleBehavior } from "../behaviors/IdleBehavior";

// Expose the protected stream method so the test can drive it directly.
class TestableIdleBehavior extends IdleBehavior {
    constructor() {
        super({
            type: "idle",
            responseRadius: 64,
            greetingMessages: [],
            idleAnimations: [],
        } as any);
    }

    public async testGenerateAIResponseStream(
        spaceName: string,
        playerId: number,
        playerMessage: string,
        botId: string,
        abortSignal?: AbortSignal
    ): Promise<void> {
        return this.generateAIResponseStream(spaceName, playerId, playerMessage, botId, abortSignal);
    }
}

function createBotMock() {
    return {
        sendStreamMessage: vi.fn(),
        startTyping: vi.fn(),
        stopTyping: vi.fn(),
        getFullConfig: vi.fn(() => ({
            aiProviderRef: "provider-1",
            chatInstructions: "You are a test bot.",
        })),
        // setBot() reads the bot's current position to seed movement tracking
        getState: vi.fn(() => ({ getPosition: () => ({ x: 0, y: 0 }) })),
    };
}

function createAiMock() {
    return {
        generateBotResponseStream: vi.fn(),
    };
}

describe("IdleBehavior – no greeting+follow-up double-send on stream reset", () => {
    let behavior: TestableIdleBehavior;
    let bot: ReturnType<typeof createBotMock>;
    let ai: ReturnType<typeof createAiMock>;

    beforeEach(() => {
        vi.clearAllMocks();
        behavior = new TestableIdleBehavior();
        bot = createBotMock();
        ai = createAiMock();
        behavior.setBot(bot as any);
        behavior.setServices(ai as any, {} as any);
    });

    afterEach(() => {
        vi.resetModules();
    });

    it("clears pre-tool filler on reset and streams the follow-up into the SAME bubble (one coherent message)", async () => {
        // Pre-tool greeting/filler → tool-call reset → follow-up answer → done.
        async function* streamWithReset() {
            yield { content: "One moment — my thinking is hiccuping", done: false };
            yield { content: "", done: false, reset: true, toolNames: [] };
            yield { content: "Here is your actual answer.", done: false };
            yield { content: "", done: true, metadata: { tokensUsed: 10, latency: 5, error: false } };
        }
        ai.generateBotResponseStream.mockImplementationOnce(streamWithReset);

        await behavior.testGenerateAIResponseStream("space-1", 42, "hello", "bot-1");

        const calls = bot.sendStreamMessage.mock.calls as any[][];

        // 1) The pre-tool filler is CLEARED via a non-final reset — never
        //    finalized as its own message.
        const resetCalls = calls.filter((c) => c[7] === true);
        expect(resetCalls).toHaveLength(1);
        expect(resetCalls[0][3]).toBe(false); // isFinal=false → clear, not close

        // 2) No message is ever finalized containing the model's pre-tool narration.
        const finalized = calls.filter((c) => c[3] === true);
        expect(finalized.some((c) => String(c[4]).includes("hiccuping"))).toBe(false);

        // 3) Exactly ONE coherent final message — the actual answer.
        expect(finalized).toHaveLength(1);
        expect(String(finalized[0][4])).toContain("Here is your actual answer.");

        // 4) The answer streamed into the SAME bubble as the cleared filler:
        //    a single responseId across all streamed content.
        const streamedIds = new Set(
            calls.filter((c) => !c[3] && c[2] && c[7] !== true).map((c) => c[1])
        );
        expect(streamedIds.size).toBe(1);
        expect(finalized[0][1]).toBe([...streamedIds][0]);
    });

    it("finalizes an empty pre-tool stream cleanly with no phantom reset (model went straight to tools)", async () => {
        async function* toolCallOnlyStream() {
            yield { content: "", done: false, reset: true, toolNames: [] };
            yield { content: "Here is the answer.", done: false };
            yield { content: "", done: true, metadata: { tokensUsed: 10, latency: 5, error: false } };
        }
        ai.generateBotResponseStream.mockImplementationOnce(toolCallOnlyStream);

        await behavior.testGenerateAIResponseStream("space-1", 42, "hello", "bot-1");

        const calls = bot.sendStreamMessage.mock.calls as any[][];
        // No reset-clear needed when there was no filler to clear.
        expect(calls.filter((c) => c[7] === true)).toHaveLength(0);
        // One final message with the answer.
        const finalized = calls.filter((c) => c[3] === true);
        expect(finalized).toHaveLength(1);
        expect(String(finalized[0][4])).toContain("Here is the answer.");
    });
});
