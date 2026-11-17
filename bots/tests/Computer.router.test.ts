/**
 * The fixed order a Brick chooses its way in: answer, then an app, then the computer. The app step is checked where the job is started:
 * a job that names one of the person's connected apps goes there first, unless Brick says in its own words why the app cannot do it.
 */
import { describe, expect, it, vi } from 'vitest';
import { appThatFits, computerToolDefinitions, runComputerTool } from '../ai/ComputerTools';

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
});
