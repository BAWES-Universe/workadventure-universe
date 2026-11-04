/**
 * A tool that makes new things, as AIService runs it (game #1662): it runs right away until a request would make more than
 * the bot's "Asks before making more than" number, then one card shows the total.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIService } from '../ai/AIService';
import { MCPConnector } from '../mcp/MCPConnector';
import { MakeCounts } from '../mcp/ToolQuantity';

vi.mock('../client/BotClient', () => ({ BotClient: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

const SERVERS = new Map([
    [
        'make_images',
        { serverId: 's1', serverUrl: 'https://mcp.example', authType: 'none', fingerprint: 'fp-img', title: 'Make images', serverName: 'Poster Studio', inputSchema: { type: 'object', properties: { prompt: { type: 'string' }, n: { type: 'integer' } } } },
    ],
    ['make_track', { serverId: 's2', serverUrl: 'https://mcp.example', authType: 'none', fingerprint: 'fp-trk', title: 'Make a track', serverName: 'Suno', inputSchema: { type: 'object', properties: { prompt: { type: 'string' } } } }],
]);
const RUN = { kind: 'run', heading: 'makesNew', policyRevision: 3, fingerprint: 'fp-img' };
const memory = { getMemory: () => ({ userUuid: 'uuid-sara', dmRoomId: '!dm:matrix.test', playerName: 'Sara' }) };
const WAITING = { kind: 'waiting', result: { status: 'waiting_for_ok', message: 'A card was shown.' } };

function setup(options: { limit?: number | null; verdict?: unknown; mem?: unknown } = {}) {
    const service = new AIService((options.mem ?? memory) as never, null!, '');
    service['toolGate'] = { decide: async () => options.verdict ?? RUN, offers: async () => true } as never;
    const counts = new MakeCounts();
    const propose = vi.fn(async () => WAITING);
    service.useApprovals({
        propose,
        settings: async () => ({ cardWaitMinutes: 10, askWhichWay: 'rarely', askBeforeMaking: options.limit === undefined ? 5 : options.limit }),
        reserveMake: (_b: string, _r: string, person: { uuid: string }, count: number, limit: number) => counts.reserve(person.uuid, count, limit),
        releaseMake: (_b: string, _r: string, person: { uuid: string }, count: number, epoch?: number) => counts.release(person.uuid, count, epoch),
    } as never);
    return { service, propose, counts };
}
const call = (service: AIService, name: string, args: Record<string, unknown>) =>
    service['executeToolCalls']([{ id: 'c1', name, arguments: JSON.stringify(args) }], undefined, undefined, SERVERS as never, undefined, undefined, 'b1', 7);

describe('making new things', () => {
    it('runs right away up to the limit', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const { service, propose } = setup();
        const [result] = await call(service, 'make_images', { prompt: 'a', n: 5 });
        expect(result.result).toBe('done');
        expect(execute).toHaveBeenCalledTimes(1);
        expect(propose).not.toHaveBeenCalled();
    });

    it('shows one card with the total when a request would make more than the limit, and makes nothing yet', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const { service, propose } = setup();
        const [result] = await call(service, 'make_images', { prompt: 'a', n: 12 });
        expect(execute).not.toHaveBeenCalled();
        expect(result.result).toEqual(WAITING.result);
        expect(propose).toHaveBeenCalledWith(
            expect.objectContaining({
                toolName: 'make_images',
                args: { prompt: 'a', n: 12 },
                batch: { kind: 'over', count: 12, unit: 'images', limit: 5 },
                decision: { kind: 'ask', heading: 'makesNew', notReviewed: false, policyRevision: 3, fingerprint: 'fp-img' },
            })
        );
    });

    it('counts the whole request: the step that crosses the limit pauses, and says how many were made', async () => {
        vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const { service, propose } = setup();
        expect((await call(service, 'make_images', { prompt: 'a', n: 4 }))[0].result).toBe('done');
        await call(service, 'make_images', { prompt: 'b', n: 2 });
        expect(propose).toHaveBeenCalledWith(expect.objectContaining({ batch: { kind: 'part', count: 2, unit: 'images', limit: 5, soFar: 4, names: { one: 'image', many: 'images' } } }));
    });

    it('names one image in the singular and the rest in the plural when a request pauses part-way', async () => {
        vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const { service, propose } = setup();
        await call(service, 'make_images', { prompt: 'a', n: 5 });
        await call(service, 'make_images', { prompt: 'b', n: 1 });
        const batch = (propose.mock.calls[0] as unknown as [{ batch: { names: unknown } }])[0].batch;
        expect(batch.names).toEqual({ one: 'image', many: 'images' });
    });

    it('does not count a call that proved it made nothing', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall');
        const { service, propose, counts } = setup();
        execute.mockResolvedValueOnce({ error: 'The server refused it.', outcome: 'not_sent' } as never);
        await call(service, 'make_images', { prompt: 'a', n: 5 });
        expect(counts.soFar('uuid-sara')).toBe(0);
        // The five that did not get made still fit
        execute.mockResolvedValueOnce('done' as never);
        const [again] = await call(service, 'make_images', { prompt: 'a', n: 5 });
        expect(again.result).toBe('done');
        expect(propose).not.toHaveBeenCalled();
    });

    it('keeps counting a call that may have made things', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall');
        const { service, counts } = setup();
        execute.mockResolvedValueOnce({ error: 'No answer came back.' } as never);
        await call(service, 'make_images', { prompt: 'a', n: 5 });
        expect(counts.soFar('uuid-sara')).toBe(5);
    });

    it('makes one image right away', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const { service, propose } = setup();
        await call(service, 'make_images', { prompt: 'a', n: 1 });
        expect(execute).toHaveBeenCalledTimes(1);
        expect(propose).not.toHaveBeenCalled();
    });

    it('asks every time for a tool that does not say how many while a limit is set', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const { service, propose } = setup({ verdict: { ...RUN, fingerprint: 'fp-trk' } });
        await call(service, 'make_track', { prompt: 'jazz' });
        expect(execute).not.toHaveBeenCalled();
        expect(propose).toHaveBeenCalledWith(expect.objectContaining({ batch: { kind: 'unknown', toolTitle: 'Make a track', serverName: 'Suno' } }));
    });

    it('asks nothing when the limit is No limit', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const { service, propose } = setup({ limit: null });
        await call(service, 'make_images', { prompt: 'a', n: 500 });
        await call(service, 'make_track', { prompt: 'jazz' });
        expect(execute).toHaveBeenCalledTimes(2);
        expect(propose).not.toHaveBeenCalled();
    });

    it('does not count what looks things up or changes things', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const { service, propose } = setup({ verdict: { ...RUN, heading: 'looksUp' } });
        await call(service, 'make_images', { prompt: 'a', n: 50 });
        expect(execute).toHaveBeenCalledTimes(1);
        expect(propose).not.toHaveBeenCalled();
    });

    it('does not run an amount over the limit for a person nobody can ask, and runs an unknown one as before', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const guest = { getMemory: () => ({ userUuid: undefined, dmRoomId: '!dm:matrix.test' }) };
        const { service, propose } = setup({ mem: guest });
        const [big] = await call(service, 'make_images', { prompt: 'a', n: 12 });
        expect(big.result.error).toContain('12 images');
        expect(big.result.error).toContain('OK');
        expect(execute).not.toHaveBeenCalled();
        const [unknown] = await call(service, 'make_track', { prompt: 'jazz' });
        expect(unknown.result).toBe('done');
        expect(propose).not.toHaveBeenCalled();
    });

    it('does not run a count nobody can read for a person nobody can ask', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const guest = { getMemory: () => ({ userUuid: undefined, dmRoomId: '!dm:matrix.test' }) };
        const { service, propose } = setup({ mem: guest });
        const [huge] = await call(service, 'make_images', { prompt: 'a', n: 1_000_000 });
        expect(huge.result.error).toContain('could not be read');
        expect(execute).not.toHaveBeenCalled();
        expect(propose).not.toHaveBeenCalled();
    });

    it('lets the tool run when the count can not be checked', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const { service } = setup();
        service['approvals'] = { settings: async () => { throw new Error('down'); } } as never;
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const [result] = await call(service, 'make_images', { prompt: 'a', n: 12 });
        expect(result.result).toBe('done');
        expect(execute).toHaveBeenCalledTimes(1);
    });
});
