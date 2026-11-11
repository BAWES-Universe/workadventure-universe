/**
 * Private answers in a group (game #1993). With other people in the bubble or meeting room, the reply everyone reads is
 * built without what they were not there for, so what the model is given holds nothing private. When the answer needs
 * it, a second answer goes to its person alone and everyone else reads one fixed line. These tests look at what the
 * model was given and at what each side receives.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
    span: { end: vi.fn(), setAttribute: vi.fn(), spanContext: vi.fn(() => ({ spanId: 's', traceId: 't' })) },
    generateStream: vi.fn(),
    captureAiGeneration: vi.fn(),
    captureAiTrace: vi.fn(),
    axios: { get: vi.fn(), post: vi.fn(), put: vi.fn(), isAxiosError: (e: any) => !!e?.isAxiosError },
}));

vi.mock('@sentry/node', () => ({
    startSpanManual: vi.fn((_opts: unknown, callback: (span: any) => any) => callback(hoisted.span)),
    startInactiveSpan: vi.fn(),
    getCurrentScope: vi.fn(() => ({ setConversationId: vi.fn() })),
    getActiveSpan: vi.fn(() => null),
    setConversationId: vi.fn(),
    captureException: vi.fn(),
}));
vi.mock('@sentry/core', () => ({ _INTERNAL_setSpanForScope: vi.fn() }));
vi.mock('../ai/PostHogClient', () => ({
    captureAiGeneration: hoisted.captureAiGeneration,
    captureAiTrace: hoisted.captureAiTrace,
    flushPostHog: vi.fn(async () => {}),
}));
vi.mock('../ai/encryption', () => ({ decryptApiKey: vi.fn(() => 'decrypted-key') }));
vi.mock('../ai/AIProviderRegistry', () => ({
    AIProviderRegistry: vi.fn().mockImplementation(() => ({ generateStream: hoisted.generateStream, supportsVision: () => false })),
}));
vi.mock('../client/BotClient', () => ({ BotClient: vi.fn() }));
vi.mock('../mcp/MCPConnector', () => ({
    MCPConnector: {
        discoverToolsWithMapping: vi.fn().mockResolvedValue({ tools: [], toolServerMap: new Map() }),
        executeToolCall: vi.fn().mockResolvedValue({ content: [] }),
        clearCache: vi.fn(),
    },
    toolTimeoutMs: () => 1000,
}));
vi.mock('axios', () => ({ default: hoisted.axios, ...hoisted.axios }));

import { ConversationMemory } from '../memory/ConversationMemory';
import { heardInDm } from '../memory/Heard';
import { MarkerWatch, PRIVATE_MARKER, PrivateAnswers, answeredPrivatelyLine, continuedIn, privateBodyOf } from '../ai/PrivateAnswers';

const BOT = 'bot-1';
const KHALID = 7;
const SARA_ID = 9;
const DM = 'matrix-dm';
const BUBBLE = 'bubble-space';
const SARA = 'uuid-sara';
const SECRET = 'My interview at Zain is at 10 on Thursday';
const LINE = "Khalid, I've answered that just for you.";

/** What the model was given, call by call. */
interface Given {
    system: string;
    user: string;
    tools: unknown[] | undefined;
}

/** A model that answers what the test scripted, one answer per call, and keeps what it was given. */
function model(answers: Array<string | string[] | Error>): Given[] {
    const given: Given[] = [];
    hoisted.generateStream.mockReset().mockImplementation(async function* (_providerId: string, system: string, user: string, _config: unknown, tools: unknown[] | undefined) {
        given.push({ system, user, tools });
        const answer = answers[given.length - 1] ?? 'OK.';
        if (answer instanceof Error) throw answer;
        for (const piece of Array.isArray(answer) ? answer : [answer]) yield { content: piece, done: false };
        yield { content: '', done: true, metadata: { tokensUsed: 110, promptTokens: 100, completionTokens: 10, latency: 5, error: false, truncated: false } };
    });
    return given;
}

function adminApiMock() {
    return {
        getAIProviderCredentials: vi.fn().mockResolvedValue({
            providerId: 'test-provider', name: 'Nora', type: 'lmstudio', enabled: true, endpoint: 'http://localhost:1234',
            apiKeyEncrypted: null, model: 'llama3', temperature: 0.7, maxTokens: 512, supportsStreaming: true, settings: {},
        }),
        trackAIUsage: vi.fn().mockResolvedValue(undefined),
        getRoomMetadata: vi.fn().mockResolvedValue(null),
        getAvailableAIProviders: vi.fn().mockResolvedValue([]),
        isBotPrivate: vi.fn(async () => false),
        isConfigured: () => false,
        checkReplyAllowance: vi.fn().mockResolvedValue({ allowed: true }),
    } as any;
}

