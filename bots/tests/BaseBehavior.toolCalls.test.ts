import { afterEach, describe, expect, it, vi } from 'vitest';
import { BaseBehavior } from '../behaviors/BaseBehavior';
import type { BehaviorConfig } from '../behaviors/BaseBehavior';

class TestBehavior extends BaseBehavior {
    readonly send = vi.fn();
    readonly readSetting = vi.fn();
    constructor(config: BehaviorConfig = { type: 'idle' }) {
        super(config);
        this.bot = { sendStreamMessage: this.send } as unknown as NonNullable<typeof this.bot>;
        this.adminApiService = { getBotConfiguration: this.readSetting } as unknown as NonNullable<
            typeof this.adminApiService
        >;
        this.aiService = {
            isRestingLine: () => false,
            generateBotResponseStream: async function* () {
                yield await Promise.resolve({
                    reset: true,
                    toolNames: ['get_areas'],
                    toolSteps: [{ id: 'c1', doing: 'Get areas', done: 'Get areas', group: 'tool:get_areas' }],
                });
                yield { content: 'Here is a new answer.', done: true };
            },
        } as unknown as NonNullable<typeof this.aiService>;
        this.responseProcessor = {
            processResponse: () => ({ cleaned: 'Here is a new answer.', metrics: { repetitionScore: 0 } }),
        } as unknown as NonNullable<typeof this.responseProcessor>;
    }
    update(): void {}
    protected async generateAIResponseStream(): Promise<void> {}
    reply(botId: string, abortSignal?: AbortSignal) {
        return this.regenerateOnRepetition({
            botId,
            abortSignal,
            playerId: 1,
            playerMessage: 'Where can I read?',
            chatInstructions: 'Be helpful',
            aiProviderRef: 'deepseek',
            spaceName: 'same-room',
            context: '',
            processed: { cleaned: 'Old answer', metrics: { repetitionScore: 0.9 } } as Parameters<
                typeof this.regenerateOnRepetition
            >[0]['processed'],
            processedMessage: 'Old answer',
            fullMessage: 'Old answer',
            responseId: 'original',
            debugLabel: 'test',
        });
    }
}

/** What the bot sent as its steps line (#1545): the stream messages that carry the field. */
const stepsSent = (bot: TestBehavior) =>
    bot.send.mock.calls.filter((call) => call[8] !== undefined).map((call) => ({ text: call[4], isFinal: call[3], field: JSON.parse(call[8]) }));

afterEach(() => vi.unstubAllEnvs());
describe('per-bot steps line in the shared response path', () => {
    it.each(['true', 'false'])('two bots in one room remain independent of debug logs (%s)', async (debug) => {
        vi.stubEnv('ENABLE_BOT_DEBUG', debug);
        const on = new TestBehavior();
        const off = new TestBehavior();
        on.readSetting.mockResolvedValue({ behaviorConfig: { showToolCalls: true } });
        off.readSetting.mockResolvedValue({ behaviorConfig: { showToolCalls: false } });
        await Promise.all([on.reply('bot-on'), off.reply('bot-off')]);
        expect(on.readSetting).toHaveBeenCalledWith('bot-on', 2000);
        expect(off.readSetting).toHaveBeenCalledWith('bot-off', 2000);
        expect(stepsSent(on)).toEqual([
            { text: 'Get areas…', isFinal: false, field: expect.objectContaining({ state: 'working', line: 'Get areas' }) },
            { text: 'Get areas', isFinal: true, field: expect.objectContaining({ state: 'done', line: 'Get areas' }) },
        ]);
        expect(on.send.mock.calls.flat().some((value) => String(value).includes('🔍'))).toBe(false);
        expect(stepsSent(off)).toEqual([]);
        expect(off.send).toHaveBeenCalledWith('same-room', expect.any(String), 'Here is a new answer.', false);
    });
    it.each([{}, { showToolCalls: 'true' }, null])(
        'missing or malformed setting stays off (%j)',
        async (behaviorConfig) => {
            const bot = new TestBehavior({ type: 'idle', showToolCalls: true });
            bot.readSetting.mockResolvedValue({ behaviorConfig });
            await bot.reply('bot');
            expect(stepsSent(bot)).toEqual([]);
        }
    );
    it('reads the switch again when tools are used, including a running bot switched off', async () => {
        const bot = new TestBehavior();
        bot.readSetting
            .mockResolvedValueOnce({ behaviorConfig: { showToolCalls: true } })
            .mockResolvedValueOnce({ behaviorConfig: { showToolCalls: false } });
        await bot.reply('bot');
        bot.send.mockClear();
        await bot.reply('bot');
        expect(bot.readSetting).toHaveBeenCalledTimes(2);
        expect(stepsSent(bot)).toEqual([]);
    });
    it('a config read failure hides tools and preserves the answer', async () => {
        const bot = new TestBehavior();
        bot.readSetting.mockRejectedValue(new Error('Orbit unavailable'));
        await bot.reply('bot');
        expect(stepsSent(bot)).toEqual([]);
        expect(bot.send).toHaveBeenCalledWith('same-room', expect.any(String), 'Here is a new answer.', false);
    });
    it('does not resume a canceled reply after the settings read', async () => {
        const bot = new TestBehavior();
        let complete: (value: unknown) => void = () => {};
        bot.readSetting.mockImplementation(
            () =>
                new Promise((resolve) => {
                    complete = resolve;
                })
        );
        const controller = new AbortController();
        const reply = bot.reply('bot', controller.signal);
        await vi.waitFor(() => expect(bot.readSetting).toHaveBeenCalled());
        controller.abort();
        complete({ behaviorConfig: { showToolCalls: true } });
        await reply;
        expect(stepsSent(bot)).toEqual([]);
        expect(bot.send.mock.calls.flat().some((value) => String(value).includes('Here is a new answer.'))).toBe(false);
    });
    it('creates no setting requests or timers while idle', () => {
        const timer = vi.spyOn(globalThis, 'setInterval');
        const bot = new TestBehavior();
        expect(bot.readSetting).not.toHaveBeenCalled();
        expect(timer).not.toHaveBeenCalled();
        timer.mockRestore();
    });
});
