/**
 * Tests for BaseBehavior interruption routing — the mid-stream conversation
 * state machine (PR #352) and the review-fix invariants:
 *
 *  - cancel: aborts stream, clears queue + pending answers, acks the player
 *  - update: aborts stream, KEEPS acknowledged queued messages (fix), clears
 *    only pending one-shot answers, stores pendingUpdateMessage
 *  - answer: stores the one-shot answer, does not enqueue a duplicate
 *  - queue: enqueues FIFO, sends the LLM ack, capped at MAX_QUEUED_MESSAGES
 *  - finishGeneration: stale calls (generation advanced) are ignored
 *  - flushMessageQueue: does not drop a message when a generation is active
 *  - abortCurrentStream: finalizes the active bubble id, not a phantom one
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { BaseBehavior } from '../behaviors/BaseBehavior';
import type { BehaviorConfig } from '../behaviors/BaseBehavior';

class TestableBehavior extends BaseBehavior {
    constructor() {
        super({} as BehaviorConfig);
    }
    update(_deltaTime: number): void {}
    onChatMessage(): Promise<void> { return Promise.resolve(); }
    getConversationMemory(_playerId: number): any { return null; }
    generateAIResponseStream(): Promise<void> { return Promise.resolve(); }

    testStartGeneration(senderId: number, spaceName: string): void {
        this.startGeneration(senderId, spaceName);
    }
    testHandleInterruption(
        senderId: number,
        originalMessage: string,
        augmentedMessage: string
    ): Promise<'queued' | 'cancelled' | 'proceed'> {
        return this.handleInterruption(senderId, originalMessage, augmentedMessage);
    }
    testFinishGeneration(senderId: number, aborted: boolean, expectedGen?: number): void {
        this.finishGeneration(senderId, aborted, expectedGen);
    }
    testFlushMessageQueue(senderId: number): void {
        this.flushMessageQueue(senderId);
    }
    testAbortCurrentStream(senderId: number, finalContent?: string): void {
        this.abortCurrentStream(senderId, finalContent);
    }
    testTrackActiveResponseId(senderId: number, responseId: string): void {
        this.trackActiveResponseId(senderId, responseId);
    }
    testRegenerateOnRepetition(params: {
        botId: string;
        playerId: number;
        playerMessage: string;
        chatInstructions: string;
        aiProviderRef: string;
        spaceName: string;
        context: string;
        abortSignal?: AbortSignal;
        processed: any;
        processedMessage: string;
        fullMessage: string;
        responseTime?: number;
        tokenUsage?: { prompt: number; completion: number; total: number };
        responseId: string;
        debugLabel: string;
    }): Promise<{ processed: any; processedMessage: string; responseId: string }> {
        return this.regenerateOnRepetition(params);
    }
    getState(senderId: number): any {
        return (this as any).activeConversations.get(senderId);
    }
}

function createBotMock() {
    return {
        sendStreamMessage: vi.fn(),
        startTyping: vi.fn(),
        stopTyping: vi.fn(),
        getBotId: vi.fn(() => 'bot-1'),
        getFullConfig: vi.fn(() => ({
            aiProviderRef: 'provider-1',
            chatInstructions: 'You are a test bot.',
        })),
        // setBot() reads the bot's current position to seed movement tracking
        getState: vi.fn(() => ({ getPosition: () => ({ x: 0, y: 0 }) })),
    };
}

function createAiMock() {
    return {
        quickClassify: vi.fn(),
        quickGenerate: vi.fn(),
        generateBotResponseStream: vi.fn(),
    };
}

describe('BaseBehavior interruption routing', () => {
    let behavior: TestableBehavior;
    let bot: ReturnType<typeof createBotMock>;
    let ai: ReturnType<typeof createAiMock>;
    const SENDER = 42;
    const SPACE = 'test-space';

    beforeEach(() => {
        vi.clearAllMocks();
        behavior = new TestableBehavior();
        bot = createBotMock();
        ai = createAiMock();
        behavior.setBot(bot as any);
        behavior.setServices(ai as any, {} as any);
    });

    it('cancel: aborts the stream, clears queue/answers, and acks the player', async () => {
        behavior.testStartGeneration(SENDER, SPACE);
        ai.quickClassify.mockResolvedValueOnce({ action: 'cancel', message: 'stopping now' });

        const action = await behavior.testHandleInterruption(SENDER, 'stop', 'stop');

        expect(action).toBe('cancelled');
        const state = behavior.getState(SENDER);
        // finishGeneration on cancel nulls the controller — generation is done
        expect(state.abortController).toBeUndefined();
        expect(state.isGenerating).toBe(false);
        expect(state.messageQueue).toHaveLength(0);
        expect(state.pendingAnswers).toHaveLength(0);
        // abort finalize + cancel ack both go through sendStreamMessage
        const streamCalls = bot.sendStreamMessage.mock.calls;
        const ackCall = streamCalls.find((c: any[]) => c[4] === 'stopping now');
        expect(ackCall).toBeTruthy();
    });

    it('update: keeps acknowledged queued messages, drops only pending answers', async () => {
        behavior.testStartGeneration(SENDER, SPACE);
        ai.quickClassify
            .mockResolvedValueOnce({ action: 'queue', message: 'got it' })   // msg1 -> queue
            .mockResolvedValueOnce({ action: 'queue', message: 'got it' })   // msg2 -> queue
            .mockResolvedValueOnce({ action: 'update', message: 'changing' }); // correction

        await behavior.testHandleInterruption(SENDER, 'msg1', 'msg1');
        await behavior.testHandleInterruption(SENDER, 'msg2', 'msg2');
        const action = await behavior.testHandleInterruption(SENDER, 'wait make it a poem', 'wait make it a poem');

        expect(action).toBe('proceed');
        const state = behavior.getState(SENDER);
        // The two acknowledged messages are NOT discarded by the update (fix C3)
        expect(state.messageQueue).toHaveLength(2);
        expect(state.messageQueue[0].originalMessage).toBe('msg1');
        expect(state.messageQueue[1].originalMessage).toBe('msg2');
        expect(state.pendingAnswers).toHaveLength(0);
        expect(state.pendingUpdateMessage).toBe('changing');
    });

    it('answer: stores the one-shot answer instead of enqueueing a duplicate', async () => {
        behavior.testStartGeneration(SENDER, SPACE);
        ai.quickClassify.mockResolvedValueOnce({ action: 'answer', message: 'the quick answer' });

        const action = await behavior.testHandleInterruption(SENDER, 'is it raining?', 'is it raining?');

        expect(action).toBe('queued');
        const state = behavior.getState(SENDER);
        expect(state.pendingAnswers).toEqual(['the quick answer']);
        expect(state.messageQueue).toHaveLength(0);
    });

    it('queue: enqueues FIFO and sends the LLM acknowledgment', async () => {
        behavior.testStartGeneration(SENDER, SPACE);
        ai.quickClassify
            .mockResolvedValueOnce({ action: 'queue', message: 'one moment' })
            .mockResolvedValueOnce({ action: 'queue', message: 'one moment' });

        await behavior.testHandleInterruption(SENDER, 'first', 'first');
        await behavior.testHandleInterruption(SENDER, 'second', 'second');

        const state = behavior.getState(SENDER);
        expect(state.messageQueue.map((m: any) => m.originalMessage)).toEqual(['first', 'second']);
        const ackCalls = bot.sendStreamMessage.mock.calls.filter((c: any[]) => c[4] === 'one moment');
        expect(ackCalls).toHaveLength(2);
    });

    it('queue overflow: capped at MAX_QUEUED_MESSAGES with an overflow ack', async () => {
        behavior.testStartGeneration(SENDER, SPACE);
        ai.quickClassify.mockResolvedValue({ action: 'queue', message: 'one moment' });
        ai.quickGenerate.mockResolvedValue('lots of messages, one sec');

        for (let i = 0; i < 4; i++) {
            await behavior.testHandleInterruption(SENDER, `msg-${i}`, `msg-${i}`);
        }

        const state = behavior.getState(SENDER);
        expect(state.messageQueue).toHaveLength(3); // capped, 4th overflowed
        const overflowAck = bot.sendStreamMessage.mock.calls.find((c: any[]) => c[4] === 'lots of messages, one sec');
        expect(overflowAck).toBeTruthy();
    });

    it('finishGeneration: stale call from an aborted stream is ignored', () => {
        behavior.testStartGeneration(SENDER, SPACE); // generation = 1
        const state = behavior.getState(SENDER);
        state.generation = 2; // generation advanced (cancel/update path)

        behavior.testFinishGeneration(SENDER, false, 1); // stale .finally() with capturedGen=1

        // No-op: the stale call must not flip isGenerating back on
        expect(state.isGenerating).toBe(true);
        expect(state.abortController).toBeDefined();
    });

    it('flushMessageQueue: does not drop a queued message while generating (fix C2)', async () => {
        behavior.testStartGeneration(SENDER, SPACE);
        ai.quickClassify.mockResolvedValue({ action: 'queue', message: 'one moment' });
        // Enqueue one message via the interruption path — await completion so
        // the queue state is settled before asserting on it.
        await behavior.testHandleInterruption(SENDER, 'queued-msg', 'queued-msg');
        const state = behavior.getState(SENDER);
        expect(state.messageQueue).toHaveLength(1);

        behavior.testFlushMessageQueue(SENDER); // isGenerating still true

        // The message must still be there — the guard runs BEFORE shift
        expect(state.messageQueue).toHaveLength(1);
        expect(state.messageQueue[0].originalMessage).toBe('queued-msg');
    });

    it('abortCurrentStream: finalizes the active bubble id, not a phantom (fix C1)', () => {
        behavior.testStartGeneration(SENDER, SPACE);
        behavior.testTrackActiveResponseId(SENDER, 'resp-123');

        behavior.testAbortCurrentStream(SENDER, '');

        const state = behavior.getState(SENDER);
        expect(state.abortController.signal.aborted).toBe(true);
        const finalizeCall = bot.sendStreamMessage.mock.calls.find(
            (c: any[]) => c[0] === SPACE && c[1] === 'resp-123' && c[3] === true
        );
        expect(finalizeCall).toBeTruthy();
        // No phantom bubble with an 'abort-' prefixed id
        const phantom = bot.sendStreamMessage.mock.calls.find((c: any[]) => typeof c[1] === 'string' && c[1].includes('-abort-'));
        expect(phantom).toBeFalsy();
    });

    it('classify failure: falls back to queue instead of dropping the message', async () => {
        behavior.testStartGeneration(SENDER, SPACE);
        ai.quickClassify.mockRejectedValueOnce(new Error('provider down'));

        const action = await behavior.testHandleInterruption(SENDER, 'hello?', 'hello?');

        expect(action).toBe('queued');
        const state = behavior.getState(SENDER);
        expect(state.messageQueue).toHaveLength(1);
        expect(state.messageQueue[0].originalMessage).toBe('hello?');
    });

    it('regenerateOnRepetition: finalizes the ack as its own bubble on a tool-call reset (fix empty-bubble churn)', async () => {
        // Repetition score high enough to trigger the regeneration loop.
        const processed = {
            cleaned: 'repeated answer',
            metrics: { repetitionScore: 0.95 },
        };
        // Regenerated stream: ack text → tool-call reset → follow-up content → done.
        // The reset chunk previously sent a BLANK reset that wiped the ack on the
        // frontend. The fix finalizes the ack (isFinal=true) and rotates responseId.
        async function* regenStream() {
            yield { content: 'You are right to nudge me — let me dig in.', done: false };
            yield { content: '', done: false, reset: true, toolNames: ['list_issues'] };
            yield { content: 'Here is the real answer.', done: false };
            yield { content: '', done: true, metadata: { tokensUsed: 10, latency: 5, error: false } };
        }
        ai.generateBotResponseStream.mockImplementation(() => regenStream());
        // The regeneration re-checks repetition on the new content — return a low
        // score so the loop exits after one attempt.
        const mockResponseProcessor = {
            processResponse: vi.fn().mockReturnValue({
                cleaned: 'Here is the real answer.',
                metrics: { repetitionScore: 0.1 },
            }),
            clearRecentResponses: vi.fn(),
        };
        behavior.setServices(ai as any, {} as any, undefined, mockResponseProcessor as any);

        const result = await behavior.testRegenerateOnRepetition({
            botId: 'bot-1',
            playerId: SENDER,
            playerMessage: 'say it differently',
            chatInstructions: 'You are a test bot.',
            aiProviderRef: 'provider-1',
            spaceName: SPACE,
            context: '',
            processed,
            processedMessage: 'repeated answer',
            fullMessage: 'repeated answer',
            responseTime: 100,
            tokenUsage: { prompt: 10, completion: 10, total: 20 },
            responseId: 'resp-orig',
            debugLabel: 'TestBehavior',
        });

        const streamCalls = bot.sendStreamMessage.mock.calls;
        // 1) The ack is FINALIZED on the original responseId (isFinal=true, initialContent=ack)
        const finalizeCall = streamCalls.find(
            (c: any[]) => c[1] === 'resp-orig' && c[3] === true && (c[4] as string).includes('nudge me')
        );
        expect(finalizeCall).toBeTruthy();
        // 2) The ack is NOT wiped: no blank reset is sent AFTER the ack content
        //    streams. (The blank reset at the loop top — before regeneration —
        //    is the intentional duplicate-block; a reset AFTER the ack would be
        //    the old bug that cleared the just-streamed ack on the frontend.)
        const ackStreamIdx = streamCalls.findIndex(
            (c: any[]) => c[1] === 'resp-orig' && c[3] === false && (c[2] as string).includes('nudge me')
        );
        expect(ackStreamIdx).toBeGreaterThanOrEqual(0);
        const blankResetAfterAck = streamCalls.some(
            (c: any[], i: number) => i > ackStreamIdx && c[1] === 'resp-orig' && c[3] === false && c[7] === true
        );
        expect(blankResetAfterAck).toBe(false);
        // 3) The responseId rotated after the reset — follow-up content landed in a fresh bubble
        expect(result.responseId).not.toBe('resp-orig');
    });

    it('regenerateOnRepetition: generates the exhausted-attempts fallback via LLM (no hardcoded strings)', async () => {
        // Repetition stays high across ALL regeneration attempts → fallback path.
        const processed = {
            cleaned: 'repeated answer',
            metrics: { repetitionScore: 0.95 },
        };
        // Every regenerated response re-scores as repetitive → loop exhausts attempts.
        async function* stillRepetitiveStream() {
            yield { content: 'still repeating the same thing', done: false };
            yield { content: '', done: true, metadata: { tokensUsed: 10, latency: 5, error: false } };
        }
        ai.generateBotResponseStream.mockImplementation(() => stillRepetitiveStream());
        // quickGenerate supplies the LLM-generated fallback in the bot's voice.
        ai.quickGenerate.mockResolvedValue('Let me look at this from a completely different angle.');

        const mockResponseProcessor = {
            processResponse: vi.fn().mockReturnValue({
                cleaned: 'still repeating the same thing',
                metrics: { repetitionScore: 0.95 }, // stays repetitive
            }),
            clearRecentResponses: vi.fn(),
        };
        behavior.setServices(ai as any, {} as any, undefined, mockResponseProcessor as any);

        const result = await behavior.testRegenerateOnRepetition({
            botId: 'bot-1',
            playerId: SENDER,
            playerMessage: 'say it differently',
            chatInstructions: 'You are a test bot.',
            aiProviderRef: 'provider-1',
            spaceName: SPACE,
            context: '',
            processed,
            processedMessage: 'repeated answer',
            fullMessage: 'repeated answer',
            responseTime: 100,
            tokenUsage: { prompt: 10, completion: 10, total: 20 },
            responseId: 'resp-orig',
            debugLabel: 'TestBehavior',
        });

        // The LLM-generated fallback was used — NOT one of the old hardcoded phrases.
        expect(result.processedMessage).toBe('Let me look at this from a completely different angle.');
        // The repetition cycle was cleared so the next turn starts fresh.
        expect(mockResponseProcessor.clearRecentResponses).toHaveBeenCalledWith('bot-1', SENDER);
        // quickGenerate received the persona chat instructions as its system prompt.
        expect(ai.quickGenerate).toHaveBeenCalledWith('provider-1', 'You are a test bot.', expect.any(String));
    });

    it('regenerateOnRepetition: stays silent (empty message) when the LLM fallback also fails', async () => {
        const processed = {
            cleaned: 'repeated answer',
            metrics: { repetitionScore: 0.95 },
        };
        async function* stillRepetitiveStream() {
            yield { content: 'still repeating the same thing', done: false };
            yield { content: '', done: true, metadata: { tokensUsed: 10, latency: 5, error: false } };
        }
        ai.generateBotResponseStream.mockImplementation(() => stillRepetitiveStream());
        // Provider unavailable → quickGenerate returns '' (runBoundedProviderCall contract).
        ai.quickGenerate.mockResolvedValue('');

        const mockResponseProcessor = {
            processResponse: vi.fn().mockReturnValue({
                cleaned: 'still repeating the same thing',
                metrics: { repetitionScore: 0.95 },
            }),
            clearRecentResponses: vi.fn(),
        };
        behavior.setServices(ai as any, {} as any, undefined, mockResponseProcessor as any);

        const result = await behavior.testRegenerateOnRepetition({
            botId: 'bot-1',
            playerId: SENDER,
            playerMessage: 'say it differently',
            chatInstructions: 'You are a test bot.',
            aiProviderRef: 'provider-1',
            spaceName: SPACE,
            context: '',
            processed,
            processedMessage: 'repeated answer',
            fullMessage: 'repeated answer',
            responseTime: 100,
            tokenUsage: { prompt: 10, completion: 10, total: 20 },
            responseId: 'resp-orig',
            debugLabel: 'TestBehavior',
        });

        // Empty message → the caller's empty-final guard drops the bubble; the
        // stale repeated text is NOT sent.
        expect(result.processedMessage).toBe('');
    });
});
