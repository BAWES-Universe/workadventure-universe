/**
 * The check right before a tool server's tool runs, as AIService uses it (game #1656): a call the gate does not let
 * through never reaches the tool server, and the model is not offered a tool this person can't use.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIService } from '../ai/AIService';
import { MCPConnector } from '../mcp/MCPConnector';

vi.mock('../client/BotClient', () => ({ BotClient: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

const SERVERS = new Map([
    ['lookup', { serverId: 's1', serverUrl: 'https://mcp.example', authType: 'none', fingerprint: 'fp-lookup', title: 'Look something up' }],
    ['remove', { serverId: 's1', serverUrl: 'https://mcp.example', authType: 'none', fingerprint: 'fp-remove' }],
]);

function serviceWith(decide: (call: any) => unknown) {
    const service = new AIService(null!, null!, '');
    const decideSpy = vi.fn(async (call: unknown) => decide(call));
    service['toolGate'] = { decide: decideSpy, offers: async (call: unknown) => (await decideSpy(call) as { kind: string }).kind !== 'refuse' } as never;
    return { service, decide: decideSpy };
}

const run = (service: AIService, name: string) =>
    service['executeToolCalls']([{ id: 'c1', name, arguments: '{"x":1}' }], undefined, undefined, SERVERS as never, undefined, undefined, 'b1', 7);

describe('executeToolCalls with the gate', () => {
    it('runs a call the gate lets through', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const { service, decide } = serviceWith(() => ({ kind: 'run' }));
        const [result] = await run(service, 'lookup');
        expect(result.result).toBe('done');
        expect(execute).toHaveBeenCalledTimes(1);
        expect(decide).toHaveBeenCalledWith(expect.objectContaining({ botId: 'b1', toolName: 'lookup', serverId: 's1', fingerprint: 'fp-lookup', toolTitle: 'Look something up', voice: false }));
    });

    it('never starts a call the gate refuses, and tells the model the line as it is', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const { service } = serviceWith(() => ({ kind: 'refuse', why: 'no_permission', line: "You can't delete or send things here." }));
        const [result] = await run(service, 'remove');
        expect(execute).not.toHaveBeenCalled();
        expect(result.result.error).toContain("You can't delete or send things here.");
    });

    it('does not run a call that needs a card when there is no card to show', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const { service } = serviceWith(() => ({ kind: 'ask', heading: 'deletesOrSends', notReviewed: false, policyRevision: 3, fingerprint: 'fp-remove' }));
        const [result] = await run(service, 'remove');
        expect(execute).not.toHaveBeenCalled();
        expect(result.result.error).toContain('OK');
        expect(result.result.error).toContain('directly');
    });

    it('checks each call of a batch on its own, before any starts', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const { service } = serviceWith((call: { toolName: string }) => (call.toolName === 'remove' ? { kind: 'refuse', why: 'off', line: 'Off.' } : { kind: 'run' }));
        const results = await service['executeToolCalls'](
            [{ id: 'c1', name: 'lookup', arguments: '{}' }, { id: 'c2', name: 'remove', arguments: '{}' }],
            undefined, undefined, SERVERS as never, undefined, undefined, 'b1', 7
        );
        expect(execute).toHaveBeenCalledTimes(1);
        expect(results.find((r) => r.id === 'c2')!.result.error).toContain('Off.');
        expect(results.find((r) => r.id === 'c1')!.result).toBe('done');
    });

    it('lets nothing through without a bot to check it for', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const { service } = serviceWith(() => ({ kind: 'run' }));
        const [result] = await service['executeToolCalls']([{ id: 'c1', name: 'lookup', arguments: '{}' }], undefined, undefined, SERVERS as never);
        expect(execute).not.toHaveBeenCalled();
        expect(result.result.error).toBeTruthy();
    });

    it('tells the gate a voice bot is speaking', async () => {
        vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const { service, decide } = serviceWith(() => ({ kind: 'run' }));
        const botClient = { isVoiceBot: () => true, getPersonForArtifacts: () => ({ signedIn: true, identifier: 'mishari', name: 'Mishari' }) };
        await service['executeToolCalls']([{ id: 'c1', name: 'lookup', arguments: '{}' }], botClient as never, undefined, SERVERS as never, undefined, 'room', 'b1', 7);
        expect(decide).toHaveBeenCalledWith(expect.objectContaining({ voice: true, person: { signedIn: true, identifier: 'mishari' } }));
    });
});

describe('who the gate is told is asking', () => {
    it('is a guest when the bubble does not know the person, and the same person in a direct message', () => {
        const service = new AIService({ getMemory: () => ({ userUuid: 'u-1', dmRoomId: '!room:chat', playerName: 'Nora' }) } as never, null!, '');
        expect(service['gatePerson']('b1', 7)).toEqual({ signedIn: true, identifier: 'u-1' });
        const guest = { getPersonForArtifacts: () => ({ signedIn: false, identifier: null, name: null }) };
        expect(service['gatePerson']('b1', 7, guest as never, 'room')).toEqual({ signedIn: false });
        expect(service['gatePerson'](undefined, undefined)).toEqual({ signedIn: false });
    });

    it('is a guest when the person can not be told', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const service = new AIService(null!, null!, '');
        const broken = { getPersonForArtifacts: () => { throw new Error('no'); } };
        expect(service['gatePerson']('b1', 7, broken as never, 'room')).toEqual({ signedIn: false });
    });
});

describe('the tool list the model is offered', () => {
    it('leaves out a tool the gate refuses, but keeps it known so a forged call meets the same check', async () => {
        const defs = ['lookup', 'remove'].map((name) => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } }));
        vi.spyOn(MCPConnector, 'discoverToolsWithMapping').mockResolvedValue({ tools: defs, toolServerMap: SERVERS } as never);
        const { service } = serviceWith((call: { toolName: string }) => (call.toolName === 'remove' ? { kind: 'refuse', why: 'no_permission', line: 'no' } : { kind: 'run' }));
        const admin = { isConfigured: () => true, adminApiToken: 't' };
        const { tools, toolServerMap } = await service['buildTools']('b1', undefined, admin as never, 'dm', undefined, { signedIn: true, identifier: 'mishari' });
        const names = tools.map((tool: { function: { name: string } }) => tool.function.name);
        expect(names).toContain('lookup');
        expect(names).not.toContain('remove');
        expect(toolServerMap.has('remove')).toBe(true);
    });

    it('offers a tool that asks first, since the card comes when it is called', async () => {
        const defs = [{ type: 'function', function: { name: 'remove', description: 'x', parameters: { type: 'object', properties: {} } } }];
        vi.spyOn(MCPConnector, 'discoverToolsWithMapping').mockResolvedValue({ tools: defs, toolServerMap: SERVERS } as never);
        const { service } = serviceWith(() => ({ kind: 'ask', heading: 'deletesOrSends', notReviewed: false, policyRevision: 1, fingerprint: 'fp-remove' }));
        const { tools } = await service['buildTools']('b1', undefined, { isConfigured: () => true } as never, 'dm', undefined, { signedIn: true, identifier: 'mishari' });
        expect(tools.map((tool: { function: { name: string } }) => tool.function.name)).toContain('remove');
    });
});

describe('a call that needs the OK, in a direct message (#1657)', () => {
    const ASK = { kind: 'ask', heading: 'deletesOrSends', notReviewed: false, policyRevision: 3, fingerprint: 'fp-remove' };
    const memory = { getMemory: () => ({ userUuid: 'uuid-sara', dmRoomId: '!dm:matrix.test', playerName: 'Sara' }) };

    function dmService(proposed: unknown) {
        const service = new AIService(memory as never, null!, '');
        service['toolGate'] = { decide: async () => ASK, offers: async () => true } as never;
        const propose = vi.fn(async () => proposed);
        service.useApprovals({ propose } as never);
        return { service, propose };
    }
    const callRemove = (service: AIService, botClient?: unknown) =>
        service['executeToolCalls']([{ id: 'c1', name: 'remove', arguments: '{"id":"7"}' }], botClient as never, undefined, SERVERS as never, undefined, undefined, 'b1', 7);

    it('shows the card, does not run the call, and tells the model it is waiting', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const waiting = { status: 'waiting_for_ok', message: 'A card was shown.' };
        const { service, propose } = dmService({ kind: 'waiting', result: waiting });
        const [result] = await callRemove(service);
        expect(execute).not.toHaveBeenCalled();
        expect(result.result).toEqual(waiting);
        expect(propose).toHaveBeenCalledWith({
            botId: 'b1',
            roomId: '!dm:matrix.test',
            person: { uuid: 'uuid-sara', name: 'Sara' },
            toolName: 'remove',
            entry: SERVERS.get('remove'),
            args: { id: '7' },
            decision: ASK,
        });
    });

    it('runs the call when a remembered approval covers it', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const { service } = dmService({ kind: 'run' });
        const [result] = await callRemove(service);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls[0][3]).toEqual({ id: '7' });
        expect(result.result).toBe('done');
    });

    it('does not run the call when the card could not be shown', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const { service } = dmService({ kind: 'failed', result: { error: 'The card could not be shown.' } });
        const [result] = await callRemove(service);
        expect(execute).not.toHaveBeenCalled();
        expect(result.result.error).toContain('could not be shown');
    });

    it('does not ask without the cards set up', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const bare = new AIService(memory as never, null!, '');
        bare['toolGate'] = { decide: async () => ASK, offers: async () => true } as never;
        const [without] = await callRemove(bare);
        expect(without.result.error).toContain('directly');
        expect(execute).not.toHaveBeenCalled();
    });
    it('does not ask for a person who is not signed in', async () => {
        const guest = { getMemory: () => ({ userUuid: undefined, dmRoomId: '!dm:matrix.test' }) };
        const service = new AIService(guest as never, null!, '');
        service['toolGate'] = { decide: async () => ASK, offers: async () => true } as never;
        const propose = vi.fn();
        service.useApprovals({ propose } as never);
        const [result] = await callRemove(service);
        expect(propose).not.toHaveBeenCalled();
        expect(result.result.error).toContain('directly');
    });
});

describe('a call that needs the OK, in a bubble (#1658)', () => {
    const ASK = { kind: 'ask', heading: 'deletesOrSends', notReviewed: false, policyRevision: 3, fingerprint: 'fp-remove' };
    const person = (over: Record<string, unknown> = {}) => ({
        isVoiceBot: () => false,
        getPersonForArtifacts: () => ({ signedIn: true, identifier: 'uuid-khalid', name: 'Khalid', ...over }),
    });

    function bubbleService(proposed: unknown, extra: Record<string, unknown> = {}) {
        const service = new AIService(null!, null!, '');
        service['toolGate'] = { decide: async () => ASK, offers: async () => true } as never;
        const propose = vi.fn(async () => proposed);
        service.useApprovals({ propose, ...extra } as never);
        return { service, propose };
    }
    const callRemove = (service: AIService, botClient: unknown) =>
        service['executeToolCalls']([{ id: 'c1', name: 'remove', arguments: '{"id":"7"}' }], botClient as never, undefined, SERVERS as never, undefined, 'room#bubble', 'b1', 7);

    it('shows the card to the person alone, runs nothing, and carries the line everyone reads', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const waiting = { status: 'waiting_for_ok', message: 'A card was shown.' };
        const { service, propose } = bubbleService({ kind: 'waiting', result: waiting, line: 'Khalid, I need your OK to remove something.' });
        const [result] = await callRemove(service, person());
        expect(execute).not.toHaveBeenCalled();
        expect(result.result).toEqual({ ...waiting, sharedLine: 'Khalid, I need your OK to remove something.' });
        expect(propose).toHaveBeenCalledWith(
            expect.objectContaining({ botId: 'b1', roomId: 'room#bubble', person: { uuid: 'uuid-khalid', name: 'Khalid', playerId: 7 }, toolName: 'remove', args: { id: '7' } })
        );
    });

    it('runs the call when a remembered approval covers it', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const { service } = bubbleService({ kind: 'run' });
        const [result] = await callRemove(service, person());
        expect(execute).toHaveBeenCalledTimes(1);
        expect(result.result).toBe('done');
    });

    it('does not ask a guest, who has no card, and does not run the call', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const { service, propose } = bubbleService({ kind: 'run' });
        const [result] = await callRemove(service, person({ signedIn: false, identifier: null }));
        expect(propose).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
        expect(result.result.error).toContain('directly');
    });

    it('does not run the call when the card could not be shown', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const { service } = bubbleService({ kind: 'failed', result: { error: 'The card could not be shown.' } });
        const [result] = await callRemove(service, person());
        expect(execute).not.toHaveBeenCalled();
        expect(result.result.error).toContain('could not be shown');
    });

    it('says only the line, with no tokens spent, as the reply after a card was shown', async () => {
        const service = new AIService(null!, null!, '');
        const chunks: unknown[] = [];
        for await (const chunk of service['saySharedLine']('Khalid, I need your OK to remove something.')) chunks.push(chunk);
        expect(chunks).toEqual([
            { content: 'Khalid, I need your OK to remove something.', done: false, metadata: undefined },
            { content: '', done: true, metadata: { tokensUsed: 0, promptTokens: 0, completionTokens: 0 } },
        ]);
    });
});

describe('what a person says while their card waits in a bubble (#1658)', () => {
    const bubble = { isVoiceBot: () => false, getPersonForArtifacts: () => ({ signedIn: true, identifier: 'uuid-khalid', name: 'Khalid' }) };
    const person = { uuid: 'uuid-khalid', name: 'Khalid', playerId: 7 };

    function waitingService(label: string | undefined, said: string | Error) {
        const service = new AIService(null!, null!, '');
        const approvals = {
            touch: vi.fn(),
            waitingLabel: vi.fn(() => label),
            replyPrivately: vi.fn(async () => undefined),
            onPersonMessage: vi.fn(async () => undefined),
        };
        service.useApprovals(approvals as never);
        const quick = vi.spyOn(service, 'quickGenerate').mockImplementation(async () => {
            if (said instanceof Error) throw said;
            return said;
        });
        return { service, approvals, quick };
    }
    const ask = (service: AIService, text: string) => service['whileCardWaits']('b1', 7, text, 'prov', 'room#bubble', bubble as never);

    it('answers a yes to them alone, never sends, and ends the turn', async () => {
        const { service, approvals } = waitingService('Send email', 'CONFIRM');
        expect(await ask(service, 'Yes, send it')).toBe(true);
        expect(approvals.replyPrivately).toHaveBeenCalledWith('b1', 'room#bubble', person, expect.stringContaining('Tap Send email on the card'));
        expect(approvals.onPersonMessage).not.toHaveBeenCalled();
    });

    it('closes the card on anything else and lets the turn go on', async () => {
        const { service, approvals } = waitingService('Send email', 'OTHER');
        expect(await ask(service, 'Make it the 21st instead')).toBe(false);
        expect(approvals.onPersonMessage).toHaveBeenCalledWith('b1', 'room#bubble', person);
        expect(approvals.replyPrivately).not.toHaveBeenCalled();
    });

    it('does not take a slow or failed answer for a yes', async () => {
        const { service, approvals } = waitingService('Send email', new Error('timeout'));
        expect(await ask(service, 'yes')).toBe(false);
        expect(approvals.replyPrivately).not.toHaveBeenCalled();
        expect(approvals.onPersonMessage).toHaveBeenCalled();
    });

    it('asks nothing of the AI when no card waits', async () => {
        const { service, quick, approvals } = waitingService(undefined, 'CONFIRM');
        expect(await ask(service, 'hello')).toBe(false);
        expect(quick).not.toHaveBeenCalled();
        expect(approvals.onPersonMessage).not.toHaveBeenCalled();
    });

    it('leaves a guest alone', async () => {
        const { service, quick } = waitingService('Send email', 'CONFIRM');
        const guest = { getPersonForArtifacts: () => ({ signedIn: false, identifier: null, name: 'Guest' }) };
        expect(await service['whileCardWaits']('b1', 7, 'yes', 'prov', 'room#bubble', guest as never)).toBe(false);
        expect(quick).not.toHaveBeenCalled();
    });
});

describe('runApprovedTool', () => {
    it('runs a call a person approved with the arguments that were saved and the bot\'s own Patience', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue([{ type: 'text', text: 'ok' }] as never);
        const service = new AIService(null!, null!, '');
        const result = await service.runApprovedTool('b1', SERVERS.get('remove') as never, 'remove', { id: '7' }, 'uuid-sara', 120);
        expect(result).toEqual([{ type: 'text', text: 'ok' }]);
        expect(execute.mock.calls[0][1]).toBe('https://mcp.example');
        expect(execute.mock.calls[0][3]).toEqual({ id: '7' });
        expect(execute.mock.calls[0][7]).toBe('uuid-sara');
        expect(execute.mock.calls[0][9]).toBe(120_000);
    });

    it('answers an error, not a throw, when the call blows up', async () => {
        vi.spyOn(MCPConnector, 'executeToolCall').mockRejectedValue(new Error('boom'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const service = new AIService(null!, null!, '');
        const result = await service.runApprovedTool('b1', SERVERS.get('remove') as never, 'remove', {}, 'u', null);
        expect(result).toEqual({ error: 'MCP tool error: boom' });
    });
});
