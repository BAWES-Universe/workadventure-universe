import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIService } from '../ai/AIService';
import { MCPConnector } from '../mcp/MCPConnector';

vi.mock('../client/BotClient', () => ({ BotClient: vi.fn() }));

// No MCP servers: the tests are about the built-in tools
beforeEach(() => {
    vi.stubEnv('BOT_ARTIFACTS_ENABLED', 'true');
    vi.spyOn(MCPConnector, 'discoverToolsWithMapping').mockResolvedValue({ tools: [], toolServerMap: new Map() } as never);
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

const summary = { id: 'art-1', title: 'Quests board', kind: 'app', makerName: 'Scout', version: 1 };

function admin(overrides: Record<string, unknown> = {}) {
    return {
        isConfigured: () => true,
        makeArtifact: vi.fn(async () => ({ artifact: summary, version: { number: 1, summary: null }, hidden: false })),
        changeArtifact: vi.fn(async () => ({ artifact: { ...summary, version: 2 }, version: { number: 2, summary: null }, hidden: false })),
        readArtifact: vi.fn(),
        listArtifactsInChat: vi.fn(async () => ({ artifacts: [summary], hidden: false })),
        ...overrides,
    };
}

function botClient() {
    return {
        getPersonForArtifacts: vi.fn(() => ({ signedIn: true, identifier: 'uuid-1', name: 'Khalid' })),
        sendChatMessage: vi.fn(),
        sendImage: vi.fn(),
    };
}

function service(memory?: Record<string, unknown>) {
    const ai = new AIService(null!, null!, '');
    (ai as unknown as { conversationMemory: unknown }).conversationMemory = { getMemory: () => memory };
    return ai;
}

const make = { id: 't1', name: 'make_artifact', arguments: JSON.stringify({ title: 'Quests board', kind: 'app', content: '<h1>x</h1>' }) };

describe('artifact tools in AIService', () => {
    it('offers them in a bubble and in a direct message when Orbit is set up, and not otherwise', async () => {
        const ai = new AIService(null!, null!, '');
        const names = async (client: unknown, orbit: unknown, channel: 'world' | 'dm') =>
            (await ai['buildTools']('bot1', client as never, orbit as never, channel)).tools.map((tool: { function: { name: string } }) => tool.function.name);
        const artifactNames = ['make_artifact', 'change_artifact', 'read_artifact', 'list_artifacts'];
        expect(await names(botClient(), admin(), 'world')).toEqual(expect.arrayContaining(artifactNames));
        expect(await names(undefined, admin(), 'dm')).toEqual(expect.arrayContaining(artifactNames));
        expect(await names(botClient(), admin({ isConfigured: () => false }), 'world')).not.toContain('make_artifact');
        expect(await names(undefined, undefined, 'dm')).not.toContain('make_artifact');
        // A caller with no bubble and no direct chat has nowhere to put the card
        expect(await names(undefined, admin(), 'world')).not.toContain('make_artifact');
        // Off unless the bot server is told to turn it on: the bot answers in words, as before
        vi.stubEnv('BOT_ARTIFACTS_ENABLED', '');
        expect(await names(botClient(), admin(), 'world')).not.toContain('make_artifact');
        expect(await names(undefined, admin(), 'dm')).not.toContain('make_artifact');
    });

    it('in a bubble: asks Orbit for the person and the bubble, puts the card in nearby chat, and tells the model no address or code', async () => {
        const client = botClient();
        const orbit = admin();
        const [result] = await service()['executeToolCalls']([make], client as never, orbit as never, undefined, 'uuid-1', 'bubble-1', 'bot1', 7);
        expect(orbit.makeArtifact).toHaveBeenCalledWith(
            { botId: 'bot1', person: { signedIn: true, identifier: 'uuid-1', name: 'Khalid' }, chat: { kind: 'nearby', ref: 'bubble-1' } },
            expect.objectContaining({ title: 'Quests board', kind: 'app' })
        );
        expect(client.getPersonForArtifacts).toHaveBeenCalledWith(7);
        expect(client.sendChatMessage).toHaveBeenCalledWith('bubble-1', '::artifact:art-1:1::Quests board');
        expect(result.result).toEqual({ success: true, id: 'art-1', title: 'Quests board', kind: 'app', version: 1 });
    });

    it('in a direct message: asks as the signed-in person in their Matrix room, and keeps the card for the reply', async () => {
        const memory: Record<string, unknown> = { userUuid: 'uuid-9', playerName: 'Alice', dmRoomId: '!dm:matrix.test', pendingArtifacts: [] };
        const orbit = admin();
        const [result] = await service(memory)['executeToolCalls']([make], undefined, orbit as never, undefined, 'uuid-9', 'matrix-dm', 'bot1', -3);
        expect(orbit.makeArtifact).toHaveBeenCalledWith(
            { botId: 'bot1', person: { signedIn: true, identifier: 'uuid-9', name: 'Alice' }, chat: { kind: 'dm', ref: '!dm:matrix.test' } },
            expect.anything()
        );
        expect(memory.pendingArtifacts).toEqual([{ id: 'art-1', version: 1, title: 'Quests board', kind: 'app', maker: 'Scout' }]);
        expect(result.result).toMatchObject({ success: true });
    });

    it('in a direct message with no room known: makes nothing', async () => {
        const orbit = admin();
        const [result] = await service({ userUuid: 'uuid-9' })['executeToolCalls']([make], undefined, orbit as never, undefined, 'uuid-9', 'matrix-dm', 'bot1', -3);
        expect(result.result).toHaveProperty('error');
        expect(orbit.makeArtifact).not.toHaveBeenCalled();
    });

    it('puts a card for a change too, and none when Orbit refuses', async () => {
        const client = botClient();
        const change = { id: 't2', name: 'change_artifact', arguments: JSON.stringify({ id: 'art-1', edits: [{ old: 'a', new: 'b' }] }) };
        await service()['executeToolCalls']([change], client as never, admin() as never, undefined, 'uuid-1', 'bubble-1', 'bot1', 7);
        expect(client.sendChatMessage).toHaveBeenCalledWith('bubble-1', '::artifact:art-1:2::Quests board');

        client.sendChatMessage.mockClear();
        const refusing = admin({ changeArtifact: vi.fn(async () => { throw Object.assign(new Error('no'), { code: 'change_not_allowed' }); }) });
        const [refused] = await service()['executeToolCalls']([change], client as never, refusing as never, undefined, 'uuid-1', 'bubble-1', 'bot1', 7);
        expect(refused.result).toHaveProperty('error');
        expect(client.sendChatMessage).not.toHaveBeenCalled();
    });

    it('saves nothing from a reply that was cut off by its length cap, but still reads', async () => {
        const client = botClient();
        const orbit = admin();
        const args = [client as never, orbit as never, undefined, 'uuid-1', 'bubble-1', 'bot1', 7, undefined, undefined] as const;
        const change = { id: 't2', name: 'change_artifact', arguments: JSON.stringify({ id: 'art-1', content: '<h1>half' }) };
        const cutOff = await service()['executeToolCalls']([make, change], ...args, true);
        expect(cutOff.map((r) => r.result)).toEqual([{ error: expect.stringContaining('cut off') }, { error: expect.stringContaining('cut off') }]);
        expect(orbit.makeArtifact).not.toHaveBeenCalled();
        expect(orbit.changeArtifact).not.toHaveBeenCalled();
        expect(client.sendChatMessage).not.toHaveBeenCalled();

        const [listed] = await service()['executeToolCalls']([{ id: 't4', name: 'list_artifacts', arguments: '{}' }], ...args, true);
        expect(listed.result).toHaveProperty('artifacts');
    });

    it('answers a repeated make with what it did, not a second copy, when the turn is asked again', async () => {
        const memory: Record<string, unknown> = { userUuid: 'uuid-9', playerName: 'Alice', dmRoomId: '!dm:matrix.test', pendingArtifacts: [] };
        const orbit = admin();
        const ai = service(memory);
        const call = () => ai['executeToolCalls']([make], undefined, orbit as never, undefined, 'uuid-9', 'matrix-dm', 'bot1', -3);
        const [first] = await call();
        const [again] = await call();
        expect(again.result).toEqual(first.result);
        expect(orbit.makeArtifact).toHaveBeenCalledTimes(1);
        expect(memory.pendingArtifacts).toHaveLength(1);

        // The next turn is a new ask, even for the same file: it makes a new one
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const generate = ai.generateBotResponseStream.bind(ai);
        // Asking again for the same turn (a retry) keeps what the turn made; a new message starts clean
        await generate('bot1', -3, 'again', '', 'none', 'matrix-dm', '', undefined, undefined, undefined, undefined, 'dm', undefined, undefined, undefined, true).next().catch(() => undefined);
        expect((memory.artifactCalls as Map<string, unknown>).size).toBe(1);
        await generate('bot1', -3, 'a new message', '', 'none', 'matrix-dm', '').next().catch(() => undefined);
        expect((memory.artifactCalls as Map<string, unknown>).size).toBe(0);
        await call();
        expect(orbit.makeArtifact).toHaveBeenCalledTimes(2);
        expect(memory.pendingArtifacts).toHaveLength(2);

        // Another file is another make
        const other = { id: 't9', name: 'make_artifact', arguments: JSON.stringify({ title: 'Other', kind: 'page', content: '<p>y</p>' }) };
        await ai['executeToolCalls']([other], undefined, orbit as never, undefined, 'uuid-9', 'matrix-dm', 'bot1', -3);
        expect(orbit.makeArtifact).toHaveBeenCalledTimes(3);
    });

    it('does not remember a make that failed, so asking again tries again', async () => {
        const memory: Record<string, unknown> = { userUuid: 'uuid-9', playerName: 'Alice', dmRoomId: '!dm:matrix.test', pendingArtifacts: [] };
        const orbit = admin({ makeArtifact: vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({ artifact: summary, version: { number: 1, summary: null }, hidden: false }) });
        const ai = service(memory);
        const [failed] = await ai['executeToolCalls']([make], undefined, orbit as never, undefined, 'uuid-9', 'matrix-dm', 'bot1', -3);
        expect(failed.result).toHaveProperty('error');
        const [second] = await ai['executeToolCalls']([make], undefined, orbit as never, undefined, 'uuid-9', 'matrix-dm', 'bot1', -3);
        expect(second.result).toMatchObject({ success: true });
    });

    it('leaves a same-named tool to its MCP server when artifacts are off', async () => {
        vi.stubEnv('BOT_ARTIFACTS_ENABLED', '');
        const orbit = admin();
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue({ ok: true } as never);
        const toolServerMap = new Map([['list_artifacts', { serverId: 's1', serverUrl: 'https://mcp.test', authType: 'none', authConfig: {}, headers: {} }]]);
        const [result] = await service()['executeToolCalls']([{ id: 't5', name: 'list_artifacts', arguments: '{}' }], botClient() as never, orbit as never, toolServerMap as never, 'uuid-1', 'bubble-1', 'bot1', 7);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(result.result).toEqual({ ok: true });
        expect(orbit.listArtifactsInChat).not.toHaveBeenCalled();
    });

    it('turns a result into the line the model reads, and keeps the media interceptors away from it', async () => {
        const ai = service();
        const results = [{ id: 't1', name: 'list_artifacts', result: { artifacts: [{ id: 'art-1', title: 'T', kind: 'app', version: 1, madeBy: 'Scout' }] } }];
        expect(ai['formatToolResults'](results)).toContain('(id art-1, app, version 1, by Scout)');
        // A result with a link in it would be sent as media; artifact results are left alone
        const client = botClient();
        const withLink = [{ id: 't3', name: 'read_artifact', result: { id: 'a', content: 'see https://example.com/pic.png' } }];
        await ai['autoSendMedia'](withLink, client as never, 'bubble-1', new Set(), 'bot1', 7, new Set());
        expect(client.sendImage).not.toHaveBeenCalled();
        const botMemory = { pendingMedia: [] as unknown[], maxPendingMedia: 5 };
        service(botMemory)['preQueueToolResults'](withLink, new Set(), 'bot1', 7);
        expect(botMemory.pendingMedia).toEqual([]);
    });
});
