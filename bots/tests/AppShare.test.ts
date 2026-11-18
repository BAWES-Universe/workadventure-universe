/**
 * Other people asking a Brick for a job from its owner's App (game #2006, Orbit #950). Plan checks 23, 31, 32, 52, 54.
 *
 * The bot server offers someone else only the jobs the owner picked, with only the inputs they picked, asks Orbit with the job and
 * the names of the inputs on every ask, holds what comes back to the fields the owner picked, and tells Orbit what each try came to:
 * a use is given back only for a failure that is sure. A timeout is no refund and no reason to run it again.
 */
import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIService } from '../ai/AIService';
import {
    alreadyAskedLine,
    appNotUsedLine,
    askOrbitAboutAppUse,
    narrowToReturns, SHARED_FAILED_LINE,
    sayOwnerNote,
    withStructured,
    ownerNoteText,
    settleOutcomeOf,
    settleWithOrbit,
    useBody,
    type AppUseCheck,
    type AppUseSettle,
} from '../mcp/AppUse';
import { MCPConnector, narrowedToInputs, type ToolServerEntry } from '../mcp/MCPConnector';

vi.mock('../client/BotClient', () => ({ BotClient: vi.fn() }));

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

const SIDE = { adminApiUrl: 'https://orbit.example', serviceToken: 'svc' };

describe('what Orbit is sent when someone else asks', () => {
    it('sends the job and the names of the inputs, never their values', () => {
        expect(useBody({ callId: 'c1', heading: 'makesNew', requesterKey: 'u-1', tool: 'make_song', argumentNames: ['style', 'seconds'] })).toEqual({
            callId: 'c1',
            heading: 'make',
            requesterKey: 'u-1',
            tool: 'make_song',
            argumentNames: ['style', 'seconds'],
        });
        expect(JSON.stringify(useBody({ callId: 'c1', tool: 't', argumentNames: ['x'] }))).not.toContain('oud');
    });

    it('hands back which fields may come back, and when the day is back', async () => {
        vi.spyOn(axios, 'post').mockResolvedValueOnce({ status: 200, data: { allowed: true, viaConnection: true, shared: { returns: ['audio_url'] } } });
        expect(await askOrbitAboutAppUse(() => SIDE)('b', 's', { callId: 'c' })).toEqual({ allowed: true, shared: { returns: ['audio_url'] } });
        vi.spyOn(axios, 'post').mockResolvedValueOnce({ status: 200, data: { allowed: true, shared: { returns: null } } });
        expect(await askOrbitAboutAppUse(() => SIDE)('b', 's', { callId: 'c' })).toEqual({ allowed: true, shared: { returns: null } });
        vi.spyOn(axios, 'post').mockResolvedValueOnce({ status: 200, data: { allowed: false, reason: 'limit_reached', resetsAt: '2026-11-18T00:00:00.000Z' } });
        expect(await askOrbitAboutAppUse(() => SIDE)('b', 's', { callId: 'c' })).toEqual({ allowed: false, reason: 'limit_reached', resetsAt: '2026-11-18T00:00:00.000Z' });
    });

    it('reads every refusal Orbit gives for a shared ask', async () => {
        for (const reason of ['not_shared', 'busy', 'already_asked', 'limit_reached', 'incomplete']) {
            vi.spyOn(axios, 'post').mockResolvedValueOnce({ status: 200, data: { allowed: false, reason, earlier: 'unknown' } });
            const answer = await askOrbitAboutAppUse(() => SIDE)('b', 's', { callId: 'c' });
            expect(answer).toMatchObject({ allowed: false, reason });
        }
        vi.spyOn(axios, 'post').mockResolvedValueOnce({ status: 200, data: { allowed: false, reason: 'already_asked', earlier: 'unknown' } });
        expect(await askOrbitAboutAppUse(() => SIDE)('b', 's', { callId: 'c' })).toEqual({ allowed: false, reason: 'already_asked', earlier: 'unknown' });
    });

    it('reads the day Orbit says ran out, and nothing else as a day', async () => {
        const base = { matrixUserId: '@u:m', appName: 'A', botName: 'B', limit: 5, connectionId: 'c' };
        vi.spyOn(axios, 'post').mockResolvedValueOnce({ status: 200, data: { allowed: true, shared: { returns: null }, ownerNote: { ...base, day: '2026-11-18' } } });
        expect((await askOrbitAboutAppUse(() => SIDE)('b', 's', { callId: 'c' })).ownerNote).toEqual({ ...base, day: '2026-11-18' });
        vi.spyOn(axios, 'post').mockResolvedValueOnce({ status: 200, data: { allowed: true, shared: { returns: null }, ownerNote: { ...base, day: 'yesterday' } } });
        expect((await askOrbitAboutAppUse(() => SIDE)('b', 's', { callId: 'c' })).ownerNote).toEqual(base);
    });

    it('does not take a missing word about what may come back as "everything"', async () => {
        for (const shared of [undefined, {}, { returns: undefined }]) {
            vi.spyOn(axios, 'post').mockResolvedValueOnce({ status: 200, data: { allowed: true, shared } });
            expect(await askOrbitAboutAppUse(() => SIDE)('b', 's', { callId: 'c' })).toEqual({ allowed: true });
        }
    });

    it('takes an answer it cannot read about what may come back as "nothing may come back"', async () => {
        vi.spyOn(axios, 'post').mockResolvedValueOnce({ status: 200, data: { allowed: true, shared: { returns: 'everything' } } });
        expect(await askOrbitAboutAppUse(() => SIDE)('b', 's', { callId: 'c' })).toEqual({ allowed: true, shared: { returns: [] } });
    });
});

