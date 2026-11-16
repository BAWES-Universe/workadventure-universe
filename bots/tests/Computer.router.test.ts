/**
 * The fixed order a Brick chooses its way in: answer, then an app, then the computer. The app step is checked where the job is started:
 * a job that names one of the person's connected apps goes there first, unless Brick says in its own words why the app cannot do it.
 */
import { describe, expect, it, vi } from 'vitest';
import { APP_STEP_CHECKPOINT, appStepsNote, appThatFits, checkpointCrossed, computerToolDefinitions, reviewAppSteps, runComputerTool, withNote } from '../ai/ComputerTools';

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

    it('is every 20 steps an app takes in one answer', () => {
        expect(APP_STEP_CHECKPOINT).toBe(20);
        expect(checkpointCrossed(0, 19)).toBe(false);
        expect(checkpointCrossed(19, 20)).toBe(true);
        expect(checkpointCrossed(20, 21)).toBe(false);
        expect(checkpointCrossed(18, 45)).toBe(true);
        expect(checkpointCrossed(39, 40)).toBe(true);
        expect(checkpointCrossed(5, 5)).toBe(false);
    });

    it('says it in one plain line with no price, and tells the model to keep quiet about it', () => {
        const note = appStepsNote('Notion', 20);
        expect(note).toContain('Notion');
        expect(note).toContain('use_computer');
        expect(note).toContain('app_steps');
        expect(note).not.toMatch(/\$|cost|price|cheap|cents|spend/i);
    });

    it('puts the line on a result as the model reads it, and leaves anything it cannot read alone', () => {
        expect(withNote(page('done'), 'n')).toEqual([...page('done'), { type: 'text', text: 'n' }]);
        expect(withNote({ ok: true }, 'n')).toEqual({ ok: true, note: 'n' });
        expect(withNote('plain', 'n')).toBe('plain');
        expect(withNote(null, 'n')).toBeNull();
    });

    it('asks once when an app passes 20 and notes its last result of that round, counting across rounds', async () => {
        const counts = new Map<string, number>();
        const ask = vi.fn().mockResolvedValue(true);
        const round = (n: number) => Array.from({ length: n }, (_, i) => ({ name: 'notion_update', result: page(`r${i}`) }));
        await reviewAppSteps(round(15), appOf, counts, ask);
        expect(ask).not.toHaveBeenCalled();
        const second = round(6);
        await reviewAppSteps(second, appOf, counts, ask);
        expect(ask).toHaveBeenCalledTimes(1);
        expect(ask).toHaveBeenCalledWith('Notion', 21);
        expect(second[5].result).toHaveLength(2);
        expect(second[4].result).toHaveLength(1);
        expect(counts.get('Notion')).toBe(21);
        // The next ask is at 40, not at 22
        await reviewAppSteps(round(1), appOf, counts, ask);
        expect(ask).toHaveBeenCalledTimes(1);
    });

    it('adds nothing when Orbit says no, when it cannot be asked, or for a step that failed or is not an App', async () => {
        const counts = new Map<string, number>();
        const calls = [
            ...Array.from({ length: 20 }, () => ({ name: 'notion_update', result: page('r') })),
            { name: 'notion_update', result: { error: 'no' } },
            { name: 'get_areas_on_map', result: { areas: [] } },
        ];
        await reviewAppSteps(calls, appOf, counts, vi.fn().mockResolvedValue(false));
        expect(calls.every((call) => !Array.isArray(call.result) || call.result.length === 1)).toBe(true);
        expect(counts.get('Notion')).toBe(20);
        const again = [{ name: 'notion_update', result: page('r') }];
        await expect(reviewAppSteps(again, appOf, new Map([['Notion', 19]]), vi.fn().mockRejectedValue(new Error('down')))).resolves.toBeUndefined();
        expect(again[0].result).toHaveLength(1);
    });

    it('counts each App by itself', async () => {
        const counts = new Map<string, number>();
        const ask = vi.fn().mockResolvedValue(false);
        const calls = [...Array.from({ length: 12 }, () => ({ name: 'notion_x', result: page('r') })), ...Array.from({ length: 12 }, () => ({ name: 'linear_x', result: page('r') }))];
        await reviewAppSteps(calls, appOf, counts, ask);
        expect(ask).not.toHaveBeenCalled();
        expect([...counts]).toEqual([['Notion', 12], ['Linear', 12]]);
    });
});
