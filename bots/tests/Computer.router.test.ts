/**
 * The fixed order a Brick chooses its way in: answer, then an app, then the computer. The app step is checked where the job is started:
 * a job that names one of the person's connected apps goes there first, unless Brick says in its own words why the app cannot do it.
 */
import { describe, expect, it, vi } from 'vitest';
import { StepRoom, stepOf } from '../ai/replySteps';
import { APP_STEP_CHECKPOINT, appStepsNote, appThatFits, checkpointCrossed, checkpointsCrossed, computerToolDefinitions, reviewAppSteps, runComputerTool, withReviewNote } from '../ai/ComputerTools';

const BRICK = '0b7c1d2e-1111-4222-8333-944455556666';
const job = (over: Record<string, unknown> = {}) => ({ id: 'j1', status: 'running', queuedFor: null, ...over });
const asking = (answer: unknown) => ({ startComputerJob: vi.fn().mockResolvedValue(answer) });

describe('the fixed order: answer, then an app, then the computer', () => {
    const apps = ['GitHub', 'Google Sheets'];

    it('finds the app a job names, by whole words, and nothing else', () => {
        expect(appThatFits('Fix the typo', 'open a pull request on GitHub for the readme', apps)).toBe('GitHub');
        expect(appThatFits('Chart', 'from my google sheets file', apps)).toBe('Google Sheets');
        expect(appThatFits('Visa form', 'the embassy site', apps)).toBeNull();
        expect(appThatFits('Hub visit', 'githubbing', apps)).toBeNull();
        expect(appThatFits('Anything', 'github', undefined)).toBeNull();
    });

    it('sends a job that names a connected app back to the app, starting nothing, until Brick says why the app cannot do it', async () => {
        const admin = asking({ ok: true, job: job(), restoredFrom: null });
        const refused = await runComputerTool({ job: 'Open a PR', details: 'on GitHub, fix the readme' }, { admin, botId: BRICK, userId: 'u', apps: ['GitHub'] });
        expect(refused).toMatchObject({ started: false, success: false });
        expect(String(refused.note)).toContain('GitHub');
        expect(admin.startComputerJob).not.toHaveBeenCalled();
        // A reason that is not one is not one
        await runComputerTool({ job: 'Open a PR', details: 'on GitHub', app_cannot: 'no' }, { admin, botId: BRICK, userId: 'u', apps: ['GitHub'] });
        expect(admin.startComputerJob).not.toHaveBeenCalled();
        const allowed = await runComputerTool({ job: 'Open a PR', details: 'on GitHub', app_cannot: 'the job is on the website screen, GitHub has no such action' }, { admin, botId: BRICK, userId: 'u', apps: ['GitHub'] });
        expect(allowed).toMatchObject({ started: true });
        expect(admin.startComputerJob).toHaveBeenCalledTimes(1);
    });

    it('does not get in the way of a job that names no connected app, and the tool says what app_cannot is for', async () => {
        const admin = asking({ ok: true, job: job(), restoredFrom: null });
        expect(await runComputerTool({ job: 'Visa form', details: 'the embassy site' }, { admin, botId: BRICK, userId: 'u', apps: ['GitHub'] })).toMatchObject({ started: true });
        const [tool] = computerToolDefinitions();
        expect(JSON.stringify(tool.function.parameters)).toContain('app_cannot');
    });

describe('the way weighed by cost: Brick says which app and how many steps, and Orbit works out the cheaper way', () => {
    const context = (admin: ReturnType<typeof asking>) => ({ admin, botId: BRICK, userId: 'u', apps: ['GitHub'] });

    it('tells Brick about the plan it can give: the app it weighed and about how many steps', () => {
        const [tool] = computerToolDefinitions();
        const properties = (tool.function.parameters as { properties: Record<string, { description: string }> }).properties;
        expect(Object.keys(properties)).toEqual(expect.arrayContaining(['app', 'app_steps']));
        expect(properties.app_steps.description).toMatch(/steps/i);
    });

    it('sends the plan with the start: the app, its steps and why it cannot, and nothing a price could be put in', async () => {
        const admin = asking({ ok: true, job: job(), restoredFrom: null });
        await runComputerTool({ job: 'Sheet chart', app: 'Notion', app_steps: 3, app_cannot: 'the chart lives on a website screen' }, context(admin));
        expect(admin.startComputerJob).toHaveBeenCalledWith(BRICK, 'u', expect.objectContaining({ plan: { app: 'Notion', steps: 3, appCannot: 'the chart lives on a website screen' } }));
    });

    it('sends the app a job names even when Brick left the plan out, and no plan for a job that names none', async () => {
        const admin = asking({ ok: true, job: job(), restoredFrom: null });
        await runComputerTool({ job: 'Open a PR', details: 'on GitHub', app_cannot: 'the job is on the website screen, GitHub has no such action' }, context(admin));
        expect(admin.startComputerJob).toHaveBeenLastCalledWith(BRICK, 'u', expect.objectContaining({ plan: expect.objectContaining({ app: 'GitHub' }) }));
        await runComputerTool({ job: 'Visa form', details: 'the embassy site' }, context(admin));
        expect(admin.startComputerJob.mock.calls.at(-1)?.[2]).not.toHaveProperty('plan');
    });

    it('reads a step count that is not a whole number as none', async () => {
        const admin = asking({ ok: true, job: job(), restoredFrom: null });
        await runComputerTool({ job: 'Chart', app: 'Notion', app_steps: 'lots' }, context(admin));
        expect(admin.startComputerJob).toHaveBeenLastCalledWith(BRICK, 'u', expect.objectContaining({ plan: { app: 'Notion' } }));
    });

    it('turns "a connected app is cheaper" into one plain line: use that app, no price, and nothing was started', async () => {
        const admin = asking({ ok: false, reason: 'cheaper_route', app: 'Notion' });
        const result = await runComputerTool({ job: 'Add a page', app: 'Notion', app_steps: 3 }, context(admin));
        expect(result).toMatchObject({ started: false, success: false });
        expect(String(result.note)).toContain('Notion');
        expect(String(result.note)).toMatch(/app_cannot/);
        expect(String(result.note)).not.toMatch(/\$|cost|price|cheaper|cents/i);
    });
});
});