describe('what a shared try came to', () => {
    it('is "done" for an answer', () => {
        expect(settleOutcomeOf([{ type: 'text', text: 'song' }])).toBe('done');
        expect(settleOutcomeOf({ ok: true })).toBe('done');
        expect(settleOutcomeOf('plain text')).toBe('done');
    });

    it('is "failed" only when it provably never ran or the App itself said it failed', () => {
        expect(settleOutcomeOf({ error: "Couldn't reach it. Nothing ran", outcome: 'not_sent' })).toBe('failed');
        expect(settleOutcomeOf({ error: 'Tool error: no such style', outcome: 'failed' })).toBe('failed');
    });

    it('is "unknown" for a timeout, a lost or empty answer, a cancel in flight, or anything it cannot tell', () => {
        expect(settleOutcomeOf({ error: 'No answer. May have finished', outcome: 'uncertain' })).toBe('unknown');
        expect(settleOutcomeOf({ error: 'Empty answer. May have finished', outcome: 'uncertain' })).toBe('unknown');
        expect(settleOutcomeOf({ error: 'Tool call cancelled: make_song', outcome: 'uncertain', cancelled: true })).toBe('unknown');
        expect(settleOutcomeOf({ error: 'MCP tool error: boom' })).toBe('unknown');
    });
});

describe('telling Orbit what a try came to', () => {
    it('posts the call id and the outcome to the settle route with the service token', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({ status: 200, data: { status: 'done' } });
        expect(await settleWithOrbit(() => SIDE)('bot 1', 'srv/1', 'call-1', 'failed')).toBe(true);
        expect(post.mock.calls[0][0]).toBe('https://orbit.example/api/bots/bot%201/mcp-servers/srv%2F1/use/settle');
        expect(post.mock.calls[0][1]).toEqual({ callId: 'call-1', outcome: 'failed' });
        expect((post.mock.calls[0][2] as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer svc');
    });

    it('takes "already ended the other way" and "no such try" as settled', async () => {
        vi.spyOn(axios, 'post').mockResolvedValueOnce({ status: 409, data: {} });
        expect(await settleWithOrbit(() => SIDE)('b', 's', 'c', 'failed')).toBe(true);
        vi.spyOn(axios, 'post').mockResolvedValueOnce({ status: 404, data: {} });
        expect(await settleWithOrbit(() => SIDE)('b', 's', 'c', 'done')).toBe(true);
    });

    it('never throws when Orbit cannot be told', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(axios, 'post').mockRejectedValue(new Error('down'));
        expect(await settleWithOrbit(() => SIDE)('b', 's', 'c', 'done')).toBe(false);
        expect(await settleWithOrbit(() => null)('b', 's', 'c', 'done')).toBe(false);
    });
});

