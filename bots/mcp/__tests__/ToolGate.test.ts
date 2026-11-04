/**
 * Tests for the one check right before a bot tool runs (game #1656): not-checked-yet servers keep working in text, an
 * unconfirmed or changed tool does not run for anyone but a manager (with a card), Off blocks, change and delete or send
 * need their permission whatever the setting, and Orbit not answering lets nothing through.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

import { CANNOT_CHECK_TOOL_LINE, ToolGate, type GateCall } from '../ToolGate';
import { ToolPolicyUnavailable, type PolicyTool, type ServerPolicy, type ToolSetting } from '../ToolPolicy';
import type { ToolHeading } from '../ToolCatalog';

const SETTINGS: Record<ToolHeading, ToolSetting> = { looksUp: 'rightAway', makesNew: 'rightAway', changesThings: 'asksFirst', deletesOrSends: 'asksFirst' };

function policy(overrides: Partial<Omit<ServerPolicy, 'tools'>> & { tools?: Array<[string, Partial<PolicyTool>]> } = {}): ServerPolicy {
    const { tools: given = [], ...rest } = overrides;
    const tools = new Map<string, PolicyTool>(
        given.map(([name, tool]) => [name, { name, fingerprint: 'fp', heading: 'looksUp', suggestedHeading: null, confirmed: true, ...tool }])
    );
    return { serverId: 's1', state: 'confirmed', policyRevision: 7, settings: SETTINGS, ...rest, tools };
}

const MEMBER = { signedIn: true, identifier: 'mishari' };
const MANAGER = { signedIn: true, identifier: 'sara' };
const GUEST = { signedIn: false };

const call = (overrides: Partial<GateCall> = {}): GateCall => ({
    botId: 'b1',
    toolName: 'tool',
    serverId: 's1',
    fingerprint: 'fp',
    person: MEMBER,
    voice: false,
    ...overrides,
});

function gateFor(served: ServerPolicy | Error, options: { allowed?: (action: string) => boolean | 'cannot'; managers?: string[] } = {}) {
    const read = vi.fn(async () => {
        if (served instanceof Error) throw served;
        return served;
    });
    const check = vi.fn(async (_bot: string, action: string) => {
        const verdict = options.allowed ? options.allowed(action) : true;
        if (verdict === 'cannot') return { allowed: false, kind: 'cannot_check', line: "The bot can't check that right now. Try again soon." } as const;
        return verdict ? ({ allowed: true, kind: 'allowed' } as const) : ({ allowed: false, kind: 'refused', code: 'not_allowed', line: `You can't ${action} here.` } as const);
    });
    const canManageBotTools = vi.fn(async (_bot: string, identifier: string) => (options.managers ?? ['sara']).includes(identifier));
    const gate = new ToolGate({ read } as never, { check } as never, { canManageBotTools }, () => 1_000);
    return { gate, read, check, canManageBotTools };
}

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('a server that was never checked', () => {
    it('keeps working in text, as it does today', async () => {
        const { gate, check } = gateFor(policy({ state: 'notCheckedYet' }));
        expect(await gate.decide(call({ fingerprint: undefined }))).toEqual({ kind: 'run' });
        expect(check).not.toHaveBeenCalled();
    });

    it('is never used by voice', async () => {
        const { gate } = gateFor(policy({ state: 'notCheckedYet' }));
        const verdict = await gate.decide(call({ voice: true, toolTitle: 'Search' }));
        expect(verdict).toMatchObject({ kind: 'refuse', why: 'voice_unchecked' });
        expect((verdict as { line: string }).line).toContain('Search');
    });
});

describe('a confirmed tool', () => {
    it('runs right away when its heading is Right away', async () => {
        const { gate } = gateFor(policy({ tools: [['tool', { heading: 'looksUp' }]] }));
        expect(await gate.decide(call())).toEqual({ kind: 'run' });
    });

    it('asks first when its heading asks first, and names the heading, revision and tool as it is', async () => {
        const { gate } = gateFor(policy({ tools: [['tool', { heading: 'changesThings', fingerprint: 'fp-9' }]] }));
        expect(await gate.decide(call({ fingerprint: 'fp-9' }))).toEqual({ kind: 'ask', heading: 'changesThings', notReviewed: false, policyRevision: 7, fingerprint: 'fp-9' });
    });

    it('is blocked when its heading is Off', async () => {
        const { gate } = gateFor(policy({ settings: { ...SETTINGS, makesNew: 'off' }, tools: [['tool', { heading: 'makesNew' }]] }), { managers: ['mishari'] });
        expect(await gate.decide(call({ toolTitle: 'Make image' }))).toMatchObject({ kind: 'refuse', why: 'off' });
    });

    it('is blocked when Off even for a manager', async () => {
        const { gate } = gateFor(policy({ settings: { ...SETTINGS, makesNew: 'off' }, tools: [['tool', { heading: 'makesNew' }]] }));
        expect(await gate.decide(call({ person: MANAGER }))).toMatchObject({ kind: 'refuse', why: 'off' });
    });

    it('is not the tool that was confirmed when it changed since: it needs a review again', async () => {
        const { gate } = gateFor(policy({ tools: [['tool', { heading: 'looksUp', fingerprint: 'old' }]] }));
        expect(await gate.decide(call({ fingerprint: 'new' }))).toMatchObject({ kind: 'refuse', why: 'changed' });
    });

    it('is not confirmed when what the tool is right now is not known', async () => {
        const { gate } = gateFor(policy({ tools: [['tool', { heading: 'looksUp' }]] }));
        expect(await gate.decide(call({ fingerprint: undefined }))).toMatchObject({ kind: 'refuse' });
    });
});

describe('the two permissions', () => {
    it('stops a Member without "Have bots delete or send" from a delete tool, even on Right away', async () => {
        const { gate, check } = gateFor(policy({ settings: { ...SETTINGS, deletesOrSends: 'rightAway' }, tools: [['tool', { heading: 'deletesOrSends' }]] }), { allowed: (action) => action !== 'deleteOrSend' });
        const verdict = await gate.decide(call());
        expect(verdict).toEqual({ kind: 'refuse', why: 'no_permission', line: "You can't deleteOrSend here." });
        expect(check).toHaveBeenCalledWith('b1', 'deleteOrSend', MEMBER, undefined);
    });

    it('checks "change" for a tool that changes things, before it asks', async () => {
        const { gate, check } = gateFor(policy({ tools: [['tool', { heading: 'changesThings' }]] }), { allowed: (action) => action !== 'change' });
        expect(await gate.decide(call())).toMatchObject({ kind: 'refuse', why: 'no_permission' });
        expect(check).toHaveBeenCalledWith('b1', 'change', MEMBER, undefined);
    });

    it('does not ask for a permission when the tool only looks up or makes something', async () => {
        const { gate, check } = gateFor(policy({ tools: [['tool', { heading: 'makesNew' }]] }));
        await gate.decide(call());
        expect(check).not.toHaveBeenCalled();
    });

    it('refuses a guest, since Orbit says guests do not have them', async () => {
        const { gate } = gateFor(policy({ tools: [['tool', { heading: 'deletesOrSends' }]] }), { allowed: () => false });
        expect(await gate.decide(call({ person: GUEST }))).toMatchObject({ kind: 'refuse', why: 'no_permission' });
    });

    it('lets nothing through when the permission can not be checked', async () => {
        const { gate } = gateFor(policy({ tools: [['tool', { heading: 'deletesOrSends' }]] }), { allowed: () => 'cannot' });
        expect(await gate.decide(call())).toEqual({ kind: 'refuse', why: 'cannot_check', line: CANNOT_CHECK_TOOL_LINE });
    });
});

describe('a tool nobody confirmed', () => {
    const unconfirmed = () => policy({ tools: [['tool', { confirmed: false, heading: null, suggestedHeading: 'changesThings' }]] });

    it('does not run for a member, who is told it needs a review', async () => {
        const { gate } = gateFor(unconfirmed());
        const verdict = await gate.decide(call({ toolTitle: 'Update issue' }));
        expect(verdict).toMatchObject({ kind: 'refuse', why: 'not_confirmed' });
        expect((verdict as { line: string }).line).toContain('Update issue');
    });

    it('does not run for a guest, and Orbit is not asked who manages', async () => {
        const { gate, canManageBotTools } = gateFor(unconfirmed());
        expect(await gate.decide(call({ person: GUEST }))).toMatchObject({ kind: 'refuse', why: 'not_confirmed' });
        expect(canManageBotTools).not.toHaveBeenCalled();
    });

    it('may be tried by a person who manages the bot, with a card every time', async () => {
        const { gate } = gateFor(unconfirmed());
        expect(await gate.decide(call({ person: MANAGER }))).toEqual({ kind: 'ask', heading: 'changesThings', notReviewed: true, policyRevision: 7, fingerprint: 'fp' });
    });

    it('takes the stricter heading when nothing says what it does', async () => {
        const { gate } = gateFor(policy({ tools: [['tool', { confirmed: false, heading: null, suggestedHeading: null }]] }));
        expect(await gate.decide(call({ person: MANAGER }))).toMatchObject({ kind: 'ask', heading: 'deletesOrSends', notReviewed: true });
    });

    it('is not a way round a missing permission, even for a manager', async () => {
        const { gate } = gateFor(unconfirmed(), { allowed: () => false });
        expect(await gate.decide(call({ person: MANAGER }))).toMatchObject({ kind: 'refuse', why: 'no_permission' });
    });

    it('still says ask for a voice bot: where a card can be shown is for the caller to say', async () => {
        const { gate } = gateFor(unconfirmed());
        expect(await gate.decide(call({ person: MANAGER, voice: true }))).toMatchObject({ kind: 'ask' });
    });

    it('is a tool Orbit does not know at all, treated the same way', async () => {
        const { gate } = gateFor(policy({ tools: [] }));
        expect(await gate.decide(call())).toMatchObject({ kind: 'refuse', why: 'not_confirmed' });
        expect(await gate.decide(call({ person: MANAGER }))).toMatchObject({ kind: 'ask', notReviewed: true });
    });

    it('is a tool that was confirmed and changed: a manager may try it, others may not', async () => {
        const { gate } = gateFor(policy({ tools: [['tool', { fingerprint: 'old', heading: 'looksUp' }]] }));
        expect(await gate.decide(call({ fingerprint: 'new' }))).toMatchObject({ why: 'changed' });
        expect(await gate.decide(call({ fingerprint: 'new', person: MANAGER }))).toMatchObject({ kind: 'ask', notReviewed: true, fingerprint: 'new' });
    });

    it('keeps who manages for a short while, not asking Orbit for every call', async () => {
        const { gate, canManageBotTools } = gateFor(unconfirmed());
        await gate.decide(call({ person: MANAGER }));
        await gate.decide(call({ person: MANAGER }));
        expect(canManageBotTools).toHaveBeenCalledTimes(1);
    });

    it('asks Orbit once when several tools are judged at the same moment', async () => {
        const { gate, canManageBotTools } = gateFor(unconfirmed());
        await Promise.all([gate.decide(call({ person: MANAGER })), gate.decide(call({ person: MANAGER })), gate.decide(call({ person: MANAGER }))]);
        expect(canManageBotTools).toHaveBeenCalledTimes(1);
    });
});

describe('when Orbit can not be asked', () => {
    it('lets nothing through if the policy can not be read', async () => {
        const { gate } = gateFor(new ToolPolicyUnavailable());
        expect(await gate.decide(call())).toEqual({ kind: 'refuse', why: 'cannot_check', line: CANNOT_CHECK_TOOL_LINE });
    });

    it('lets nothing through if who manages the bot can not be read', async () => {
        const served = policy({ tools: [['tool', { confirmed: false, heading: null }]] });
        const gate = new ToolGate({ read: async () => served } as never, { check: vi.fn() } as never, { canManageBotTools: async () => Promise.reject(new Error('down')) });
        expect(await gate.decide(call({ person: MANAGER }))).toMatchObject({ kind: 'refuse', why: 'cannot_check' });
    });
});

describe('offers', () => {
    it('offers a tool that runs or asks, and not one that is refused', async () => {
        const served = policy({ settings: { ...SETTINGS, makesNew: 'off' }, tools: [['look', { heading: 'looksUp' }], ['edit', { heading: 'changesThings' }], ['make', { heading: 'makesNew' }]] });
        const { gate } = gateFor(served);
        expect(await gate.offers(call({ toolName: 'look' }))).toBe(true);
        expect(await gate.offers(call({ toolName: 'edit' }))).toBe(true);
        expect(await gate.offers(call({ toolName: 'make' }))).toBe(false);
    });
});