/** A bot, a person who told it something in a direct message and something else in front of Sara, and a bubble. */
async function scene(options: { others?: string[] | undefined; unknown?: boolean; signedIn?: boolean } = {}) {
    const { AIService } = await import('../ai/AIService');
    const here: { others: string[] | undefined } = { others: options.unknown ? undefined : options.others ?? [SARA] };
    const memory = new ConversationMemory();
    memory.useHeard((_botId, _playerId, spaceName) => (spaceName === DM ? heardInDm() : here.others ? { place: 'nearby', with: [...here.others] } : undefined));
    // In a direct message
    memory.addMessage(BOT, KHALID, SECRET, 'person', DM);
    memory.addMessage(BOT, KHALID, 'Good luck at Zain!', 'bot', DM);
    // On the map, with Sara there
    const withSara = here.others;
    here.others = [SARA];
    memory.addMessage(BOT, KHALID, 'The demo is on Sunday', 'person', BUBBLE);
    here.others = withSara;
    memory.getMemory(BOT, KHALID)!.userUuid = 'uuid-khalid';
    memory.getMemory(BOT, KHALID)!.isGuest = false;

    const adminApi = adminApiMock();
    const service = new AIService(memory, adminApi, 'http://admin.local');
    const signedIn = options.signedIn ?? true;
    const botClient = {
        getBotId: () => BOT,
        getRoomUrl: () => undefined,
        isInSpace: () => true,
        othersWith: vi.fn(() => here.others),
        getPersonForArtifacts: vi.fn((playerId: number) => ({ signedIn, identifier: signedIn ? (playerId === KHALID ? 'uuid-khalid' : SARA) : null, name: playerId === KHALID ? 'Khalid' : 'Sara' })),
        sendAskEvent: vi.fn(() => true),
        sendMediaMessage: vi.fn(() => true),
        holdSpeech: vi.fn(),
        releaseSpeech: vi.fn(),
        replyStarts: vi.fn(),
    };

    const say = async (text: string, kind: { greeting?: boolean; retry?: boolean; playerId?: number } = {}) => {
        const playerId = kind.playerId ?? KHALID;
        // The caller passes everything it knows, as the behaviours do: the server decides what the model is given
        const context = memory.getConversationContext(BOT, playerId);
        const stream = kind.greeting
            ? service.generateGreetingStream(BOT, playerId, text, 'You are Nora.', 'test-provider', BUBBLE, context, botClient as any, adminApi)
            : service.generateBotResponseStream(BOT, playerId, text, 'You are Nora.', 'test-provider', BUBBLE, context, botClient as any, adminApi, undefined, undefined, 'world', undefined, undefined, undefined, kind.retry ?? false, !kind.retry);
        const chunks: any[] = [];
        for await (const chunk of stream) chunks.push(chunk);
        return { chunks, room: chunks.map((chunk) => chunk.content ?? '').join('') };
    };
    /** The replies only one person received: who, and the words. */
    const sentPrivately = () => botClient.sendAskEvent.mock.calls.map((call: any[]) => ({ space: call[0], to: call[1], kind: call[2].kind, body: call[2].body }));
    return { service, memory, adminApi, botClient, here, say, sentPrivately };
}

