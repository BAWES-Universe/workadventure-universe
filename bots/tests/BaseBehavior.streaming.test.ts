import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseBehavior } from '../behaviors/BaseBehavior';
import { SocialBehavior } from '../behaviors/SocialBehavior';
import { IdleBehavior } from '../behaviors/IdleBehavior';
import { PatrolBehavior } from '../behaviors/PatrolBehavior';
import type { BehaviorConfig } from '../behaviors/BaseBehavior';

class StreamingTestBehavior extends BaseBehavior {
    constructor() {
        super({} as BehaviorConfig);
    }
    update(_deltaTime: number): void {}
    onChatMessage(): Promise<void> { return Promise.resolve(); }
    getConversationMemory(_playerId: number): any { return null; }

    public setBot(bot: any): void {
        this.bot = bot;
    }
    public setAiService(ai: any): void {
        this.aiService = ai;
    }
    public setConversationMemory(mem: any): void {
        this.conversationMemory = mem;
    }
    public setConversationStorage(store: any): void {
        this.conversationStorage = store;
    }

    public runGenerateAIResponseStream(
        spaceName: string,
        playerId: number,
        playerMessage: string,
        botId: string,
        abortSignal?: AbortSignal,
        images?: string[]
    ): Promise<void> {
        return this.generateAIResponseStream(spaceName, playerId, playerMessage, botId, abortSignal, images);
    }
}

describe('BaseBehavior.generateAIResponseStream', () => {
    let behavior: StreamingTestBehavior;
    let mockBot: any;
    let mockAiService: any;
    let mockMemory: any;

    beforeEach(() => {
        behavior = new StreamingTestBehavior();
        mockBot = {
            getFullConfig: vi.fn().mockReturnValue({
                botId: 'bot-1',
                name: 'TestBot',
                aiProviderRef: 'provider-1',
                chatInstructions: 'Custom instructions',
            }),
            sendStreamMessage: vi.fn(),
            stopTyping: vi.fn(),
            getState: vi.fn().mockReturnValue({
                getPosition: () => ({ x: 10, y: 20 }),
            }),
        };
        mockAiService = {
            generateBotResponseStream: vi.fn(),
        };
        mockMemory = {
            getConversationContext: vi.fn().mockReturnValue(''),
            updateEmotionsFromAI: vi.fn(),
            addMessage: vi.fn(),
        };
        behavior.setBot(mockBot);
        behavior.setAiService(mockAiService);
        behavior.setConversationMemory(mockMemory);
    });

    it('streams chunks, strips emotion blocks, and finalizes with clean text', async () => {
        async function* streamGenerator() {
            yield { content: 'Hello ' };
            yield { content: 'world! ' };
            yield { content: '[EMOTION_UPDATE] {"personSentiment": 0.5} [/EMOTION_UPDATE]' };
            yield { done: true, metadata: { tokensUsed: 42, latency: 150 } };
        }
        mockAiService.generateBotResponseStream.mockImplementation(streamGenerator);

        await behavior.runGenerateAIResponseStream('space-1', 123, 'Hi bot', 'bot-1');

        expect(mockBot.sendStreamMessage).toHaveBeenCalledWith('space-1', expect.any(String), 'Hello ', false);
        expect(mockBot.sendStreamMessage).toHaveBeenCalledWith('space-1', expect.any(String), 'world! ', false);
        expect(mockBot.sendStreamMessage).not.toHaveBeenCalledWith('space-1', expect.any(String), expect.stringContaining('[EMOTION_UPDATE]'), false);
        expect(mockBot.sendStreamMessage).toHaveBeenCalledWith('space-1', expect.any(String), '', true, 'Hello world!');
        expect(mockMemory.updateEmotionsFromAI).toHaveBeenCalledWith('bot-1', 123, expect.objectContaining({ personSentiment: 0.5 }));
        expect(mockMemory.addMessage).toHaveBeenCalledWith('bot-1', 123, 'Hello world!', 'bot', 'space-1');
        expect(mockBot.stopTyping).toHaveBeenCalledWith('space-1');
    });

    it('handles tool-call resets cleanly', async () => {
        async function* streamWithReset() {
            yield { content: 'Let me think...' };
            yield { reset: true, toolNames: ['search'] };
            yield { content: 'Here is the result.' };
            yield { done: true };
        }
        mockAiService.generateBotResponseStream.mockImplementation(streamWithReset);

        await behavior.runGenerateAIResponseStream('space-1', 123, 'Search query', 'bot-1');

        expect(mockBot.sendStreamMessage).toHaveBeenCalledWith('space-1', expect.any(String), 'Let me think...', false);
        expect(mockBot.sendStreamMessage).toHaveBeenCalledWith('space-1', expect.any(String), '', true, 'Let me think...');
        expect(mockBot.sendStreamMessage).toHaveBeenCalledWith('space-1', expect.any(String), '', true, 'Here is the result.');
    });

    it('handles AI error by stopping typing and sending friendly error bubble', async () => {
        mockAiService.generateBotResponseStream.mockImplementation(async function* () {
            throw new Error('LLM connection timed out');
        });

        await behavior.runGenerateAIResponseStream('space-1', 123, 'Trigger error', 'bot-1');

        expect(mockBot.stopTyping).toHaveBeenCalledWith('space-1');
        expect(mockBot.sendStreamMessage).toHaveBeenCalledWith(
            'space-1',
            expect.any(String),
            '',
            false,
            '',
            true,
            "I'm having trouble processing that. Could you rephrase?"
        );
    });

    it('suppresses error bubble when aborted mid-stream', async () => {
        const controller = new AbortController();
        controller.abort();

        mockAiService.generateBotResponseStream.mockImplementation(async function* () {
            throw new Error('AbortError');
        });

        await behavior.runGenerateAIResponseStream('space-1', 123, 'Cancelled', 'bot-1', controller.signal);

        expect(mockBot.sendStreamMessage).not.toHaveBeenCalledWith(
            'space-1',
            expect.any(String),
            '',
            false,
            '',
            true,
            expect.any(String)
        );
    });

    it('verifies defaultChatInstructions behavior hierarchy', () => {
        const base = new StreamingTestBehavior();
        const social = new SocialBehavior({} as any);
        const idle = new IdleBehavior({} as any);
        const patrol = new PatrolBehavior({ waypoints: [] } as any);

        expect((base as any).getDefaultChatInstructions()).toBe('You are a helpful bot.');
        expect((social as any).getDefaultChatInstructions()).toBe('You are a friendly bot.');
        expect((idle as any).getDefaultChatInstructions()).toBe('You are a helpful bot.');
        expect((patrol as any).getDefaultChatInstructions()).toBe('You are a helpful bot.');
    });
});