describe('the review at 20 app steps', () => {
    const page = (text: string) => [{ type: 'text', text }];
    const appOf = (name: string) => (name.startsWith('notion_') ? 'Notion' : name.startsWith('linear_') ? 'Linear' : undefined);
    const calls = (name: string, n: number, make: (i: number) => unknown = (i) => page(`r${i}`)) => Array.from({ length: n }, (_, i) => ({ id: `${name}-${i}`, name, result: make(i) }));

    it('is every 20 steps an App takes in one answer, and a round that adds many passes every checkpoint on the way', () => {
        expect(APP_STEP_CHECKPOINT).toBe(20);
        expect(checkpointCrossed(0, 19)).toBe(false);
        expect(checkpointCrossed(19, 20)).toBe(true);
        expect(checkpointCrossed(20, 21)).toBe(false);
        expect(checkpointCrossed(39, 40)).toBe(true);
        expect(checkpointCrossed(5, 5)).toBe(false);
        expect(checkpointsCrossed(18, 45)).toEqual([20, 40]);
        expect(checkpointsCrossed(0, 19)).toEqual([]);
        expect(checkpointsCrossed(20, 20)).toEqual([]);
        expect(checkpointsCrossed(19, 20)).toEqual([20]);
        expect(checkpointsCrossed(0, 60)).toEqual([20, 40, 60]);
    });

    it('says it in one plain line with no price, how to hand the rest to the computer (the App and the steps left, no excuse needed), and to keep quiet about it', () => {
        const note = appStepsNote('Notion', 20);
        expect(note).toContain('Notion');
        expect(note).toContain('use_computer');
        expect(note).toContain('app "Notion"');
        expect(note).toContain('app_steps');
        expect(note).toMatch(/no app_cannot is needed/);
        expect(note).not.toMatch(/\$|cost|price|cheap|cents|spend/i);
    });

    it('asks once when an App passes 20, gives the line by the id of its last result of that round and changes no result, counting across rounds', async () => {
        const counts = new Map<string, number>();
        const ask = vi.fn().mockResolvedValue(true);
        await reviewAppSteps(calls('notion_update', 15), appOf, counts, ask);
        expect(ask).not.toHaveBeenCalled();
        const second = calls('notion_update', 6);
        const before = JSON.stringify(second);
        const review = await reviewAppSteps(second, appOf, counts, ask);
        expect(ask).toHaveBeenCalledTimes(1);
        expect(ask).toHaveBeenCalledWith('Notion', 20);
        expect([...review.notes.keys()]).toEqual(['notion_update-5']);
        expect(review.notes.get('notion_update-5')).toBe(appStepsNote('Notion', 21));
        expect([...review.accepted]).toEqual(['Notion']);
        expect(JSON.stringify(second)).toBe(before);
        expect(counts.get('Notion')).toBe(21);
        // The next ask is at 40, not at 22
        await reviewAppSteps(calls('notion_update', 1), appOf, counts, ask);
        expect(ask).toHaveBeenCalledTimes(1);
    });

    it('reviews every checkpoint a round passes, stops at the first that says yes, and gives one line', async () => {
        const counts = new Map([['Notion', 18]]);
        const asked: number[] = [];
        const ask = vi.fn(async (_app: string, steps: number) => {
            asked.push(steps);
            return steps === 40;
        });
        const review = await reviewAppSteps(calls('notion_update', 27), appOf, counts, ask);
        expect(asked).toEqual([20, 40]);
        expect(review.notes.size).toBe(1);
        expect(review.notes.get('notion_update-26')).toBe(appStepsNote('Notion', 45));
        expect(counts.get('Notion')).toBe(45);
        const none = await reviewAppSteps(calls('notion_update', 27), appOf, new Map([['Notion', 18]]), vi.fn().mockResolvedValue(false));
        expect(none.notes.size).toBe(0);
        expect(none.accepted.size).toBe(0);
    });

    it('adds nothing when Orbit says no, when it cannot be asked, or for a step that failed, waits for an OK, or is not an App; and counts only steps that ran', async () => {
        const counts = new Map<string, number>();
        const mixed = [
            ...calls('notion_update', 18),
            { id: 'bad', name: 'notion_update', result: { error: 'no' } },
            { id: 'wait', name: 'notion_update', result: { status: 'waiting_for_ok', note: 'Waiting for your OK' } },
            { id: 'plain', name: 'notion_update', result: 'Updated' },
            { id: 'map', name: 'get_areas_on_map', result: { areas: [] } },
        ];
        const ask = vi.fn().mockResolvedValue(true);
        const review = await reviewAppSteps(mixed, appOf, counts, ask);
        // 18 + the plain-text one = 19: neither the failed step nor the one waiting for an OK counted
        expect(counts.get('Notion')).toBe(19);
        expect(ask).not.toHaveBeenCalled();
        expect(review.notes.size).toBe(0);
        const waitingAt20 = [...calls('notion_update', 1), { id: 'wait', name: 'notion_update', result: { status: 'waiting_for_ok' } }];
        const again = await reviewAppSteps(waitingAt20, appOf, counts, ask);
        expect([...again.notes.keys()]).toEqual(['notion_update-0']);
        const down = await reviewAppSteps(calls('notion_update', 1), appOf, new Map([['Notion', 19]]), vi.fn().mockRejectedValue(new Error('down')));
        expect(down.notes.size).toBe(0);
    });

    it('gives the line for a plain-text result and a link-only result too, since it goes with the id and not into the result', async () => {
        const counts = new Map([['Notion', 19]]);
        const review = await reviewAppSteps([{ id: 'p', name: 'notion_update', result: 'Updated' }], appOf, counts, vi.fn().mockResolvedValue(true));
        expect(review.notes.get('p')).toContain('Notion');
        const links = [{ id: 'l', name: 'notion_update', result: [{ type: 'resource_link', uri: 'https://x.test/a' }] }];
        const kept = JSON.stringify(links);
        const linked = await reviewAppSteps(links, appOf, new Map([['Notion', 19]]), vi.fn().mockResolvedValue(true));
        expect(linked.notes.get('l')).toContain('Notion');
        expect(JSON.stringify(links)).toBe(kept);
    });

    it('does not ask for a turn that was stopped', async () => {
        const ask = vi.fn().mockResolvedValue(true);
        const review = await reviewAppSteps(calls('notion_update', 20), appOf, new Map(), ask, () => true);
        expect(ask).not.toHaveBeenCalled();
        expect(review.notes.size).toBe(0);
    });

    it('counts each App by itself', async () => {
        const counts = new Map<string, number>();
        const ask = vi.fn().mockResolvedValue(false);
        await reviewAppSteps([...calls('notion_x', 12), ...calls('linear_x', 12)], appOf, counts, ask);
        expect(ask).not.toHaveBeenCalled();
        expect([...counts]).toEqual([['Notion', 12], ['Linear', 12]]);
    });

    it('lets a use_computer that follows an accepted review reach Orbit with the App and the steps left, with no excuse, and keeps the App-first guard for any other', async () => {
        const admin = asking({ ok: false, reason: 'cheaper_route', app: 'GitHub' });
        const named = { job: 'Update the rest of the labels', details: 'on GitHub, the remaining 40 issues', app: 'GitHub', app_steps: 40 };
        const guarded = await runComputerTool(named, { admin, botId: BRICK, userId: 'u', apps: ['GitHub'] });
        expect(String(guarded.note)).toContain('do the job through GitHub first');
        expect(admin.startComputerJob).not.toHaveBeenCalled();
        // After an accepted review for that App: to Orbit, with the plan
        await runComputerTool(named, { admin, botId: BRICK, userId: 'u', apps: ['GitHub'], reviewed: new Set(['github']) });
        expect(admin.startComputerJob).toHaveBeenCalledWith(BRICK, 'u', expect.objectContaining({ plan: { app: 'GitHub', steps: 40 } }));
        // Without the step count it is still the ordinary guard, and an App the review was not about too
        admin.startComputerJob.mockClear();
        await runComputerTool({ ...named, app_steps: undefined }, { admin, botId: BRICK, userId: 'u', apps: ['GitHub'], reviewed: new Set(['GitHub']) });
        await runComputerTool(named, { admin, botId: BRICK, userId: 'u', apps: ['GitHub'], reviewed: new Set(['Notion']) });
        expect(admin.startComputerJob).not.toHaveBeenCalled();
    });

    it('puts the line first in the model\'s copy, so a long result that is cut for room keeps it', () => {
        const note = appStepsNote('Notion', 20);
        const text = withReviewNote(`notion_update: ${'x'.repeat(20_000)}`, note);
        expect(text.startsWith(note)).toBe(true);
        expect(withReviewNote('Updated', undefined)).toBe('Updated');
        const room = new StepRoom(3_000);
        room.add(stepOf(1, '', [{ id: 'c1', name: 'notion_update', arguments: '{}' }], [{ id: 'c1', name: 'notion_update', text }]));
        const kept = room.steps[0].results[0].content;
        expect(kept.length).toBeLessThan(text.length);
        expect(kept).toContain(note);
    });
});