describe('MarkerWatch: no part of the marker is ever shown', () => {
    it('passes ordinary text on as it comes', () => {
        const watch = new MarkerWatch();
        expect(watch.push('Hello ') + watch.push('there.') + watch.rest()).toBe('Hello there.');
        expect(watch.found).toBe(false);
    });

    it('finds the marker written in one piece or in many, and shows nothing of it', () => {
        for (const pieces of [[PRIVATE_MARKER], ['[', 'PRIVATE', '_REPLY', ']'], ['[PRIV', 'ATE_REPLY]\n[EMOTION_UPDATE]{}[/EMOTION_UPDATE]'], ['  \n', '[private_reply]']]) {
            const watch = new MarkerWatch();
            const shown = pieces.map((piece) => watch.push(piece)).join('') + watch.rest();
            expect(watch.found).toBe(true);
            expect(shown.trim()).toBe('');
        }
    });

    it('holds back what could be its start, and lets it go when it was not', () => {
        const watch = new MarkerWatch();
        expect(watch.push('See [PRI')).toBe('See ');
        expect(watch.push('CES] below')).toBe('[PRICES] below');
        expect(watch.found).toBe(false);
    });

    it('gives back what it held when the reply ends there', () => {
        const watch = new MarkerWatch();
        expect(watch.push('Total [')).toBe('Total ');
        expect(watch.rest()).toBe('[');
    });

    it('shows what came before the marker and nothing after, and keeps the rest for the emotion block', () => {
        const watch = new MarkerWatch();
        expect(watch.push(`Sure. ${PRIVATE_MARKER} it is at 10`)).toBe('Sure. ');
        expect(watch.push(' on Thursday')).toBe('');
        expect(watch.after).toBe(' it is at 10 on Thursday');
        expect(watch.rest()).toBe('');
    });

    it('finds it in the same place after letters that grow when written in capitals', () => {
        // "ß" becomes "SS" in capitals, "ŉ" becomes two letters, "ﬁ" becomes "FI": the marker is no further on for that
        for (const before of ['Die Straße ist groß. ', 'ŉ ﬁn ǰ ', 'İstanbul ']) {
            const watch = new MarkerWatch();
            expect(watch.push(`${before}${PRIVATE_MARKER}\n[EMOTION_UPDATE]{}[/EMOTION_UPDATE]`)).toBe(before);
            expect(watch.found).toBe(true);
            expect(watch.after).toBe('\n[EMOTION_UPDATE]{}[/EMOTION_UPDATE]');
        }
        const pieces = new MarkerWatch();
        expect(pieces.push('groß [priv') + pieces.push('ate_reply] ok')).toBe('groß ');
        expect(pieces.after).toBe(' ok');
    });

    it('lets go of an ending that only looks like its start in capitals', () => {
        const watch = new MarkerWatch();
        expect(watch.push('Maß [') + watch.push('x]') + watch.rest()).toBe('Maß [x]');
        expect(watch.found).toBe(false);
    });
});

describe('a reply as its person reads it', () => {
    it('has no thinking, emotion block or marker in it', () => {
        expect(privateBodyOf(`<think>hmm</think>It is at 10.\n[EMOTION_UPDATE]{"personSentiment":1}[/EMOTION_UPDATE]`)).toBe('It is at 10.');
        expect(privateBodyOf(`${PRIVATE_MARKER} It is at 10.\n[EMOTION_UPDATE]{"person`)).toBe('It is at 10.');
    });

    it('names the person in the line everyone reads, when the bot knows a name', () => {
        expect(answeredPrivatelyLine('Khalid')).toBe(LINE);
        expect(answeredPrivatelyLine(null)).toBe("I've answered that just for you.");
    });
});

