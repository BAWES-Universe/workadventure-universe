import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseBehavior, BehaviorConfig } from '../behaviors/BaseBehavior';

class TestableBehavior extends BaseBehavior {
    public returnAfterLeadingCalled = false;

    constructor() {
        super({} as BehaviorConfig);
    }
    update(_deltaTime: number): void {}
    onChatMessage(): Promise<void> { return Promise.resolve(); }
    getConversationMemory(_playerId: number): any { return null; }
    generateAIResponseStream(): Promise<void> { return Promise.resolve(); }

    protected override returnAfterLeading(): void {
        this.returnAfterLeadingCalled = true;
    }

    public callSendGoodbyeAndReturn(
        spaceName: string,
        playerId: number,
        botId: string,
        destinationType: 'person' | 'area'
    ): Promise<void> {
        return this.sendGoodbyeAndReturn(spaceName, playerId, botId, destinationType);
    }

    public setBot(bot: any): void {
        this.bot = bot;
    }
}

describe('BaseBehavior sendGoodbyeAndReturn', () => {
    let behavior: TestableBehavior;
    let mockBot: any;
    let mockAiService: any;
    let mockConversationMemory: any;
    let mockConversationStorage: any;

    beforeEach(() => {
        behavior = new TestableBehavior();

        mockBot = {
            getFullConfig: vi.fn(() => ({
                aiProviderRef: 'provider-123',
                chatInstructions: 'Custom instructions',
            })),
            sendStreamMessage: vi.fn(),
            getState: vi.fn(() => ({
                getPosition: () => ({ x: 0, y: 0 }),
            })),
        };

        mockAiService = {
            generateBotResponseStream: vi.fn(async function* () {
                yield { content: 'Goodbye! ' };
                yield { content: 'It was great talking to you.[EMOTION_UPDATE]\n{"personSentiment": 1, "isInsult": false, "insultSeverity": 0, "context": "friendly"}\n[/EMOTION_UPDATE]' };
                yield { done: true };
            }),
        };

        mockConversationMemory = {
            getConversationContext: vi.fn(() => 'prev context'),
            updateEmotionsFromAI: vi.fn(),
            addMessage: vi.fn(),
        };

        mockConversationStorage = {
            addMessage: vi.fn().mockResolvedValue(undefined),
        };

        behavior.setBot(mockBot);
        behavior.setServices(
            mockAiService,
            {} as any,
            mockConversationStorage,
            null,
            null
        );
        behavior.setConversationMemory(mockConversationMemory);
    });

    it('returns immediately if bot or aiService is missing', async () => {
        const noBotBehavior = new TestableBehavior();
        await noBotBehavior.callSendGoodbyeAndReturn('space-1', 42, 'bot-1', 'person');
        expect(noBotBehavior.returnAfterLeadingCalled).toBe(true);
    });

    it('returns immediately if botConfig has no aiProviderRef', async () => {
        mockBot.getFullConfig.mockReturnValue(null);
        await behavior.callSendGoodbyeAndReturn('space-1', 42, 'bot-1', 'person');
        expect(behavior.returnAfterLeadingCalled).toBe(true);
        expect(mockAiService.generateBotResponseStream).not.toHaveBeenCalled();
    });

    it('generates goodbye stream with destination prompt and delivers to client', async () => {
        await behavior.callSendGoodbyeAndReturn('space-1', 42, 'bot-1', 'person');

        expect(mockAiService.generateBotResponseStream).toHaveBeenCalledWith(
            'bot-1',
            42,
            "You've arrived at this person. It was nice talking to them. Say goodbye and that you'll see them soon.",
            'Custom instructions',
            'provider-123',
            'space-1',
            'prev context',
            mockBot,
            {}
        );

        // Final cleaned message delivered
        expect(mockBot.sendStreamMessage).toHaveBeenCalledWith(
            'space-1',
            expect.stringContaining('bot-bot-1-player-42-'),
            '',
            true,
            'Goodbye! It was great talking to you.'
        );

        // Memory updated
        expect(mockConversationMemory.updateEmotionsFromAI).toHaveBeenCalledWith(
            'bot-1',
            42,
            expect.objectContaining({ personSentiment: 1 })
        );
        expect(mockConversationMemory.addMessage).toHaveBeenCalledWith(
            'bot-1',
            42,
            'Goodbye! It was great talking to you.',
            'bot',
            'space-1'
        );

        // returnAfterLeading called at end
        expect(behavior.returnAfterLeadingCalled).toBe(true);
    });

    it('handles destinationType = area correctly', async () => {
        await behavior.callSendGoodbyeAndReturn('space-1', 42, 'bot-1', 'area');

        expect(mockAiService.generateBotResponseStream).toHaveBeenCalledWith(
            'bot-1',
            42,
            "You've arrived at the destination. It was nice talking to them. Say goodbye and that you'll see them soon.",
            expect.any(String),
            expect.any(String),
            expect.any(String),
            expect.any(String),
            mockBot,
            expect.any(Object)
        );
    });

    it('calls returnAfterLeading even if aiService throws an error', async () => {
        mockAiService.generateBotResponseStream = vi.fn(async function* () {
            throw new Error('AI service stream failure');
        });

        await behavior.callSendGoodbyeAndReturn('space-1', 42, 'bot-1', 'person');
        expect(behavior.returnAfterLeadingCalled).toBe(true);
        expect(mockBot.sendStreamMessage).toHaveBeenCalledWith(
            'space-1',
            expect.any(String),
            '',
            true,
            ''
        );
    });
});
