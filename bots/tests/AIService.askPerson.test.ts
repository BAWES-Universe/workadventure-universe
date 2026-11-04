/**
 * The question card as AIService uses it (game #1661): the model is offered ask_person only when the bot's setting and the
 * person allow it, a call shows the card in the right chat, and what the person types or says while it waits answers it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIService } from '../ai/AIService';
import { DEFAULT_CARD_SETTINGS, type CardSettings } from '../mcp/OrbitActions';

vi.mock('../client/BotClient', () => ({ BotClient: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

const choices = [{ label: 'Upbeat pop', line: '3 tracks' }, { label: 'Lo-fi' }];

function serviceWith(settings: Partial<CardSettings> = {}, options: { questions?: boolean; memory?: boolean } = {}) {
    const service = new AIService(
        options.memory === false ? (null as never) : ({ getMemory: () => ({ userUuid: 'u-1', dmRoomId: '!room:chat', playerName: 'Nora' }) } as never),
        null!,
        ''
    );
    const askQuestion = vi.fn(async () => ({ kind: 'waiting' as const, result: { status: 'waiting_for_answer' }, line: undefined as string | undefined }));
    const answerQuestionByMessage = vi.fn(async () => false);
    const approvals = {
        asksQuestions: options.questions !== false,
        settings: async () => ({ ...DEFAULT_CARD_SETTINGS, ...settings }),
        askQuestion,
        answerQuestionByMessage,
        touch: () => undefined,
        waitingLabel: () => undefined,
        onPersonMessage: async () => undefined,
    };
    service.useApprovals(approvals as never);
    return { service, askQuestion, answerQuestionByMessage };
}

const names = (tools: Array<{ function: { name: string } }>) => tools.map((tool) => tool.function.name);
const offered = async (service: AIService, asking: { signedIn: boolean; identifier?: string }, channel: 'dm' | 'world' = 'dm', botClient?: unknown) =>
    names((await service['buildTools']('b1', botClient as never, undefined, channel, undefined, asking as never)).tools);

describe('is ask_person offered', () => {
    it('yes, to a signed-in person in a direct message, with the setting on Rarely', async () => {
        const { service } = serviceWith();
        expect(await offered(service, { signedIn: true, identifier: 'u-1' })).toContain('ask_person');
    });

    it('yes, in a bubble too', async () => {
        const { service } = serviceWith();
        expect(await offered(service, { signedIn: true, identifier: 'u-1' }, 'world', { getAllPeople: () => [] })).toContain('ask_person');
    });

    it('yes, with the setting on Before bigger jobs, and it says so to the model', async () => {
        const { service } = serviceWith({ askWhichWay: 'beforeBiggerJobs' });
        const { tools } = await service['buildTools']('b1', undefined, undefined, 'dm', undefined, { signedIn: true, identifier: 'u-1' });
        const tool = tools.find((t: { function: { name: string } }) => t.function.name === 'ask_person');
        expect(tool.function.description).toContain('before a bigger job');
    });

    it('no, with the setting on Never', async () => {
        const { service } = serviceWith({ askWhichWay: 'never' });
        expect(await offered(service, { signedIn: true, identifier: 'u-1' })).not.toContain('ask_person');
    });

    it('no, to a guest (a guest has no cards) or without who is asking', async () => {
        const { service } = serviceWith();
        expect(await offered(service, { signedIn: false })).not.toContain('ask_person');
        expect(await offered(service, undefined as never)).not.toContain('ask_person');
    });

    it('no, when question cards are not set up here', async () => {
        const { service } = serviceWith({}, { questions: false });
        expect(await offered(service, { signedIn: true, identifier: 'u-1' })).not.toContain('ask_person');
    });
});

describe('a call to ask_person', () => {
    const call = (service: AIService, args: object, botClient?: unknown, spaceName?: string) =>
        service['executeToolCalls']([{ id: 'c1', name: 'ask_person', arguments: JSON.stringify(args) }], botClient as never, undefined, new Map(), undefined, spaceName, 'b1', 7);

    it('shows the card in the direct message of the person who asked', async () => {
        const { service, askQuestion } = serviceWith();
        const [result] = await call(service, { question: 'Which style?', choices, before: 'make the music' });
        expect(result.result).toEqual({ status: 'waiting_for_answer' });
        expect(askQuestion).toHaveBeenCalledWith({
            botId: 'b1',
            roomId: '!room:chat',
            person: { uuid: 'u-1', name: 'Nora' },
            asked: expect.objectContaining({ question: 'Which style?', multiple: false, before: 'make the music' }),
        });
    });

    it('in a bubble shows it to the person alone and carries the one line everyone reads', async () => {
        const { service, askQuestion } = serviceWith({}, { memory: false });
        askQuestion.mockResolvedValue({ kind: 'waiting', result: { status: 'waiting_for_answer' }, line: 'Nora, I need your pick before I make the music.' });
        const botClient = { getPersonForArtifacts: () => ({ signedIn: true, identifier: 'u-1', name: 'Nora' }), isVoiceBot: () => false };
        const [result] = await call(service, { question: 'Which style?', choices }, botClient, 'space1');
        expect(askQuestion).toHaveBeenCalledWith(expect.objectContaining({ roomId: 'space1', person: { uuid: 'u-1', name: 'Nora', playerId: 7 } }));
        expect(result.result.sharedLine).toBe('Nora, I need your pick before I make the music.');
    });

    it('is turned down for a card that is not a card, so the bot asks in words', async () => {
        const { service, askQuestion } = serviceWith();
        const [result] = await call(service, { question: 'Which style?', choices: [{ label: 'Only one' }] });
        expect(askQuestion).not.toHaveBeenCalled();
        expect(result.result.error).toContain('2 to 4 choices');
    });

    it('is turned down when the setting says Never, even if the model calls it anyway', async () => {
        const { service, askQuestion } = serviceWith({ askWhichWay: 'never' });
        const [result] = await call(service, { question: 'Which style?', choices });
        expect(askQuestion).not.toHaveBeenCalled();
        expect(result.result.error).toContain('not to ask');
    });

    it('is turned down for a guest', async () => {
        const { service, askQuestion } = serviceWith({}, { memory: false });
        const guest = { getPersonForArtifacts: () => ({ signedIn: false, identifier: null, name: null }) };
        const [result] = await call(service, { question: 'Which style?', choices }, guest, 'space1');
        expect(askQuestion).not.toHaveBeenCalled();
        expect(result.result.error).toContain('in words');
    });
});

describe('typing or saying something while the card waits', () => {
    const botClient = (spoken: boolean) => ({ getPersonForArtifacts: () => ({ signedIn: true, identifier: 'u-1', name: 'Nora' }), takeSpoken: () => spoken });

    it('answers it by typing, and the turn goes on', async () => {
        const { service, answerQuestionByMessage } = serviceWith();
        const over = await service['whileCardWaits']('b1', 7, 'something jazzy', 'p1', 'space1', botClient(false) as never);
        expect(over).toBe(false);
        expect(answerQuestionByMessage).toHaveBeenCalledWith('b1', 'space1', { uuid: 'u-1', name: 'Nora', playerId: 7 }, 'typed');
    });

    it('answers it out loud when it was said to a voice bot', async () => {
        const { service, answerQuestionByMessage } = serviceWith();
        await service['whileCardWaits']('b1', 7, 'something jazzy', 'p1', 'space1', botClient(true) as never);
        expect(answerQuestionByMessage).toHaveBeenCalledWith('b1', 'space1', expect.anything(), 'spoken');
    });
});