describe('AIService: private answers in a group (#1993)', () => {
    let quiet: Array<{ mockRestore(): void }> = [];
    beforeEach(() => {
        vi.clearAllMocks();
        quiet = [vi.spyOn(console, 'log').mockImplementation(() => undefined), vi.spyOn(console, 'warn').mockImplementation(() => undefined), vi.spyOn(console, 'error').mockImplementation(() => undefined)];
    });
    afterEach(() => {
        // Only the console: restoring every mock would take the model's stand-in away from the next test
        for (const spy of quiet) spy.mockRestore();
        vi.resetModules();
    });

    it('alone with the bot, the person gets one full answer, as before', async () => {
        const given = model(['It is at 10 on Thursday.']);
        const { say, sentPrivately } = await scene({ others: [] });
        const { room } = await say('When is my interview?');

        expect(given).toHaveLength(1);
        expect(given[0].system).toContain(SECRET);
        expect(given[0].system).not.toContain('PRIVATE THINGS');
        expect(given[0].system).not.toContain("OTHER PEOPLE'S THINGS");
        expect(room).toBe('It is at 10 on Thursday.');
        expect(sentPrivately()).toEqual([]);
    });

    it('in a group, what the model is given holds nothing the others were not there for, whatever the caller passed', async () => {
        const given = model(['The demo is on Sunday.']);
        const { say, sentPrivately } = await scene();
        const { room } = await say('When is the demo?');

        // Ordinary talk is one answer
        expect(given).toHaveLength(1);
        expect(given[0].system).not.toContain('Zain');
        expect(given[0].system).not.toContain('interview');
        // What Sara was there for is still known
        expect(given[0].system).toContain('The demo is on Sunday');
        expect(given[0].system).toContain('PRIVATE THINGS');
        expect(given[0].system).toContain(PRIVATE_MARKER);
        expect(room).toBe('The demo is on Sunday.');
        expect(sentPrivately()).toEqual([]);
    });

    it('when the answer needs something private, it goes to its person alone and everyone reads the fixed line', async () => {
        const given = model([`${PRIVATE_MARKER}\n[EMOTION_UPDATE]{"personSentiment":5,"isInsult":false,"context":"curious"}[/EMOTION_UPDATE]`, 'It is at 10 on Thursday, at Zain.\n[EMOTION_UPDATE]{"personSentiment":-40,"isInsult":false,"context":"worried"}[/EMOTION_UPDATE]']);
        const { say, sentPrivately, memory } = await scene();
        const { room, chunks } = await say('When is my interview?');

        expect(given).toHaveLength(2);
        // The first answer was made without it; the second with everything, for the person alone, and with no tools
        expect(given[0].system).not.toContain('Zain');
        expect(given[1].system).toContain(SECRET);
        expect(given[1].system).toContain('ONLY KHALID READS THIS REPLY');
        expect(given[1].system).not.toContain('PRIVATE THINGS');
        expect(given[1].user).toBe('When is my interview?');
        expect(given[1].tools).toBeUndefined();

        // The person: one reply only they see
        expect(sentPrivately()).toEqual([{ space: BUBBLE, to: KHALID, kind: 'reply', body: 'It is at 10 on Thursday, at Zain.' }]);

        // Everyone else: the fixed line, and the mood of the answer made without anything private. Never the marker,
        // the answer, or the mood the private answer was written in.
        expect(room).toBe(`${LINE}\n[EMOTION_UPDATE]{"personSentiment":5,"isInsult":false,"context":"curious"}[/EMOTION_UPDATE]`);
        expect(room).not.toContain('PRIVATE_REPLY');
        expect(room).not.toContain('Zain');
        expect(room).not.toContain('worried');
        expect(chunks.filter((chunk) => chunk.done)).toHaveLength(1);

        // Remembered as said to the person alone
        const kept = memory.getMemory(BOT, KHALID)!.conversationHistory.at(-1)!;
        expect(kept).toMatchObject({ sender: 'bot', message: 'It is at 10 on Thursday, at Zain.', heard: { place: 'nearby', with: [] } });
        expect(memory.getConversationContext(BOT, KHALID, { present: [SARA] })).not.toContain('at Zain');
        expect(memory.getConversationContext(BOT, KHALID)).toContain('It is at 10 on Thursday, at Zain.');
    });

    it('lets everyone read the line first, and its person their answer under it', async () => {
        model([PRIVATE_MARKER, 'It is at 10 on Thursday, at Zain.']);
        const { service, memory, adminApi, botClient } = await scene();
        const context = memory.getConversationContext(BOT, KHALID);
        const order: string[] = [];
        botClient.sendAskEvent.mockImplementation(() => (order.push('answer'), true));
        for await (const chunk of service.generateBotResponseStream(BOT, KHALID, 'When is my interview?', 'You are Nora.', 'test-provider', BUBBLE, context, botClient as any, adminApi, undefined, undefined, 'world', undefined, undefined, undefined, false, true)) {
            if (chunk.content) order.push(chunk.content);
        }
        expect(order).toEqual([LINE, 'answer']);
    });

    it('still sends the answer when whoever reads the reply stops at the line: the line was read', async () => {
        model([PRIVATE_MARKER, 'It is at 10 on Thursday, at Zain.']);
        const { service, memory, adminApi, botClient, sentPrivately } = await scene();
        const context = memory.getConversationContext(BOT, KHALID);
        for await (const chunk of service.generateBotResponseStream(BOT, KHALID, 'When is my interview?', 'You are Nora.', 'test-provider', BUBBLE, context, botClient as any, adminApi, undefined, undefined, 'world', undefined, undefined, undefined, false, true)) {
            if (chunk.content === LINE) break;
        }
        expect(sentPrivately()).toEqual([{ space: BUBBLE, to: KHALID, kind: 'reply', body: 'It is at 10 on Thursday, at Zain.' }]);
        expect(memory.getMemory(BOT, KHALID)!.conversationHistory.at(-1)).toMatchObject({ sender: 'bot', message: 'It is at 10 on Thursday, at Zain.' });
    });

    it('shows nothing when the bot is no longer in the space once the private answer is made', async () => {
        model([PRIVATE_MARKER, 'It is at 10 on Thursday, at Zain.']);
        const { say, botClient, sentPrivately } = await scene();
        (botClient as any).isInSpace = () => false;
        const { room, chunks } = await say('When is my interview?');
        expect(room).toBe('');
        expect(sentPrivately()).toEqual([]);
        expect(chunks.at(-1)).toMatchObject({ done: true, metadata: { error: true } });
    });

    it('takes "Continue privately" as its own, and passes every other tap on to the cards', async () => {
        model([PRIVATE_MARKER, 'It is at 10 on Thursday, at Zain.']);
        const { service, say, botClient } = await scene();
        const copies = { keep: vi.fn(), opened: vi.fn() };
        const cards = { tap: vi.fn(), personBack: vi.fn() };
        service.keepPrivateAnswersIn(copies);
        service.useNearbyAsks(cards as any);
        (botClient as any).chatIdOf = () => '@khalid:matrix.test';
        await say('When is my interview?');
        expect(copies.keep.mock.calls).toEqual([[BOT, '@khalid:matrix.test', 'It is at 10 on Thursday, at Zain.']]);

        const port = service.asksPort();
        port.tap(botClient as any, BUBBLE, KHALID, { askId: 'p1', revision: 0, tap: JSON.stringify({ action: 'continue', room: '!dm:matrix.test' }) });
        expect(copies.opened.mock.calls).toEqual([[BOT, '@khalid:matrix.test', '!dm:matrix.test']]);
        expect(cards.tap).not.toHaveBeenCalled();
        // Handed on once: opening the chat does not send it there again
        expect(copies.keep).toHaveBeenCalledTimes(1);

        port.tap(botClient as any, BUBBLE, KHALID, { askId: 'a1', revision: 2, tap: JSON.stringify({ choice: 'yes' }) });
        expect(cards.tap).toHaveBeenCalledTimes(1);
        expect(copies.opened).toHaveBeenCalledTimes(1);
    });

    it('shows no part of a marker that comes in pieces, or after other words', async () => {
        model([['One moment. ', '[PRIV', 'ATE_', 'REPLY] it is at'], 'It is at 10.']);
        const { say, sentPrivately } = await scene();
        const { room } = await say('When is my interview?');

        expect(room).toBe(`One moment. \n\n${LINE}`);
        expect(sentPrivately()).toHaveLength(1);
    });

    it('counts the two answers as one message of the person, with the cost of both', async () => {
        model([PRIVATE_MARKER, 'It is at 10.']);
        const { say, adminApi } = await scene();
        await say('When is my interview?');
        await vi.waitFor(() => expect(adminApi.trackAIUsage).toHaveBeenCalled());

        expect(adminApi.checkReplyAllowance).toHaveBeenCalledTimes(1);
        expect(adminApi.trackAIUsage).toHaveBeenCalledTimes(1);
        expect(adminApi.trackAIUsage).toHaveBeenCalledWith(expect.objectContaining({ userId: 'uuid-khalid', channel: 'nearby', tokensUsed: 220, promptTokens: 200, completionTokens: 20, error: false }));
    });

    it('sends none of the private answer to PostHog', async () => {
        model([PRIVATE_MARKER, 'It is at 10 on Thursday, at Zain.']);
        const { say } = await scene();
        await say('When is my interview?');

        const sent = JSON.stringify([...hoisted.captureAiGeneration.mock.calls, ...hoisted.captureAiTrace.mock.calls]);
        expect(sent).not.toContain('Zain');
        expect(sent).not.toContain('interview at');
    });

    it('does not say the fixed line again on every turn, and says it again after an ordinary reply', async () => {
        model([PRIVATE_MARKER, 'It is at 10.', PRIVATE_MARKER, 'At Zain.', 'The demo is on Sunday.', PRIVATE_MARKER, 'Thursday.']);
        const { say, sentPrivately, service } = await scene();

        expect((await say('When is my interview?')).room).toBe(LINE);
        expect((await say('And where?')).room).toBe('');
        expect((await say('When is the demo?')).room).toBe('The demo is on Sunday.');
        expect((await say('Which day was the interview?')).room).toBe(LINE);
        expect(sentPrivately().map((reply: { body: string }) => reply.body)).toEqual(['It is at 10.', 'At Zain.', 'Thursday.']);
        // Said twice it is not a repetition to write again
        expect(service.isRestingLine(LINE)).toBe(true);
        expect(service.isRestingLine(`${LINE}\n[EMOTION_UPDATE]{"personSentiment":0}[/EMOTION_UPDATE]`)).toBe(true);
        expect(service.isRestingLine('The demo is on Sunday.')).toBe(false);
    });

    it('never asks a greeting, or a reply written again, for a second answer', async () => {
        const given = model(['Hi Khalid!', 'Hello again.']);
        const { say, sentPrivately } = await scene();
        await say('Khalid just approached you.', { greeting: true });
        await say('hi [IMPORTANT: Give a COMPLETELY DIFFERENT response- attempt 1]', { retry: true });

        expect(given).toHaveLength(2);
        for (const call of given) {
            expect(call.system).not.toContain('Zain');
            expect(call.system).not.toContain('PRIVATE THINGS');
        }
        expect(sentPrivately()).toEqual([]);
    });

    it('tells the bot client, as each reply starts, whether it is for someone who is alone: the same answer the reply is built on', async () => {
        model(['It is at 10.', 'Hello.', 'Hello.']);
        const { say, here, botClient } = await scene({ others: [] });
        await say('When is my interview?');
        here.others = [SARA];
        await say('hi');
        here.others = undefined;
        await say('hi');

        expect(botClient.replyStarts.mock.calls).toEqual([
            [BUBBLE, KHALID, true],
            [BUBBLE, KHALID, false],
            [BUBBLE, KHALID, false],
        ]);
    });

    it('takes other people as being there when it cannot tell who is', async () => {
        const given = model(['Hello.']);
        const { say } = await scene({ unknown: true });
        await say('hi');

        expect(given[0].system).not.toContain('Zain');
        expect(given[0].system).not.toContain('The demo is on Sunday');
    });

    it('opens what was said in front of Sara to Sara alone, not to someone who was not there', async () => {
        const given = model(['Hello.', 'Hello.']);
        const { say, here } = await scene();
        await say('hi');
        here.others = [SARA, 'uuid-omar'];
        await say('hi');

        expect(given[0].system).toContain('The demo is on Sunday');
        expect(given[1].system).not.toContain('The demo is on Sunday');
    });

    it("gives someone else nothing of this person's, and the rule that it is theirs to share", async () => {
        const given = model(["That's Khalid's to share, Sara. Anything I can help you with?"]);
        const { say, sentPrivately, here } = await scene();
        here.others = ['uuid-khalid'];
        const { room } = await say("When is Khalid's interview?", { playerId: SARA_ID });

        expect(given).toHaveLength(1);
        expect(given[0].system).not.toContain('Zain');
        expect(given[0].system).toContain("OTHER PEOPLE'S THINGS");
        // Sara has nothing private with the bot, so her own answers never need a second one
        expect(given[0].system).not.toContain('PRIVATE THINGS');
        expect(room).toBe("That's Khalid's to share, Sara. Anything I can help you with?");
        expect(sentPrivately()).toEqual([]);
    });

    it('shows nothing to anyone when the private answer cannot be made, and still keeps what it cost', async () => {
        model([PRIVATE_MARKER, new Error('provider down')]);
        const { say, sentPrivately, adminApi } = await scene();
        const { room, chunks } = await say('When is my interview?');
        await vi.waitFor(() => expect(adminApi.trackAIUsage).toHaveBeenCalled());

        expect(room).toBe('');
        expect(sentPrivately()).toEqual([]);
        expect(chunks.at(-1)).toMatchObject({ done: true, metadata: { error: true } });
        // What the first answer used is recorded once, with the failure after it (as a failed ordinary answer leaves)
        const rows = adminApi.trackAIUsage.mock.calls.map((call: any[]) => call[0]);
        expect(rows.reduce((sum: number, row: { tokensUsed: number }) => sum + row.tokensUsed, 0)).toBe(110);
        expect(rows.some((row: { error: boolean }) => row.error)).toBe(true);
    });


    describe('what the reply sends with it', () => {
        const CHART = 'https://cdn.example.test/chart.png';
        /** A model that sends a picture with its tool, then says a line. */
        const sendsPicture = () => {
            let calls = 0;
            hoisted.generateStream.mockReset().mockImplementation(async function* () {
                calls++;
                if (calls === 1) yield { content: '', done: false, toolCalls: [{ id: 'call_1', name: 'send_image', arguments: JSON.stringify({ url: CHART, alt: 'A chart' }) }] };
                else yield { content: 'Here it is.', done: false };
                yield { content: '', done: true, metadata: { tokensUsed: 110, promptTokens: 100, completionTokens: 10, latency: 5, error: false, truncated: false } };
            });
        };
        const waitingSong = () => ({ url: 'https://cdn.example.test/song.mp3', mediaType: 'audio' as const, mimeType: 'audio/mpeg', caption: 'Your song', createdAt: Date.now() - 60_000, retryCount: 0 });

        it('alone with the bot: a picture, and a song that was waiting, go to that person and nobody who walks up meanwhile', async () => {
            sendsPicture();
            const { say, botClient, memory } = await scene({ others: [] });
            const sendImage = vi.fn(async (_space: string, url: string) => url);
            Object.assign(botClient, { sendImage, getFullConfig: () => ({}) });
            memory.getMemory(BOT, KHALID)!.pendingMedia = [waitingSong()];
            await say('Show me my chart');

            expect(sendImage).toHaveBeenCalledWith(BUBBLE, CHART, 'A chart', KHALID, undefined, KHALID);
            expect(botClient.sendMediaMessage).toHaveBeenCalledWith(BUBBLE, 'https://cdn.example.test/song.mp3', 'audio', 'audio/mpeg', 'Your song', undefined, KHALID, KHALID);
        });

        it('in a group: a picture goes into the space for everyone, and what was waiting from before stays waiting', async () => {
            sendsPicture();
            const { say, botClient, memory } = await scene();
            const sendImage = vi.fn(async (_space: string, url: string) => url);
            Object.assign(botClient, { sendImage, getFullConfig: () => ({}) });
            memory.getMemory(BOT, KHALID)!.pendingMedia = [waitingSong()];
            await say('Show us the chart');

            expect(sendImage).toHaveBeenCalledWith(BUBBLE, CHART, 'A chart', KHALID, undefined, undefined);
            expect(botClient.sendMediaMessage).not.toHaveBeenCalled();
            expect(memory.getMemory(BOT, KHALID)!.pendingMedia).toHaveLength(1);
        });
    });

    it('answers a guest alone too', async () => {
        model([PRIVATE_MARKER, 'It is at 10.']);
        const { say, sentPrivately } = await scene({ signedIn: false });
        const { room } = await say('When is my interview?');

        expect(room).toBe(LINE);
        expect(sentPrivately()).toEqual([{ space: BUBBLE, to: KHALID, kind: 'reply', body: 'It is at 10.' }]);
    });
});

