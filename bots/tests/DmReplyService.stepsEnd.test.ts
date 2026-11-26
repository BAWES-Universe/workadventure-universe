import { describe, expect, it, vi } from 'vitest';
import type { StepsField } from '../ai/ToolSteps';

/**
 * However a direct-message reply ends, its steps line is left done or stopped, never "working" (game #2131): a line left
 * working counts a clock for ever. Covers the line that starts with "Connected {App}" too.
 */

const BOT = '0b7c1d2e-1111-4222-8333-944455556666';
const person = { matrixUserId: '@alice:matrix.test', uuid: 'uuid-alice', name: 'Alice', isGuest: false };

type Chunk = Record<string, unknown>;

async function service(stream: () => AsyncGenerator<Chunk>, extra: Record<string, unknown> = {}) {
    const { DmReplyService } = await import('../server/DmReplyService');
    const { ConversationMemory } = await import('../memory/ConversationMemory');
    const dm = Object.create(DmReplyService.prototype) as InstanceType<typeof DmReplyService>;
    Object.assign(dm, {
        playerIds: new Map(),
        nextPlayerId: -1,
        loadedBots: new Set([BOT]),
        botManager: { getBot: () => null },
        getBotConfig: async () => ({ botId: BOT, name: 'Guide', aiProviderRef: 'p' }),
        shouldShowToolCalls: async () => true,
        aiService: { generateBotResponseStream: vi.fn(stream), botLimitsFor: () => ({ fileTextChars: 2_000_000 }), readCharsFor: () => 50_000 },
        conversationMemory: new ConversationMemory(),
        conversationStorage: { startConversation: vi.fn(), addMessage: vi.fn(async () => undefined) },
        collectImageUrls: async () => [],
        ...extra,
    });
    return dm;
}

const start = { id: 'c1', doing: 'Using Fetch emails', done: 'Used Fetch emails', group: 'tool:x' };
const answer = { content: 'Here you go.', done: true };

/** The line as the person last saw it. */
async function lastLine(dm: unknown, hooks: Record<string, unknown> = {}): Promise<{ field: StepsField; thrown?: unknown }> {
    const fields: StepsField[] = [];
    let thrown: unknown;
    await (dm as any)
        .replyNow(BOT, person, 'hello', [], { roomId: '!room', onSteps: async (field: StepsField) => void fields.push(JSON.parse(JSON.stringify(field))), ...hooks })
        .catch((error: unknown) => (thrown = error));
    return { field: fields.at(-1) as StepsField, thrown };
}

const ended = (field: StepsField) => {
    expect(['done', 'stopped']).toContain(field.state);
    expect(field.steps.filter((step) => step.state === 'running')).toEqual([]);
};

describe.each([
    ['a tool run', undefined],
    ['the App they just connected, then a tool run', { app: 'gmail', name: 'Gmail' }],
])('the steps line after %s', (_label, connectedApp) => {
    const hooks = connectedApp ? { connectedApp } : {};
    const tool = async function* (): AsyncGenerator<Chunk> {
        yield { content: '', done: false, reset: true, toolSteps: [start] };
    };

    it('is done once the answer comes', async () => {
        const dm = await service(async function* () {
            yield* tool();
            yield { content: '', done: false, toolStepResults: [{ id: 'c1', ok: true }] };
            yield answer;
        });
        const { field } = await lastLine(dm, hooks);
        ended(field);
        expect(field.state).toBe('done');
    });

    it('is stopped when the person has reached a reply limit', async () => {
        const dm = await service(async function* () {
            yield* tool();
            yield { content: '', done: false, replyLimit: { kind: 'bot' } };
        });
        const { field } = await lastLine(dm, hooks);
        ended(field);
        expect(field.state).toBe('stopped');
    });

    it('is stopped when the reply fails while it streams', async () => {
        const dm = await service(async function* () {
            yield* tool();
            throw new Error('provider down');
        });
        const { field } = await lastLine(dm, hooks);
        ended(field);
        expect(field.state).toBe('stopped');
    });

    it('is stopped when the provider fails part-way', async () => {
        const dm = await service(async function* () {
            yield* tool();
            yield { content: 'Here is', done: true, metadata: { error: 'cut off' } };
        });
        const { field } = await lastLine(dm, hooks);
        ended(field);
        expect(field.state).toBe('stopped');
    });

    it('is stopped when something fails after the stream', async () => {
        const dm = await service(
            async function* () {
                yield* tool();
                yield answer;
            },
            { responseProcessor: { processResponse: () => { throw new Error('boom'); } } }
        );
        const { field, thrown } = await lastLine(dm, hooks);
        ended(field);
        expect(field.state).toBe('stopped');
        expect(thrown).toBeInstanceOf(Error);
    });
});

describe('the line that only says "Connected {App}"', () => {
    const hooks = { connectedApp: { app: 'gmail', name: 'Gmail' } };

    it('is done when the reply answers without a tool', async () => {
        const dm = await service(async function* () {
            yield answer;
        });
        const { field } = await lastLine(dm, hooks);
        ended(field);
        expect(field).toMatchObject({ state: 'done', line: 'Connected Gmail' });
    });

    it.each([
        ['a reply limit', async function* (): AsyncGenerator<Chunk> { yield { content: '', done: false, replyLimit: { kind: 'bot' } }; }],
        ['an error', async function* (): AsyncGenerator<Chunk> { throw new Error('down'); }],
        ['a provider failure', async function* (): AsyncGenerator<Chunk> { yield { content: 'x', done: true, metadata: { error: 'cut' } }; }],
    ])('is stopped after %s, and keeps its tick', async (_name, stream) => {
        const dm = await service(stream);
        const { field } = await lastLine(dm, hooks);
        ended(field);
        expect(field.state).toBe('stopped');
        expect(field.steps[0]).toMatchObject({ done: 'Connected Gmail', state: 'done' });
    });
});
