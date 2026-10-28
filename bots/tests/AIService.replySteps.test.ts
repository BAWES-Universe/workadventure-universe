/**
 * A reply keeps its own steps (#1508): step three still sees what step one found, the steps stay within "Room for tool
 * results in one reply", and a model that turns them down for length is asked again with them smaller.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@sentry/node', () => ({
    startSpanManual: vi.fn((_opts: unknown, callback: (span: any) => any) =>
        callback({ end: vi.fn(), setAttribute: vi.fn(), spanContext: vi.fn(() => ({ spanId: 's', traceId: 't' })) })
    ),
    startInactiveSpan: vi.fn(),
    getCurrentScope: vi.fn(() => ({ setConversationId: vi.fn() })),
    getActiveSpan: vi.fn(() => null),
    setConversationId: vi.fn(),
}));
vi.mock('@sentry/core', () => ({ _INTERNAL_setSpanForScope: vi.fn() }));
vi.mock('../ai/PostHogClient', () => ({
    captureAiGeneration: vi.fn(),
    captureAiTrace: vi.fn(),
    flushPostHog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../ai/encryption', () => ({ decryptApiKey: vi.fn(() => 'decrypted-key') }));
const mockGenerateStream = vi.fn();
vi.mock('../ai/AIProviderRegistry', () => ({
    AIProviderRegistry: vi.fn().mockImplementation(() => ({
        generateStream: mockGenerateStream,
        getOrCreateProvider: vi.fn(),
        supportsVision: vi.fn(() => false),
    })),
}));
vi.mock('../client/BotClient', () => ({ BotClient: vi.fn() }));
vi.mock('../mcp/MCPConnector', () => ({
    MCPConnector: {
        discoverToolsWithMapping: vi.fn().mockResolvedValue({ tools: [], toolServerMap: new Map() }),
        executeToolCall: vi.fn().mockResolvedValue({ content: [] }),
        clearCache: vi.fn(),
    },
}));

const LIMITS = {
    replyTokens: 16000,
    steps: 5,
    continuations: 1,
    messages: 8,
    readChars: 10000,
    waitSeconds: 120,
    artifactBytes: 1048576,
    artifactVersions: 0,
    artifactSaveSeconds: 60,
    guard: true,
    roomChars: 80000,
};

function buildMocks(limits: Record<string, unknown> = LIMITS, source = 'universe-ai') {
    const admin: any = {
        isConfigured: () => true,
        getAIProviderCredentials: vi.fn(),
        getBotAiCredentials: vi.fn().mockResolvedValue({
            providerId: 'deepseek-flash',
            name: 'DeepSeek V4 Flash',
            type: 'openai',
            enabled: true,
            endpoint: 'https://api.deepseek.com',
            apiKeyEncrypted: 'iv:tag:data',
            model: 'deepseek-v4-flash',
            temperature: 0.7,
            maxTokens: 16000,
            supportsStreaming: true,
            settings: {},
            source,
            limits,
        }),
        reportAiHealth: vi.fn().mockResolvedValue(undefined),
        trackAIUsage: vi.fn().mockResolvedValue(undefined),
        getRoomMetadata: vi.fn().mockResolvedValue(null),
        getAvailableAIProviders: vi.fn().mockResolvedValue([]),
    };
    const memory: any = {
        getMemory: vi.fn(() => ({ userUuid: 'test-uuid', dmRoomId: '!dm:matrix.test' })),
        appendVisionDescription: vi.fn(),
        getPendingMediaNotice: vi.fn(() => ''),
        setHistoryWindow: vi.fn(),
    };
    return { admin, memory };
}

function says(text: string) {
    return async function* () {
        yield { content: text, done: false };
        yield { content: '', done: true, metadata: { tokensUsed: 5, latency: 10, error: false } };
    };
}

function calls(id: string, said = '', reasoning?: string) {
    return async function* () {
        if (said) yield { content: said, done: false };
        yield { content: '', done: false, toolCalls: [{ id, name: 'get_bot_position', arguments: '{}' }] };
        yield { content: '', done: true, ...(reasoning ? { reasoning } : {}), metadata: { tokensUsed: 5, latency: 10, error: false } };
    };
}

async function* tooLong() {
    yield { content: '', done: true, metadata: { tokensUsed: 0, latency: 10, error: true, errorStatus: 400, tooLong: true } };
}

async function drain(generator: AsyncGenerator<any>): Promise<any[]> {
    const chunks: any[] = [];
    for await (const chunk of generator) chunks.push(chunk);
    return chunks;
}

describe('AIService – a reply keeps its own steps', () => {
    let AIService: any;
    /** The steps each call was given, as they were at that call (the list grows as the reply goes on). */
    let seen: any[];

    beforeEach(async () => {
        vi.clearAllMocks();
        mockGenerateStream.mockReset();
        seen = [];
        AIService = (await import('../ai/AIService')).AIService;
    });
    afterEach(() => {
        vi.resetModules();
    });

    function answersWith(...rounds: Array<() => AsyncGenerator<any>>) {
        for (const round of rounds) {
            mockGenerateStream.mockImplementationOnce((...args: any[]) => {
                seen.push(args[7] === undefined ? undefined : structuredClone(args[7]));
                return round();
            });
        }
    }

    const reply = (service: any, message = 'where are you?') =>
        drain(service.generateBotResponseStream('bot-1', 42, message, 'You are a bot.', 'universe-ai', '!dm:matrix.test', '', undefined, undefined, undefined, undefined, 'dm'));
    const said = (chunks: any[]) => chunks.map((chunk) => chunk.content).join('');

    it('gives step three what step one found, with what the model said and thought, after the person\'s message', async () => {
        const { admin, memory } = buildMocks();
        answersWith(calls('call_a', 'Let me look.', 'Find my spot first.'), calls('call_b', '', 'Check again.'), says('I am by the door.'));
        const chunks = await reply(new AIService(memory, admin, 'http://admin.local'));
        expect(said(chunks)).toContain('I am by the door.');
        expect(mockGenerateStream).toHaveBeenCalledTimes(3);
        // The first call has no steps; every later one has the person's message as its own
        expect(seen[0]).toBeUndefined();
        for (const call of mockGenerateStream.mock.calls) expect(String(call[2])).toContain('where are you?');
        expect(seen[2].steps).toHaveLength(2);
        expect(seen[2].steps[0]).toMatchObject({ content: 'Let me look.', reasoning: 'Find my spot first.', calls: [{ id: 'call_a', name: 'get_bot_position' }] });
        expect(seen[2].steps[0].results[0]).toMatchObject({ id: 'call_a', name: 'get_bot_position' });
        expect(seen[2].steps[0].results[0].content).toMatch(/^get_bot_position: /);
        expect(seen[2].steps[1]).toMatchObject({ content: '', reasoning: 'Check again.', calls: [{ id: 'call_b' }] });
        expect(seen[2].after).toContain('Continue this reply from the tool results above');
        // Only ever added at the end: the provider still matches what it read before
        expect(seen[2].steps[0]).toEqual(seen[1].steps[0]);
    });

    it('sets older results aside once the steps pass "Room for tool results in one reply"', async () => {
        const { admin, memory } = buildMocks({ ...LIMITS, roomChars: 10 });
        answersWith(calls('call_a'), calls('call_b'), says('Here.'));
        await reply(new AIService(memory, admin, 'http://admin.local'));
        expect(seen[1].steps[0].results[0].content).toMatch(/\n\[Only the first 10 of \d+ characters fit/);
        expect(seen[2].steps[0].results[0].content).toMatch(/^\[get_bot_position: \d+ characters, set aside to make room\. Call it again if you need it\.\]$/);
        expect(seen[2].steps[1].results[0].content).toMatch(/\n\[Only the first 10 of \d+ characters fit/);
    });

    it('asks again with the steps smaller when the model turns them down for length, and counts it as working', async () => {
        // On a person's own key, where the bot server tells Orbit how each reply went
        const { admin, memory } = buildMocks(LIMITS, 'own-key');
        answersWith(calls('call_a'), tooLong, says('I am by the door.'));
        const chunks = await reply(new AIService(memory, admin, 'http://admin.local'));
        expect(mockGenerateStream).toHaveBeenCalledTimes(3);
        expect(seen[1].steps[0].results[0].content).not.toContain('Only the first');
        expect(seen[2].steps[0].results[0].content).toMatch(/\n\[Only the first \d+ of \d+ characters fit/);
        expect(said(chunks)).toContain('I am by the door.');
        await vi.waitFor(() => expect(admin.reportAiHealth).toHaveBeenCalled());
        expect(admin.reportAiHealth).toHaveBeenLastCalledWith('bot-1', { ok: true });
    });

    it('cuts by how far over the error says it went, so one more call fits', async () => {
        const { admin, memory } = buildMocks(LIMITS, 'own-key');
        const over = async function* () {
            yield { content: '', done: true, metadata: { tokensUsed: 0, latency: 10, error: true, errorStatus: 400, tooLong: true, context: { limit: 9000, asked: 10000 } } };
        };
        answersWith(calls('call_a'), over, says('I am by the door.'));
        await reply(new AIService(memory, admin, 'http://admin.local'));
        expect(mockGenerateStream).toHaveBeenCalledTimes(3);
        const before = seen[1].steps[0].results[0].content.length;
        const after = seen[2].steps[0].results[0].content;
        expect(after).toMatch(/\n\[Only the first \d[\d,]* of [\d,]+ characters fit/);
        // Not halved blind: cut by what it went over, which for this short result is all but its start
        expect(after.length).toBeLessThan(before + 200);
    });

    it("never marks a person's key failing for a rate limit its own asking again caused", async () => {
        const { admin, memory } = buildMocks(LIMITS, 'own-key');
        const limited = async function* () {
            yield { content: '', done: true, metadata: { tokensUsed: 0, latency: 10, error: true, errorStatus: 429 } };
        };
        answersWith(calls('call_a'), tooLong);
        mockGenerateStream.mockImplementation(limited);
        const chunks = await reply(new AIService(memory, admin, 'http://admin.local'));
        expect(chunks.at(-1).done).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(admin.reportAiHealth).not.toHaveBeenCalled();
    });

    it('stops asking once nothing is left to cut', async () => {
        const { admin, memory } = buildMocks(LIMITS, 'own-key');
        answersWith(calls('call_a'));
        mockGenerateStream.mockImplementation(tooLong);
        const chunks = await reply(new AIService(memory, admin, 'http://admin.local'));
        expect(mockGenerateStream.mock.calls.length).toBeLessThan(20);
        expect(chunks.at(-1).done).toBe(true);
        await vi.waitFor(() => expect(admin.reportAiHealth).toHaveBeenCalled());
        expect(admin.reportAiHealth.mock.lastCall[1]).toMatchObject({ ok: false });
    });

    it('answers from every step as text at the step limit', async () => {
        const { admin, memory } = buildMocks({ ...LIMITS, steps: 2 });
        answersWith(calls('call_a'), calls('call_b'), calls('call_c'), says('Done.'));
        const chunks = await reply(new AIService(memory, admin, 'http://admin.local'));
        expect(said(chunks)).toContain('Done.');
        const synthesis = String(mockGenerateStream.mock.calls[3][2]);
        expect(synthesis).toMatch(/=== Step 1 ===\nget_bot_position: [\s\S]*=== Step 2 ===\nget_bot_position: /);
        expect(synthesis).toContain('Do NOT call any more tools.');
        expect(mockGenerateStream.mock.calls[3][4]).toEqual([]);
    });
});
