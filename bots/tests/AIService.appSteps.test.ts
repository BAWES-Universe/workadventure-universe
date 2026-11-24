import { describe, expect, it, vi } from 'vitest';
import { AIService } from '../ai/AIService';

vi.mock('../client/BotClient', () => ({ BotClient: vi.fn() }));

const BRICK = 'brick-1';
const entry = { serverId: 's', serverUrl: 'https://x.test', authType: 'none', serverName: 'Notion', connectionId: 'c1', readyMade: true };
const servers = new Map([['notion_update', entry]]);
const page = (id: string, n = 1) => Array.from({ length: n }, (_, i) => ({ id: `${id}${i}`, name: 'notion_update', result: [{ type: 'text', text: 'ok' }] }));

function service(over: { on?: boolean; review?: boolean } = {}) {
    const ai = new AIService(null!, null!, '');
    const admin = { isConfigured: () => true, reviewAppSteps: vi.fn().mockResolvedValue(over.review ?? true) };
    const on = vi.fn().mockResolvedValue(over.on ?? true);
    (ai as unknown as { ownBricks: Set<string> }).ownBricks = new Set([BRICK]);
    (ai as unknown as { conversationMemory: unknown }).conversationMemory = { getMemory: () => ({ userUuid: 'u1' }) };
    (ai as unknown as { computerOnFor: unknown }).computerOnFor = on;
    const run = (results: ReturnType<typeof page>, counts: Map<string, number>, offered = true, signal?: AbortSignal) =>
        ai['reviewAppStepCount'](results, servers as never, counts, offered, BRICK, 7, admin as never, signal);
    return { run, admin, on };
}

describe('the review at 20 app steps, in a reply', () => {
    it('looks at the computer only when a checkpoint is passed: rounds before it go on at once', async () => {
        const { run, admin, on } = service();
        const counts = new Map<string, number>();
        const early = await run(page('a', 5), counts);
        expect(early.notes.size).toBe(0);
        expect(on).not.toHaveBeenCalled();
        expect(admin.reviewAppSteps).not.toHaveBeenCalled();
        const at20 = await run(page('b', 15), counts);
        expect(on).toHaveBeenCalledTimes(1);
        expect(admin.reviewAppSteps).toHaveBeenCalledWith(BRICK, 'u1', 'Notion', 20);
        expect([...at20.notes.keys()]).toEqual(['b14']);
        expect([...at20.accepted]).toEqual(['Notion']);
    });

    it('says nothing about the computer when the reply was not offered it, or it is not on now, though the steps are counted', async () => {
        const off = service();
        const counts = new Map<string, number>();
        expect((await off.run(page('a', 20), counts, false)).notes.size).toBe(0);
        expect(off.on).not.toHaveBeenCalled();
        expect(off.admin.reviewAppSteps).not.toHaveBeenCalled();
        expect(counts.get('Notion')).toBe(20);
        const gone = service({ on: false });
        expect((await gone.run(page('a', 20), new Map())).notes.size).toBe(0);
        expect(gone.admin.reviewAppSteps).not.toHaveBeenCalled();
    });

    it('does not hold up a turn that was stopped: nothing is asked, and one already asked is not waited for', async () => {
        const stopped = new AbortController();
        stopped.abort();
        const first = service();
        expect((await first.run(page('a', 20), new Map(), true, stopped.signal)).notes.size).toBe(0);
        expect(first.on).not.toHaveBeenCalled();
        const live = new AbortController();
        const slow = service();
        slow.admin.reviewAppSteps.mockReturnValue(new Promise(() => undefined));
        const pending = slow.run(page('a', 20), new Map(), true, live.signal);
        await new Promise((resolve) => setTimeout(resolve, 5));
        live.abort();
        expect((await pending).notes.size).toBe(0);
    });

    it('asks only for a person\'s own Brick', async () => {
        const { run, admin } = service();
        (admin as unknown as { isConfigured: () => boolean }).isConfigured = () => false;
        expect((await run(page('a', 20), new Map())).notes.size).toBe(0);
        expect(admin.reviewAppSteps).not.toHaveBeenCalled();
    });
});