describe('PrivateAnswers: the replies come back with their person', () => {
    const bot = (signedIn = true) => ({
        getBotId: () => BOT,
        sendAskEvent: vi.fn(() => true),
        getPersonForArtifacts: vi.fn(() => ({ signedIn, identifier: signedIn ? 'uuid-khalid' : null, name: 'Khalid' })),
    });

    it('sends each reply to its person, and again when they are back, in order', () => {
        const answers = new PrivateAnswers();
        const client = bot();
        answers.send(client, BUBBLE, KHALID, 'It is at 10.');
        answers.send(client, BUBBLE, KHALID, 'At Zain.');
        client.sendAskEvent.mockClear();

        // After a reload the person has a new player id; they are known by who they are
        answers.personBack(client, BUBBLE, 21);
        expect(client.sendAskEvent.mock.calls.map((call: any[]) => [call[1], call[2].body])).toEqual([[21, 'It is at 10.'], [21, 'At Zain.']]);
        // The same ids, so the game shows each once
        const ids = client.sendAskEvent.mock.calls.map((call: any[]) => call[2].id);
        expect(new Set(ids).size).toBe(2);
    });

    it('keeps each space and each person to themselves', () => {
        const answers = new PrivateAnswers();
        const client = bot();
        answers.send(client, BUBBLE, KHALID, 'It is at 10.');
        client.sendAskEvent.mockClear();

        answers.personBack(client, 'another-space', KHALID);
        client.getPersonForArtifacts.mockReturnValue({ signedIn: true, identifier: SARA, name: 'Sara' });
        answers.personBack(client, BUBBLE, SARA_ID);
        expect(client.sendAskEvent).not.toHaveBeenCalled();
    });

    it('lets a reply go after a while, and keeps only the newest few', () => {
        let now = 1_000_000;
        const answers = new PrivateAnswers(() => now);
        const client = bot();
        for (let i = 0; i < 14; i++) answers.send(client, BUBBLE, KHALID, `answer ${i}`);
        client.sendAskEvent.mockClear();
        answers.personBack(client, BUBBLE, KHALID);
        expect(client.sendAskEvent).toHaveBeenCalledTimes(10);
        expect((client.sendAskEvent.mock.calls[0] as any[])[2].body).toBe('answer 4');

        now += 2 * 60 * 60 * 1000 + 1;
        client.sendAskEvent.mockClear();
        answers.personBack(client, BUBBLE, KHALID);
        expect(client.sendAskEvent).not.toHaveBeenCalled();
    });

    it('sends a guest their reply once: there is nobody to give it back to', () => {
        const answers = new PrivateAnswers();
        const client = bot(false);
        expect(answers.send(client, BUBBLE, KHALID, 'It is at 10.')).toBe(true);
        client.sendAskEvent.mockClear();
        answers.personBack(client, BUBBLE, KHALID);
        expect(client.sendAskEvent).not.toHaveBeenCalled();
    });

    it('says nothing was sent when the bot is no longer in the space', () => {
        const answers = new PrivateAnswers();
        const client = bot();
        client.sendAskEvent.mockReturnValue(false);
        expect(answers.send(client, BUBBLE, KHALID, 'It is at 10.')).toBe(false);
        client.sendAskEvent.mockReturnValue(true);
        client.sendAskEvent.mockClear();
        answers.personBack(client, BUBBLE, KHALID);
        expect(client.sendAskEvent).not.toHaveBeenCalled();
    });
});