describe('holding what comes back to what the owner picked', () => {
    const song = { type: 'text', text: JSON.stringify({ audio_url: 'https://x/song.mp3', owner_email: 'khalid@example.com', prompt: 'oud' }) };

    it('keeps only the picked fields of a JSON answer', () => {
        expect(narrowToReturns([song], ['audio_url'])).toEqual([{ type: 'text', text: JSON.stringify({ audio_url: 'https://x/song.mp3' }) }]);
    });

    it('holds fields inside lists too', () => {
        const list = { type: 'text', text: JSON.stringify({ songs: [{ audio_url: 'a', secret: 's' }] }) };
        expect(narrowToReturns([list], ['songs'])).toEqual([{ type: 'text', text: JSON.stringify({ songs: [{ audio_url: 'a', secret: 's' }] }) }]);
        expect(narrowToReturns([{ type: 'text', text: JSON.stringify([{ audio_url: 'a', secret: 's' }]) }], ['audio_url'])).toEqual([{ type: 'text', text: JSON.stringify([{ audio_url: 'a' }]) }]);
    });

    it('gives nothing that cannot be held to fields: plain words, a file, a picture', () => {
        expect(narrowToReturns([{ type: 'text', text: 'Here is the whole account: ...' }, { type: 'image', data: 'AAAA' }], ['audio_url'])).toEqual([]);
    });

    it('withholds bare words and numbers in a list, since no picked field covers them', () => {
        expect(narrowToReturns([{ type: 'text', text: JSON.stringify(['a@example.com', 'b@example.com']) }], [])).toEqual([{ type: 'text', text: '[]' }]);
        expect(narrowToReturns([{ type: 'text', text: JSON.stringify(['x', { title: 't', url: 'u' }, 3]) }], ['title'])).toEqual([{ type: 'text', text: JSON.stringify([{ title: 't' }]) }]);
    });

    it('uses the data an App gave beside its prose, held to the picked fields', () => {
        const prose = withStructured([{ type: 'text', text: 'Here is your song!' }], { audio_url: 'https://x/s.mp3', owner_email: 'o@x.com' });
        expect(narrowToReturns(prose, ['audio_url'])).toEqual([{ type: 'text', text: JSON.stringify({ audio_url: 'https://x/s.mp3' }) }]);
        // Prose alone, with no data kept aside, is still withheld
        expect(narrowToReturns([{ type: 'text', text: 'Here is your song!' }], ['audio_url'])).toEqual([]);
        // When a text item holds the fields, that is what is used
        const both = withStructured([{ type: 'text', text: JSON.stringify({ audio_url: 'a', secret: 's' }) }], { audio_url: 'b', secret: 't' });
        expect(narrowToReturns(both, ['audio_url'])).toEqual([{ type: 'text', text: JSON.stringify({ audio_url: 'a' }) }]);
    });

    it('says what came of a first try only when Orbit said so, and "may have worked" when it did not', () => {
        expect(alreadyAskedLine('refunded', { app: 'ACE-Step' })).toContain('nothing was used up');
        for (const earlier of [undefined, 'something new']) {
            const line = alreadyAskedLine(earlier, { app: 'ACE-Step' });
            expect(line).toContain('may have worked');
            expect(line).not.toContain('nothing was used up');
        }
    });

    it('gives the whole answer when the App does not say what it gives back', () => {
        expect(narrowToReturns([song], null)).toEqual([song]);
    });

    it('replaces a failure the App worded itself, so an account or an email in it never reaches someone else', () => {
        const failed = { error: 'Tool error: token for khalid@example.com expired', outcome: 'failed' };
        for (const returns of [['audio_url'], null]) {
            expect(narrowToReturns(failed, returns)).toEqual({ error: SHARED_FAILED_LINE, outcome: 'failed' });
        }
        expect(JSON.stringify(narrowToReturns({ error: 'Tool error: acct_123' }, null))).not.toContain('acct_123');
    });

    it('lets the bot\'s own error notes through', () => {
        const failed = { error: 'No answer. May have finished', outcome: 'uncertain', hint: 'Do not call this again' };
        expect(narrowToReturns(failed, ['audio_url'])).toEqual(failed);
    });
});

describe('only the jobs the owner picked are offered', () => {
    it('narrows a tool to the inputs that were picked', () => {
        const tool = {
            type: 'function' as const,
            function: {
                name: 'make_song',
                description: 'Makes a song',
                parameters: { type: 'object', properties: { style: { type: 'string' }, owner_token: { type: 'string' }, seconds: { type: 'number' } }, required: ['style', 'owner_token'] },
            },
        };
        const narrow = narrowedToInputs(tool, ['style', 'seconds']);
        expect(Object.keys(narrow.function.parameters.properties)).toEqual(['style', 'seconds']);
        expect(narrow.function.parameters.required).toEqual(['style']);
        expect(narrow.function.name).toBe('make_song');
        // The original is untouched
        expect(Object.keys(tool.function.parameters.properties)).toHaveLength(3);
    });

    it('leaves no way to the inputs that were not picked: not in allOf, not through an open object', () => {
        const tool = {
            type: 'function' as const,
            function: {
                name: 'make_song',
                description: 'Makes a song',
                parameters: {
                    type: 'object',
                    properties: { style: { type: 'string' } },
                    allOf: [{ properties: { account: { type: 'string' } }, required: ['account'] }],
                    patternProperties: { '^x-': { type: 'string' } },
                },
            },
        };
        const narrow = narrowedToInputs(tool, ['style']);
        expect(JSON.stringify(narrow.function.parameters)).not.toContain('account');
        expect(narrow.function.parameters.allOf).toBeUndefined();
        expect(narrow.function.parameters.patternProperties).toBeUndefined();
        expect(narrow.function.parameters.additionalProperties).toBe(false);
        expect(narrow.function.parameters.properties).toEqual({ style: { type: 'string' } });
    });
});

