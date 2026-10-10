import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseBehavior } from '../behaviors/BaseBehavior';

class TestableBehavior extends BaseBehavior {
    constructor() {
        super({} as any);
    }
    public onInit(): void {}
    public onTick(): void {}
    public onMessage(): void {}
    public onPlayerJoin(): void {}
    public onPlayerLeave(): void {}

    public callSendAreaArrivalMessage(
        areaName: string,
        followers: Array<{ userId: number; name?: string; position: { x: number; y: number } }>
    ) {
        return this.sendAreaArrivalMessage(areaName, followers);
    }

    public callSendPersonArrivalMessage(
        personName: string,
        followers: Array<{ userId: number; name?: string; position: { x: number; y: number } }>
    ) {
        return this.sendPersonArrivalMessage(personName, followers);
    }
}

describe('BaseBehavior arrival messages', () => {
    let behavior: TestableBehavior;
    let mockBot: any;
    let mockAiService: any;
    let mockConversationMemory: any;

    beforeEach(() => {
        behavior = new TestableBehavior();

        mockBot = {
            getBotId: vi.fn(() => 'bot-1'),
            getState: vi.fn(() => ({ getPosition: () => ({ x: 0, y: 0 }) })),
            getCurrentSpaces: vi.fn(() => ['space#123']),
            getFullConfig: vi.fn(() => ({
                aiProviderRef: 'provider-123',
                chatInstructions: 'Custom instructions',
            })),
            getNearbyPlayers: vi.fn(() => [{ userId: 42, name: 'Alice' }]),
            startTyping: vi.fn(),
            stopTyping: vi.fn(),
            sendStreamMessage: vi.fn(),
            leaveAllSpaces: vi.fn().mockResolvedValue(undefined),
        };

        mockAiService = {
            generateBotResponseStream: vi.fn(async function* () {
                yield { content: 'Here we are! ' };
                yield {
                    content:
                        'Hope you enjoy it.[EMOTION_UPDATE]\n{"personSentiment": 1, "isInsult": false, "insultSeverity": 0, "context": "friendly"}\n[/EMOTION_UPDATE]',
                };
                yield { done: true };
            }),
        };

        mockConversationMemory = {
            getConversationContext: vi.fn(() => 'prev context'),
            updateEmotionsFromAI: vi.fn(),
            addMessage: vi.fn(),
        };

        behavior.setBot(mockBot);
        behavior.setServices(
            mockAiService,
            {} as any,
            null,
            null,
            null
        );
        behavior.setConversationMemory(mockConversationMemory);
    });

    it('returns immediately if bot or aiService is missing', async () => {
        const b = new TestableBehavior();
        await b.callSendAreaArrivalMessage('Library', [{ userId: 42, position: { x: 0, y: 0 } }]);
        expect(mockAiService.generateBotResponseStream).not.toHaveBeenCalled();
    });

    it('returns immediately if followers array is empty', async () => {
        await behavior.callSendAreaArrivalMessage('Library', []);
        expect(mockAiService.generateBotResponseStream).not.toHaveBeenCalled();
    });

    it('skips message if no follower is nearby', async () => {
        mockBot.getNearbyPlayers.mockReturnValue([]);
        await behavior.callSendAreaArrivalMessage('Library', [{ userId: 42, position: { x: 0, y: 0 } }]);
        expect(mockAiService.generateBotResponseStream).not.toHaveBeenCalled();
        expect(mockBot.leaveAllSpaces).not.toHaveBeenCalled();
    });

    it('streams area arrival message and updates memory and leaves spaces', async () => {
        await behavior.callSendAreaArrivalMessage('Library', [{ userId: 42, position: { x: 0, y: 0 } }]);

        expect(mockBot.startTyping).toHaveBeenCalledWith('space#123');
        expect(mockAiService.generateBotResponseStream).toHaveBeenCalledWith(
            'bot-1',
            42,
            expect.stringContaining("to the Library area. Let them know you've arrived at the destination"),
            'Custom instructions',
            'provider-123',
            'space#123',
            'prev context',
            mockBot,
            {}
        );

        // Final message delivery
        expect(mockBot.sendStreamMessage).toHaveBeenCalledWith(
            'space#123',
            expect.stringContaining('bot-bot-1-player-42-'),
            '',
            true,
            'Here we are! Hope you enjoy it.'
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
            'Here we are! Hope you enjoy it.',
            'bot',
            'space#123'
        );

        // Cleanup
        expect(mockBot.stopTyping).toHaveBeenCalledWith('space#123');
        expect(mockBot.leaveAllSpaces).toHaveBeenCalled();
    });

    it('streams person arrival message with appropriate prompt', async () => {
        await behavior.callSendPersonArrivalMessage('Bob', [{ userId: 42, position: { x: 0, y: 0 } }]);

        expect(mockAiService.generateBotResponseStream).toHaveBeenCalledWith(
            'bot-1',
            42,
            expect.stringContaining("to Bob. Let them know you've arrived"),
            'Custom instructions',
            'provider-123',
            'space#123',
            'prev context',
            mockBot,
            {}
        );

        expect(mockBot.stopTyping).toHaveBeenCalledWith('space#123');
        expect(mockBot.leaveAllSpaces).toHaveBeenCalled();
    });

    it('handles AI stream errors gracefully and cleans up state', async () => {
        mockAiService.generateBotResponseStream = vi.fn(async function* () {
            throw new Error('AI stream exploded');
        });

        await behavior.callSendAreaArrivalMessage('Garden', [{ userId: 42, position: { x: 0, y: 0 } }]);

        // Error message sent to close stream
        expect(mockBot.sendStreamMessage).toHaveBeenCalledWith(
            'space#123',
            expect.any(String),
            '',
            true,
            ''
        );
        expect(mockBot.stopTyping).toHaveBeenCalledWith('space#123');
        expect(mockBot.leaveAllSpaces).toHaveBeenCalled();
    });
});