describe('PrivateAnswers: the one copy in direct messages', () => {
    const CHAT = '@khalid:matrix.test';
    const ROOM = '!dm:matrix.test';
    const bot = (options: { signedIn?: boolean; chatId?: string | undefined } = {}) => {
        const signedIn = options.signedIn ?? true;
        return {
            getBotId: () => BOT,
            sendAskEvent: vi.fn(() => true),
            getPersonForArtifacts: vi.fn(() => ({ signedIn, identifier: signedIn ? 'uuid-khalid' : null, name: 'Khalid' })),
            chatIdOf: vi.fn((): string | undefined => ('chatId' in options ? options.chatId : CHAT)),
        };
    };
    const kept = () => {
        const copies = { keep: vi.fn(), opened: vi.fn() };
        const answers = new PrivateAnswers();
        answers.keepCopiesIn(copies);
        return { answers, copies };
    };

    it('reads the room "Continue privately" names, and nothing from any other tap', () => {
        expect(continuedIn(JSON.stringify({ action: 'continue', room: ROOM }))).toBe(ROOM);
        expect(continuedIn(JSON.stringify({ choice: 'yes' }))).toBeNull();
        expect(continuedIn(JSON.stringify({ action: 'continue' }))).toBeNull();
        expect(continuedIn(JSON.stringify({ action: 'continue', room: 'not a room' }))).toBeNull();
        expect(continuedIn(JSON.stringify({ action: 'continue', room: '#alias:matrix.test' }))).toBeNull();
        expect(continuedIn(JSON.stringify({ action: 'continue', room: 7 }))).toBeNull();
        expect(continuedIn('continue')).toBeNull();
        expect(continuedIn('null')).toBeNull();
        expect(continuedIn('')).toBeNull();
    });

    it('hands each answer of someone signed in on once, by the chat address the game vouches for', () => {
        const { answers, copies } = kept();
        const client = bot();
        answers.send(client, BUBBLE, KHALID, 'It is at 10.');
        answers.send(client, BUBBLE, KHALID, 'At Zain.');
        expect(copies.keep.mock.calls).toEqual([[BOT, CHAT, 'It is at 10.'], [BOT, CHAT, 'At Zain.']]);

        // Coming back shows them their replies again in nearby chat, and sends nothing to direct messages again
        answers.personBack(client, BUBBLE, 21);
        answers.continued(client, BUBBLE, 21, ROOM);
        expect(copies.keep).toHaveBeenCalledTimes(2);
        expect(copies.opened.mock.calls).toEqual([[BOT, CHAT, ROOM]]);
    });

    it('gives a guest the reply in nearby chat alone: a guest has no direct messages', () => {
        const { answers, copies } = kept();
        const client = bot({ signedIn: false });
        expect(answers.send(client, BUBBLE, KHALID, 'It is at 10.')).toBe(true);
        answers.continued(client, BUBBLE, KHALID, ROOM);
        expect(copies.keep).not.toHaveBeenCalled();
        expect(copies.opened).not.toHaveBeenCalled();
    });

    it('waits for the chat address when the game has not said it yet, and hands the answer on when they continue', () => {
        const { answers, copies } = kept();
        const client = bot({ chatId: undefined });
        answers.send(client, BUBBLE, KHALID, 'It is at 10.');
        expect(copies.keep).not.toHaveBeenCalled();
        answers.continued(client, BUBBLE, KHALID, ROOM);
        expect(copies.keep).not.toHaveBeenCalled();
        expect(copies.opened).not.toHaveBeenCalled();

        client.chatIdOf.mockReturnValue(CHAT);
        answers.continued(client, BUBBLE, KHALID, ROOM);
        answers.continued(client, BUBBLE, KHALID, ROOM);
        expect(copies.keep.mock.calls).toEqual([[BOT, CHAT, 'It is at 10.']]);
        expect(copies.opened).toHaveBeenCalledTimes(2);
    });

    it('hands nothing on when the reply could not go, or when nowhere keeps copies', () => {
        const { answers, copies } = kept();
        const client = bot();
        client.sendAskEvent.mockReturnValue(false);
        answers.send(client, BUBBLE, KHALID, 'It is at 10.');
        expect(copies.keep).not.toHaveBeenCalled();

        const alone = new PrivateAnswers();
        const other = bot();
        expect(alone.send(other, BUBBLE, KHALID, 'It is at 10.')).toBe(true);
        expect(() => alone.continued(other, BUBBLE, KHALID, ROOM)).not.toThrow();
    });
});