const SHARED = new Map<string, ToolServerEntry>([
    ['make_song', { serverId: 's1', serverName: 'ACE-Step', serverUrl: 'https://mcp.example', authType: 'none', fingerprint: 'fp', connectionId: 'conn-1', sharedJob: { inputs: ['style'] } }],
    ['delete_song', { serverId: 's1', serverName: 'ACE-Step', serverUrl: 'https://mcp.example', authType: 'none', fingerprint: 'fp2', connectionId: 'conn-1' }],
]);

function service(check: AppUseCheck, settle: AppUseSettle = async () => true, tellOwner?: (botId: string, note: never) => Promise<void>) {
    const ai = new AIService(null!, null!, '');
    ai['toolGate'] = { decide: async () => ({ kind: 'run', heading: 'makesNew' }), offers: async () => true } as never;
    ai.useAppUse(check);
    ai.useAppSettle(settle, tellOwner as never);
    return ai;
}

const sara = { isVoiceBot: () => false, getPersonForArtifacts: () => ({ signedIn: true, identifier: 'u-sara', name: 'Sara' }) };
const guest = { isVoiceBot: () => false, getPersonForArtifacts: () => ({ signedIn: false, identifier: null, name: null }) };
const ask = (ai: AIService, name: string, args: object, id = 'call-1', person: object = sara, forOthers = true, uuid?: string) =>
    ai['executeToolCalls']([{ id, name, arguments: JSON.stringify(args) }], person as never, undefined, SHARED, uuid, 'room', 'b1', 7, undefined, undefined, false, undefined, undefined, undefined, false, forOthers);

describe('someone else asking a Brick for a job', () => {
    it('never runs a tool of the App that was not shared, and never asks Orbit about it', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('done' as never);
        const check = vi.fn<AppUseCheck>(async () => ({ allowed: true, shared: { returns: null } }));
        const [result] = await ask(service(check), 'delete_song', { id: 1 });
        expect(execute).not.toHaveBeenCalled();
        expect(check).not.toHaveBeenCalled();
        expect(result.result.error).toBeDefined();
    });

    it('asks Orbit with the job and the names of the inputs, then runs it, and says it was done', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue([{ type: 'text', text: 'a song' }] as never);
        const check = vi.fn<AppUseCheck>(async () => ({ allowed: true, shared: { returns: null } }));
        const settle = vi.fn<AppUseSettle>(async () => true);
        const [result] = await ask(service(check, settle), 'make_song', { style: 'oud' });
        expect(check).toHaveBeenCalledWith('b1', 's1', { botId: 'b1', callId: 'call-1', heading: 'makesNew', forOthers: true, requesterKey: 'u-sara', tool: 'make_song', argumentNames: ['style'] });
        expect(execute).toHaveBeenCalledTimes(1);
        expect(result.result).toEqual([{ type: 'text', text: 'a song' }]);
        expect(settle).toHaveBeenCalledWith('b1', 's1', 'call-1', 'done');
    });

    it('is not asked for an OK on a card: picking the job was the owner\'s OK', async () => {
        vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('song' as never);
        const ai = service(async () => ({ allowed: true, shared: { returns: null } }));
        ai['toolGate'] = { decide: async () => ({ kind: 'ask', heading: 'makesNew', notReviewed: false, policyRevision: 1, fingerprint: 'fp' }), offers: async () => true } as never;
        const askForOk = vi.spyOn(ai as never, 'askForOk' as never);
        const [result] = await ask(ai, 'make_song', { style: 'oud' });
        expect(askForOk).not.toHaveBeenCalled();
        expect(result.result).toBe('song');
    });

    it('counts a guest by their own session', async () => {
        vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('song' as never);
        const check = vi.fn<AppUseCheck>(async () => ({ allowed: true, shared: { returns: null } }));
        await ask(service(check), 'make_song', { style: 'oud' }, 'call-g', guest);
        expect(check.mock.calls[0][2].requesterKey).toBe('guest:7');
    });

    it('counts a guest by the id their browser keeps, so reconnecting does not give them a new day', async () => {
        vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('song' as never);
        const check = vi.fn<AppUseCheck>(async () => ({ allowed: true, shared: { returns: null } }));
        const ai = service(check);
        await ask(ai, 'make_song', { style: 'oud' }, 'call-a', guest, true, 'wa-uuid-1');
        await ask(ai, 'make_song', { style: 'oud' }, 'call-b', guest, true, 'wa-uuid-1');
        expect(check.mock.calls.map((call) => call[2].requesterKey)).toEqual(['guest:wa-uuid-1', 'guest:wa-uuid-1']);
        // A temporary id stands for nobody: the session is all there is to go by
        await ask(ai, 'make_song', { style: 'oud' }, 'call-c', guest, true, 'temp-7');
        expect(check.mock.calls[2][2].requesterKey).toBe('guest:7');
    });

    it('never shows someone else what the App said when it failed', async () => {
        vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue({ error: 'Tool error: owner@example.com is over quota', outcome: 'failed' } as never);
        const [result] = await ask(service(async () => ({ allowed: true, shared: { returns: null } })), 'make_song', { style: 'oud' });
        expect(JSON.stringify(result.result)).not.toContain('owner@example.com');
        expect(result.result.error).toBe(SHARED_FAILED_LINE);
    });

    it('gives back only the fields the owner picked', async () => {
        vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue([{ type: 'text', text: JSON.stringify({ audio_url: 'https://x/s.mp3', owner_email: 'o@x.com' }) }] as never);
        const [result] = await ask(service(async () => ({ allowed: true, shared: { returns: ['audio_url'] } })), 'make_song', { style: 'oud' });
        expect(result.result).toEqual([{ type: 'text', text: JSON.stringify({ audio_url: 'https://x/s.mp3' }) }]);
    });

    it('gives the use back when the try never ran', async () => {
        vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue({ error: "Couldn't reach it. Nothing ran", outcome: 'not_sent' } as never);
        const settle = vi.fn<AppUseSettle>(async () => true);
        const [result] = await ask(service(async () => ({ allowed: true, shared: { returns: null } }), settle), 'make_song', { style: 'oud' });
        expect(settle).toHaveBeenCalledWith('b1', 's1', 'call-1', 'failed');
        expect(result.result.outcome).toBe('not_sent');
    });

    it('gives the use back when the App itself said it failed', async () => {
        vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue({ error: 'Tool error: no such style', outcome: 'failed' } as never);
        const settle = vi.fn<AppUseSettle>(async () => true);
        await ask(service(async () => ({ allowed: true, shared: { returns: null } }), settle), 'make_song', { style: 'zzz' });
        expect(settle).toHaveBeenCalledWith('b1', 's1', 'call-1', 'failed');
    });

    it('does NOT give the use back for a timeout, and tells the bot not to run it again', async () => {
        vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue({ error: 'No answer. May have finished', outcome: 'uncertain', hint: 'Do not call this tool again in this reply.' } as never);
        const settle = vi.fn<AppUseSettle>(async () => true);
        const [result] = await ask(service(async () => ({ allowed: true, shared: { returns: null } }), settle), 'make_song', { style: 'oud' });
        expect(settle).toHaveBeenCalledTimes(1);
        expect(settle).toHaveBeenCalledWith('b1', 's1', 'call-1', 'unknown');
        expect(result.result.hint).toContain('Do not call this tool again');
    });

    it('does not settle a use that was refused, and does not run it', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('song' as never);
        const settle = vi.fn<AppUseSettle>(async () => true);
        const [result] = await ask(service(async () => ({ allowed: false, reason: 'limit_reached', resetsAt: '2026-11-18T00:00:00.000Z' }), settle), 'make_song', { style: 'oud' });
        expect(execute).not.toHaveBeenCalled();
        expect(settle).not.toHaveBeenCalled();
        // One kind line, and what the Brick can still do
        expect(result.result.error).toContain("ACE-Step has reached the limit set for today");
        expect(result.result.error).toContain('what you can still do');
        expect(result.result.outcome).toBe('not_sent');
    });

    it('names the owner when the Brick knows them', async () => {
        vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('song' as never);
        const ai = service(async () => ({ allowed: false, reason: 'limit_reached', resetsAt: '2026-11-18T00:00:00.000Z' }));
        ai['roomBricks'].set('b1', { ownerUuid: 'u-khalid', ownerName: 'Khalid', roomUrl: 'https://play/room' } as never);
        const [result] = await ask(ai, 'make_song', { style: 'oud' });
        expect(result.result.error).toContain("Khalid's ACE-Step has reached the limit set for today");
    });

    it('never runs the same call again, and says what the first try came to', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('song' as never);
        const [result] = await ask(service(async () => ({ allowed: false, reason: 'already_asked', earlier: 'unknown' })), 'make_song', { style: 'oud' });
        expect(execute).not.toHaveBeenCalled();
        expect(result.result.error).toContain('may have worked');
        expect(result.result.error).toContain('will not be run again');
    });

    it('says when the App is busy and when the job was not shared', async () => {
        vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('song' as never);
        const [busy] = await ask(service(async () => ({ allowed: false, reason: 'busy' })), 'make_song', { style: 'oud' });
        expect(busy.result.error).toContain('busy');
        const [notShared] = await ask(service(async () => ({ allowed: false, reason: 'not_shared' })), 'make_song', { style: 'oud', other: 1 });
        expect(notShared.result.error).toContain('was not shared');
    });

    it('settles "unknown" and says it in the bot\'s words when the connector breaks after Orbit allowed the use', async () => {
        vi.spyOn(MCPConnector, 'executeToolCall').mockRejectedValue(new Error('socket hang up for owner@example.com'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const settle = vi.fn<AppUseSettle>(async () => true);
        const [result] = await ask(service(async () => ({ allowed: true, shared: { returns: null } }), settle), 'make_song', { style: 'oud' });
        expect(settle).toHaveBeenCalledTimes(1);
        expect(settle).toHaveBeenCalledWith('b1', 's1', 'call-1', 'unknown');
        expect(result.result).toMatchObject({ error: SHARED_FAILED_LINE, outcome: 'uncertain' });
        expect(JSON.stringify(result.result)).not.toContain('owner@example.com');
    });

    it('never hides the answer when Orbit cannot be told what the try came to', async () => {
        vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue([{ type: 'text', text: JSON.stringify({ audio_url: 'https://x/s.mp3' }) }] as never);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const settle = vi.fn<AppUseSettle>().mockRejectedValue(new Error('orbit down'));
        const [result] = await ask(service(async () => ({ allowed: true, shared: { returns: ['audio_url'] } }), settle), 'make_song', { style: 'oud' });
        expect(result.result).toEqual([{ type: 'text', text: JSON.stringify({ audio_url: 'https://x/s.mp3' }) }]);
    });

    it('tells the owner once, in their own chat, when the day\'s uses ran out', async () => {
        vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('song' as never);
        const note = { matrixUserId: '@u:matrix', appName: 'ACE-Step', botName: 'Music Brick', limit: 20, connectionId: 'conn-1' };
        const tell = vi.fn(async () => undefined);
        await ask(service(async () => ({ allowed: true, shared: { returns: null }, ownerNote: note }), async () => true, tell), 'make_song', { style: 'oud' });
        expect(tell).toHaveBeenCalledWith('b1', note);
        tell.mockClear();
        await ask(service(async () => ({ allowed: false, reason: 'limit_reached', resetsAt: '2026-11-18T00:00:00.000Z', ownerNote: note }), async () => true, tell), 'make_song', { style: 'oud' }, 'call-2');
        expect(tell).toHaveBeenCalledTimes(1);
    });
});

describe('what holds for someone else even if Orbit or the model gets it wrong', () => {
    it('sends the App only the inputs the owner picked, and asks Orbit only about those', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('song' as never);
        const check = vi.fn<AppUseCheck>(async () => ({ allowed: true, shared: { returns: null } }));
        await ask(service(check), 'make_song', { style: 'oud', owner_token: 'x', seconds: 30 });
        expect(execute.mock.calls[0][3]).toEqual({ style: 'oud' });
        expect(check.mock.calls[0][2].argumentNames).toEqual(['style']);
    });

    it('never runs it when Orbit allows without saying what may come back, and gives the use back', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue([{ type: 'text', text: JSON.stringify({ secret: 's' }) }] as never);
        const settle = vi.fn<AppUseSettle>(async () => true);
        const [result] = await ask(service(async () => ({ allowed: true }), settle), 'make_song', { style: 'oud' });
        expect(execute).not.toHaveBeenCalled();
        expect(result.result.outcome).toBe('not_sent');
        expect(settle).toHaveBeenCalledWith('b1', 's1', 'call-1', 'failed');
    });

    it('still runs the owner\'s own ask when Orbit says nothing of what may come back', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('song' as never);
        const [result] = await ask(service(async () => ({ allowed: true })), 'make_song', { style: 'oud', seconds: 5 }, 'call-o', sara, false);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls[0][3]).toEqual({ style: 'oud', seconds: 5 });
        expect(result.result).toBe('song');
    });

    it('does not run a job that was never reviewed or has changed, and asks nobody about it', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('song' as never);
        const check = vi.fn<AppUseCheck>(async () => ({ allowed: true, shared: { returns: null } }));
        const ai = service(check);
        ai['toolGate'] = { decide: async () => ({ kind: 'ask', heading: 'makesNew', notReviewed: true, policyRevision: 1, fingerprint: 'fp' }), offers: async () => true } as never;
        const askForOk = vi.spyOn(ai as never, 'askForOk' as never);
        const [result] = await ask(ai, 'make_song', { style: 'oud' });
        expect(execute).not.toHaveBeenCalled();
        expect(check).not.toHaveBeenCalled();
        expect(askForOk).not.toHaveBeenCalled();
        expect(result.result.outcome).toBe('not_sent');
    });

    it('counts a signed-out visitor under one key whether or not the game knows them', async () => {
        vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('song' as never);
        const check = vi.fn<AppUseCheck>(async () => ({ allowed: true, shared: { returns: null } }));
        const known = { isVoiceBot: () => false, getPersonForArtifacts: () => ({ signedIn: false, identifier: 'wa-uuid-1', name: null }) };
        const ai = service(check);
        await ask(ai, 'make_song', { style: 'oud' }, 'call-a', known, true, 'wa-uuid-1');
        await ask(ai, 'make_song', { style: 'oud' }, 'call-b', guest, true, 'wa-uuid-1');
        expect(check.mock.calls.map((call) => call[2].requesterKey)).toEqual(['guest:wa-uuid-1', 'guest:wa-uuid-1']);
    });

    it('does not send a job again in the same turn after it may have run', async () => {
        const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue({ error: 'No answer. May have finished', outcome: 'uncertain', hint: 'x' } as never);
        const check = vi.fn<AppUseCheck>(async () => ({ allowed: true, shared: { returns: null } }));
        const memory: { sharedUncertain?: Set<string> } = {};
        const ai = service(check);
        ai['conversationMemory'] = { getMemory: () => memory } as never;
        const [first] = await ask(ai, 'make_song', { style: 'oud' }, 'call-1');
        expect(first.result.outcome).toBe('uncertain');
        const [again] = await ask(ai, 'make_song', { style: 'oud' }, 'call-2');
        expect(execute).toHaveBeenCalledTimes(1);
        expect(check).toHaveBeenCalledTimes(1);
        expect(again.result.outcome).toBe('uncertain');
        expect(again.result.error).toContain('may have worked');
        // Another job, or other inputs, is another ask
        await ask(ai, 'make_song', { style: 'rock' }, 'call-3');
        expect(execute).toHaveBeenCalledTimes(2);
    });
});

describe('telling Orbit again when it did not take what a try came to', () => {
    it('tries only the telling again, with the same call id and outcome, and never calls the App again', async () => {
        vi.useFakeTimers();
        try {
            const execute = vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue({ error: "Couldn't reach it. Nothing ran", outcome: 'not_sent' } as never);
            const settle = vi.fn<AppUseSettle>().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
            await ask(service(async () => ({ allowed: true, shared: { returns: null } }), settle), 'make_song', { style: 'oud' });
            expect(settle).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(2_000);
            expect(settle).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(15_000);
            expect(settle).toHaveBeenCalledTimes(3);
            // Told: nothing more is tried
            await vi.advanceTimersByTimeAsync(120_000);
            expect(settle).toHaveBeenCalledTimes(3);
            for (const call of settle.mock.calls) expect(call).toEqual(['b1', 's1', 'call-1', 'failed']);
            expect(execute).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('gives up after a few tries, leaving the try counted', async () => {
        vi.useFakeTimers();
        try {
            vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue({ error: 'Tool error: no', outcome: 'failed' } as never);
            const settle = vi.fn<AppUseSettle>(async () => false);
            await ask(service(async () => ({ allowed: true, shared: { returns: null } }), settle), 'make_song', { style: 'oud' });
            await vi.advanceTimersByTimeAsync(300_000);
            expect(settle).toHaveBeenCalledTimes(4);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('when the owner is told the day\'s uses ran out', () => {
    const note = { matrixUserId: '@u:matrix', appName: 'ACE-Step', botName: 'Music Brick', limit: 1, connectionId: 'conn-1', day: '2026-11-18' };
    const lastUse = async () => ({ allowed: true as const, shared: { returns: null }, ownerNote: note });

    it('waits until the use is known to stay taken: nothing is said for a use given back', async () => {
        vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue({ error: "Couldn't reach it. Nothing ran", outcome: 'not_sent' } as never);
        const tell = vi.fn(async () => undefined);
        await ask(service(lastUse, async () => true, tell), 'make_song', { style: 'oud' });
        expect(tell).not.toHaveBeenCalled();
    });

    it('says it once the try is settled as done', async () => {
        vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue('song' as never);
        const order: string[] = [];
        const tell = vi.fn(async () => {
            order.push('told');
        });
        await ask(
            service(lastUse, async () => {
                order.push('settled');
                return true;
            }, tell),
            'make_song',
            { style: 'oud' }
        );
        expect(order).toEqual(['settled', 'told']);
        expect(tell).toHaveBeenCalledWith('b1', note);
    });

    it('says it for a try that may have run, which stays counted', async () => {
        vi.spyOn(MCPConnector, 'executeToolCall').mockResolvedValue({ error: 'No answer. May have finished', outcome: 'uncertain', hint: 'x' } as never);
        const tell = vi.fn(async () => undefined);
        await ask(service(lastUse, async () => true, tell), 'make_song', { style: 'oud' });
        expect(tell).toHaveBeenCalledTimes(1);
    });

    it('does not hold it when someone was turned away: nothing was used', async () => {
        const tell = vi.fn(async () => undefined);
        await ask(service(async () => ({ allowed: false, reason: 'limit_reached', resetsAt: '2026-11-19T00:00:00.000Z', ownerNote: note }), async () => true, tell), 'make_song', { style: 'oud' });
        expect(tell).toHaveBeenCalledTimes(1);
    });

    it('is said with one transaction id for the day Orbit named, and told again with it when Matrix could not be reached for sure', async () => {
        const speak = vi.fn<(id: string, text: string, tx: string) => Promise<{ ok: boolean; reason?: string }>>()
            .mockResolvedValueOnce({ ok: false, reason: 'unsure' })
            .mockRejectedValueOnce(new Error('matrix down'))
            .mockResolvedValueOnce({ ok: true });
        const waits: number[] = [];
        await sayOwnerNote(speak, 'b1', note, [1, 2, 3], async (ms) => void waits.push(ms));
        expect(speak).toHaveBeenCalledTimes(3);
        expect(new Set(speak.mock.calls.map((call) => call[2]))).toEqual(new Set(['app-share-limit:b1:conn-1:2026-11-18']));
        expect(speak.mock.calls[0][0]).toBe('@u:matrix');
        expect(waits).toEqual([1, 2]);
    });

    it('does not try again when it is certain there is nobody to tell, and gives up after a few tries', async () => {
        const gone = vi.fn(async () => ({ ok: false, reason: 'no_chat' }));
        await sayOwnerNote(gone, 'b1', note, [1, 2, 3], async () => undefined);
        expect(gone).toHaveBeenCalledTimes(1);
        const notAllowed = vi.fn(async () => ({ ok: false, reason: 'not_allowed' }));
        await sayOwnerNote(notAllowed, 'b1', note, [1, 2, 3], async () => undefined);
        expect(notAllowed).toHaveBeenCalledTimes(1);
        const unsure = vi.fn(async () => ({ ok: false, reason: 'unsure' }));
        await sayOwnerNote(unsure, 'b1', note, [1, 2, 3], async () => undefined);
        expect(unsure).toHaveBeenCalledTimes(4);
    });
});

describe('what the owner reads', () => {
    it('says it in the Brick\'s voice with the way to the limit', () => {
        const line = ownerNoteText({ appName: 'ACE-Step', limit: 20, connectionId: 'conn-1' });
        expect(line).toContain('your ACE-Step has been used 20 times through me today');
        expect(line).toContain('[Change the limit](#apps=conn-1)');
    });
});

describe('the words a person is given', () => {
    it('never says "tool", "MCP", "connector" or a price', () => {
        for (const reason of ['limit_reached', 'not_shared', 'busy', 'already_asked'] as const) {
            expect(appNotUsedLine(reason, { app: 'ACE-Step', owner: 'Khalid' })).not.toMatch(/\btool\b|MCP|connector|\$/i);
        }
        for (const earlier of ['unknown', 'running', 'done', 'refunded', undefined]) {
            expect(alreadyAskedLine(earlier, { app: 'ACE-Step' })).not.toMatch(/\btool\b|MCP|connector|\$/i);
        }
    });
});
