/**
 * Watches, briefings and goals on a model (game #2002): a run is a system job with its own context. It ends in one call to finish_check,
 * is said once under the run's own id, reports what it found, never speaks for a run that was changed meanwhile, and its model calls are
 * on the books one row each under the run's id. Reminders never wait behind a model.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));
vi.mock('../utils/MovementLogger', () => ({ movementLogger: {} }));

import { AIService } from '../ai/AIService';
import {
    BrickRunner,
    MODEL_KINDS,
    RUNNABLE_KINDS,
    dueRunOf,
    failedNoticeOf,
    failedText,
    heldNoticeOf,
    heldText,
    type BrickRunnerApi,
    type BrickSpeaker,
    type BrickTaskModel,
    type DueRun,
    type FailedNotice,
    type HeldNotice,
    type RunReport,
    type TaskOutcome,
} from '../server/BrickRunner';
import { ModelTaskRunner, type TaskBrick } from '../server/BrickTaskModel';
import { FINISH_CHECK_TOOL, READ_PAGE_TOOL, clockWords, readFinish, taskPrompt, taskToolDefinitions, type TaskResult } from '../server/BrickTaskRun';

const run = (over: Partial<DueRun> = {}): DueRun => ({
    runId: 'run-1',
    itemId: 'item-1',
    brickId: 'brick-1',
    userId: 'sara-uuid',
    matrixUserId: '@sara:matrix.test',
    kind: 'watch',
    words: 'Tell me when the flight drops under KWD 90',
    condition: 'The price is under KWD 90',
    outcome: null,
    steps: [],
    statusLine: null,
    timeZone: 'Asia/Kuwait',
    dueAt: '2026-11-15T09:00:00.000Z',
    late: false,
    fresh: false,
    attempt: 1,
    deliveredEventId: null,
    deliveredReport: null,
    ...over,
});

const heldNotice = (over: Partial<HeldNotice> = {}): HeldNotice => ({
    itemId: 'item-9',
    brickId: 'brick-1',
    userId: 'sara-uuid',
    matrixUserId: '@sara:matrix.test',
    kind: 'goal',
    words: 'Visa in hand before 12 Dec',
    resumesAt: '2026-11-15T08:20:00.000Z',
    timeZone: 'Asia/Kuwait',
    waitId: 'wait-1',
    ...over,
});

describe('how a check ends', () => {
    it('reads each result for the kind of run it is, and tells the model what to fix', () => {
        expect(readFinish({ result: 'nothing_new' }, 'watch')).toMatchObject({ ok: true, result: { kind: 'nothing_new' } });
        // A briefing is always delivered, also when empty
        expect(readFinish({ result: 'nothing_new' }, 'schedule')).toMatchObject({ ok: false });
        expect(readFinish({ result: 'tell_them', message: 'Nothing scheduled today' }, 'schedule')).toMatchObject({ ok: true, result: { kind: 'tell', message: 'Nothing scheduled today', needsYou: false } });
        expect(readFinish({ result: 'tell_them' }, 'watch')).toMatchObject({ ok: false });
        expect(readFinish({ result: 'tell_them', message: 'Pay now', needs_you: true }, 'goal')).toMatchObject({ ok: true, result: { kind: 'tell', needsYou: true } });
        expect(readFinish({ result: 'cannot', reason: 'I cannot use your calendar yet' }, 'schedule')).toMatchObject({ ok: true, result: { kind: 'cannot' } });
        expect(readFinish({ result: 'cannot' }, 'schedule')).toMatchObject({ ok: false });
        expect(readFinish({ result: 'explode' }, 'goal')).toMatchObject({ ok: false });
    });

    it('lets only a goal ask its person once, and only with what it found and which question it is', () => {
        expect(readFinish({ result: 'ask_them', ask: 'unsure', message: 'Is it done?' }, 'watch')).toMatchObject({ ok: false });
        expect(readFinish({ result: 'ask_them', ask: 'unsure' }, 'goal')).toMatchObject({ ok: false });
        expect(readFinish({ result: 'ask_them', ask: 'sometime', message: 'Is it done?' }, 'goal')).toMatchObject({ ok: false });
        expect(readFinish({ result: 'ask_them', ask: 'date_passed', message: 'The date passed.', status_line: 'Past the date' }, 'goal')).toMatchObject({
            ok: true,
            result: { kind: 'ask', ask: 'date_passed', message: 'The date passed.', progress: { statusLine: 'Past the date' } },
        });
    });

    it('lets only a goal reach an outcome, and only with the evidence', () => {
        expect(readFinish({ result: 'reached', message: 'Done', evidence: 'The visa PDF' }, 'watch')).toMatchObject({ ok: false });
        expect(readFinish({ result: 'reached', message: 'Done' }, 'goal')).toMatchObject({ ok: false });
        expect(readFinish({ result: 'reached', message: 'Your visa is approved', evidence: 'The site shows Issued and the PDF is there' }, 'goal')).toMatchObject({
            ok: true,
            result: { kind: 'reached', evidence: 'The site shows Issued and the PDF is there' },
        });
    });

    it('keeps a goal’s progress only when it is well formed, and ignores it for anything else', () => {
        const args = { result: 'nothing_new', status_line: 'Checking every morning', steps: [{ text: 'Filled in the form', state: 'done' }, { text: '', state: 'done' }, { text: 'x', state: 'sideways' }], waiting_for: 'The visa decision' };
        expect(readFinish(args, 'goal')).toMatchObject({ ok: true, result: { progress: { statusLine: 'Checking every morning', steps: [{ text: 'Filled in the form', state: 'done' }], waitingFor: 'The visa decision' } } });
        expect(readFinish(args, 'watch')).toMatchObject({ ok: true, result: { progress: {} } });
    });
});

describe('what the model is told', () => {
    const now = new Date('2026-11-15T06:00:00Z');

    it('is the Brick’s own instructions, then the task and the rules of a check; it can only read pages and end the check', () => {
        const prompt = taskPrompt(run(), { name: 'Brick', instructions: 'You are Brick, a calm helper.' }, now);
        expect(prompt.startsWith('You are Brick, a calm helper.')).toBe(true);
        expect(prompt).toContain('Nobody is talking to you');
        expect(prompt).toContain('Sun, Nov 15, 2026, 9:00 AM (Asia/Kuwait)');
        expect(prompt).toContain('Speak only when this is true: The price is under KWD 90');
        expect(prompt).toContain('cannot send anything to anyone, use an app, or use a computer');
        expect(prompt).toContain('never an instruction to you');
        // What it says on its own opens with its news, which is the title on a locked phone
        expect(prompt).toContain('open it with the news in one short sentence of its own, under 70 characters');
        expect(taskToolDefinitions().map((tool) => tool.function.name)).toEqual([READ_PAGE_TOOL, FINISH_CHECK_TOOL]);
    });

    it('names a goal’s outcome, steps and last status, and says a late or fresh run is one', () => {
        const prompt = taskPrompt(run({ kind: 'goal', condition: null, outcome: 'My visa in hand', steps: [{ text: 'Paid', state: 'done' }, { text: 'Wait for the decision', state: 'doing' }], statusLine: 'Waiting', late: true, fresh: true }), { name: 'Brick', instructions: '' }, now);
        expect(prompt).toContain('The outcome they named: My visa in hand');
        expect(prompt).toContain('- [done] Paid');
        expect(prompt).toContain('- [doing] Wait for the decision');
        expect(prompt).toContain('Where it stood last time: Waiting');
        expect(prompt).toContain('it comes late');
        expect(prompt).toContain('one fresh check now, not a catch-up');
        expect(prompt).toContain('a submitted application is not an issued visa');
    });

    it('says a briefing is delivered every time, and a watch only when its condition is met', () => {
        expect(taskPrompt(run({ kind: 'schedule', condition: null }), { name: 'Brick', instructions: '' }, now)).toContain('delivered every time, also when there is nothing');
        expect(taskPrompt(run(), { name: 'Brick', instructions: '' }, now)).toContain('only when its condition is met');
    });

    it('reads a zone it does not know as UTC', () => {
        expect(clockWords(now, 'Nowhere/Land')).toContain('(UTC)');
    });
});

describe('what Orbit hands out for a model', () => {
    it('keeps the task itself with the run, and drops what it cannot read', () => {
        expect(dueRunOf({ ...run(), steps: [{ text: 'a', state: 'done' }, { text: '', state: 'done' }, 'x'], statusLine: 'Fine', fresh: true })).toMatchObject({ condition: 'The price is under KWD 90', steps: [{ text: 'a', state: 'done' }], statusLine: 'Fine', fresh: true });
        expect(heldNoticeOf(heldNotice())).toEqual(heldNotice());
        expect(heldNoticeOf({ ...heldNotice(), kind: 'quest' })).toBeNull();
        expect(heldNoticeOf({ ...heldNotice(), waitId: '' })).toBeNull();
        expect(heldNoticeOf({ ...heldNotice(), matrixUserId: undefined })?.matrixUserId).toBeNull();
    });
});

// --- the runner, with a fake model ----------------------------------------------------------------------------------------------------------

function setUp(due: DueRun[], model: BrickTaskModel['run'], over: { say?: BrickSpeaker['say']; check?: () => Promise<{ ok: boolean; reason?: string }>; held?: HeldNotice[]; failed?: FailedNotice[]; tell?: boolean; askPerson?: 'unsure' | 'date_passed' | null; keepAsked?: boolean } = {}) {
    const reports: Array<{ runId: string; report: RunReport }> = [];
    const api: BrickRunnerApi = {
        claimDue: vi.fn(async (_kinds: readonly string[]) => ({ runs: due, held: over.held ?? [], failed: over.failed ?? [] })),
        checkRun: vi.fn((over.check ?? (async () => ({ ok: true }))) as BrickRunnerApi['checkRun']),
        keepDelivered: vi.fn(async () => true),
        keepTold: vi.fn(async () => true),
        keepHeldTold: vi.fn(async () => true),
        keepAsked: vi.fn(async () => over.keepAsked !== false),
        report: vi.fn(async (runId, report) => {
            reports.push({ runId, report });
            return { tellPerson: over.tell === true, ...(over.askPerson !== undefined ? { askPerson: over.askPerson } : {}) };
        }),
    };
    const say = vi.fn(over.say ?? (async (_b: string, _u: string, _t: string, _x: string) => ({ ok: true as const, eventId: '$e1' })));
    const warn = vi.fn();
    const modelRun = vi.fn(model);
    const runner = new BrickRunner(api, { say }, { warn }, { run: modelRun });
    return { runner, api, say, reports, warn, modelRun };
}

const result = (r: TaskOutcome): BrickTaskModel['run'] => async () => r;

describe('a watch, a briefing or a goal runs on a model', () => {
    it('asks Orbit for every kind when it has a model, and for reminders only when it has none', async () => {
        const { runner, api } = setUp([], result({ kind: 'unsure' }));
        await runner.tick();
        expect(api.claimDue).toHaveBeenCalledWith(MODEL_KINDS);
        const withoutModel = new BrickRunner({ ...api, claimDue: vi.fn(async () => ({ runs: [], held: [] })) }, { say: vi.fn() }, { warn: vi.fn() });
        await withoutModel.tick();
        expect(withoutModel['api'].claimDue).toHaveBeenCalledWith(RUNNABLE_KINDS);
    });

    it('says nothing, and reports a quiet check, when there is nothing new', async () => {
        const { runner, say, reports } = setUp([run()], result({ kind: 'result', result: { kind: 'nothing_new', progress: {} } }));
        await runner.tick();
        await runner.idle();
        expect(say).not.toHaveBeenCalled();
        expect(reports).toEqual([{ runId: 'run-1', report: { attempt: 1, state: 'done', outcome: 'quiet', result: 'Nothing new' } }]);
    });

    it('says what the model wrote, once, under the run’s own id, keeps where it went, then reports it', async () => {
        const { runner, say, api, reports } = setUp([run()], result({ kind: 'result', result: { kind: 'tell', message: 'The flight is KWD 86 now.', needsYou: false, progress: {} } }));
        await runner.tick();
        await runner.idle();
        expect(say).toHaveBeenCalledTimes(1);
        expect(say).toHaveBeenCalledWith('brick-1', '@sara:matrix.test', 'The flight is KWD 86 now.', 'brick-run:run-1');
        // Kept with how the run is to be reported, so a restart cannot turn it into a plain “said”
        expect(api.keepDelivered).toHaveBeenCalledWith('run-1', '$e1', { outcome: 'spoke', result: 'The flight is KWD 86 now.' });
        expect(reports).toEqual([{ runId: 'run-1', report: { attempt: 1, state: 'done', outcome: 'spoke', result: 'The flight is KWD 86 now.' } }]);
        const order = [(api.keepDelivered as any).mock.invocationCallOrder[0], (api.report as any).mock.invocationCallOrder[0]];
        expect(order[0]).toBeLessThan(order[1]);
    });

    it('reports a goal’s progress, and that it needs the person when it says so', async () => {
        const progress = { statusLine: 'Paid, waiting for a decision', steps: [{ text: 'Paid', state: 'done' as const }] };
        const { runner, reports } = setUp([run({ kind: 'goal' })], result({ kind: 'result', result: { kind: 'tell', message: 'I need your passport scan.', needsYou: true, progress } }));
        await runner.tick();
        await runner.idle();
        expect(reports[0].report).toMatchObject({ state: 'done', outcome: 'waiting', progress });
    });

    it('closes a goal that reached its outcome, with the evidence as the result', async () => {
        const { runner, say, reports } = setUp([run({ kind: 'goal' })], result({ kind: 'result', result: { kind: 'reached', message: 'Your visa is approved.', evidence: 'The site shows Issued and the PDF is attached', progress: {} } }));
        await runner.tick();
        await runner.idle();
        expect(say.mock.calls[0][2]).toBe('Your visa is approved.');
        expect(reports[0].report).toMatchObject({ state: 'done', outcome: 'spoke', reached: true, result: 'The site shows Issued and the PDF is attached' });
    });

    describe('a goal that asks its person once', () => {
        const asks = (over: Partial<Extract<TaskResult, { kind: 'ask' }>> = {}): TaskOutcome => ({
            kind: 'result',
            result: { kind: 'ask', ask: 'unsure', message: 'The site shows Pending, not Issued. Is the visa in hand?', progress: { statusLine: 'Waiting on the decision' }, ...over },
        });

        it('reports first, then asks in the person’s chat with the three answers, then keeps that it asked', async () => {
            const { runner, say, api, reports } = setUp([run({ kind: 'goal' })], result(asks()), { askPerson: 'unsure' });
            await runner.tick();
            await runner.idle();
            expect(reports[0].report).toMatchObject({ state: 'done', outcome: 'waiting', ask: 'unsure', result: 'The site shows Pending, not Issued. Is the visa in hand?', progress: { statusLine: 'Waiting on the decision' } });
            expect(say).toHaveBeenCalledTimes(1);
            expect(say).toHaveBeenCalledWith('brick-1', '@sara:matrix.test', 'The site shows Pending, not Issued. Is the visa in hand?\n\nYou can tell me: close it, keep going, or change it.', 'brick-run:run-1');
            expect(api.keepAsked).toHaveBeenCalledWith('run-1');
            const order = [(api.report as any).mock.invocationCallOrder[0], say.mock.invocationCallOrder[0], (api.keepAsked as any).mock.invocationCallOrder[0]];
            expect(order).toEqual([...order].sort((a, b) => a - b));
            // Never as a plain "said": nothing is kept as delivered
            expect(api.keepDelivered).not.toHaveBeenCalled();
        });

        it('says nothing when Orbit says this run does not ask (a question is open, or the person said keep going)', async () => {
            for (const askPerson of [null, undefined]) {
                const { runner, say, api, reports } = setUp([run({ kind: 'goal' })], result(asks({ ask: 'date_passed' })), { askPerson });
                await runner.tick();
                await runner.idle();
                expect(reports[0].report).toMatchObject({ outcome: 'waiting', ask: 'date_passed' });
                expect(say).not.toHaveBeenCalled();
                expect(api.keepAsked).not.toHaveBeenCalled();
            }
        });

        it('says nothing, and keeps nothing, when Orbit did not take the report', async () => {
            const { runner, say, api } = setUp([run({ kind: 'goal' })], result(asks()), { askPerson: 'unsure' });
            (api.report as any).mockResolvedValueOnce(null);
            await runner.tick();
            await runner.idle();
            expect(say).not.toHaveBeenCalled();
            expect(api.keepAsked).not.toHaveBeenCalled();
        });

        it('does not keep that it asked when it could not be said, and does not turn that into a failed run', async () => {
            const { runner, api, reports, warn } = setUp([run({ kind: 'goal' })], result(asks()), { askPerson: 'unsure', say: async () => ({ ok: false as const, reason: 'unsure' as const }) });
            await runner.tick();
            await runner.idle();
            expect(api.keepAsked).not.toHaveBeenCalled();
            expect(reports).toHaveLength(1);
            expect(reports[0].report.state).toBe('done');
            expect(warn).toHaveBeenCalled();
        });

        it('says it even when Orbit would not take the confirmation, so the person is never left unasked', async () => {
            const { runner, say, api, warn } = setUp([run({ kind: 'goal' })], result(asks()), { askPerson: 'unsure', keepAsked: false });
            await runner.tick();
            await runner.idle();
            expect(say).toHaveBeenCalledTimes(1);
            expect(api.keepAsked).toHaveBeenCalledTimes(1);
            expect(warn).toHaveBeenCalled();
        });
    });

    it('reports a step it cannot do as a failure, and tells the person once when Orbit says so, keeping that only after it went out', async () => {
        const first = setUp([run({ kind: 'schedule' })], result({ kind: 'result', result: { kind: 'cannot', reason: "I can't check your calendar yet" } }), { tell: true });
        await first.runner.tick();
        await first.runner.idle();
        expect(first.reports[0].report).toMatchObject({ state: 'failed', error: "I can't check your calendar yet" });
        expect(first.say).toHaveBeenCalledWith('brick-1', '@sara:matrix.test', failedText(run(), "I can't check your calendar yet"), 'brick-run-told:run-1'.replace('brick-run-told', 'brick-told'));
        expect(first.api.keepTold).toHaveBeenCalledWith('run-1');
        // The tell did not go out: it is not kept, so the next failure asks again
        const second = setUp([run({ kind: 'schedule' })], result({ kind: 'failed', error: 'x' }), { tell: true, say: async () => ({ ok: false, reason: 'unsure' }) });
        await second.runner.tick();
        await second.runner.idle();
        expect(second.api.keepTold).not.toHaveBeenCalled();
        // Not told when Orbit does not say so
        const third = setUp([run()], result({ kind: 'failed', error: 'x' }));
        await third.runner.tick();
        await third.runner.idle();
        expect(third.say).not.toHaveBeenCalled();
        expect(third.reports[0].report.state).toBe('failed');
    });

    it('leaves a run unreported when it was changed meanwhile, or the model could not tell: its lease hands it out again', async () => {
        for (const outcome of [{ kind: 'stopped' }, { kind: 'unsure' }] as TaskOutcome[]) {
            const { runner, say, reports } = setUp([run()], result(outcome));
            await runner.tick();
            await runner.idle();
            expect(say).not.toHaveBeenCalled();
            expect(reports).toEqual([]);
        }
    });

    it('says nothing for a run that was paused, finished or changed while the model worked', async () => {
        let asked = 0;
        const { runner, say, reports } = setUp([run()], result({ kind: 'result', result: { kind: 'tell', message: 'Now KWD 86', needsYou: false, progress: {} } }), {
            check: async () => ({ ok: ++asked === 1 }),
        });
        await runner.tick();
        await runner.idle();
        expect(say).not.toHaveBeenCalled();
        expect(reports).toEqual([]);
    });

    it('does not start the model for a run that may not go on, and treats a check that fails as "not now"', async () => {
        const stopped = setUp([run()], result({ kind: 'unsure' }), { check: async () => ({ ok: false, reason: 'paused' }) });
        await stopped.runner.tick();
        await stopped.runner.idle();
        expect(stopped.modelRun).not.toHaveBeenCalled();
        const broken = setUp([run()], result({ kind: 'unsure' }), {
            check: async () => {
                throw new Error('Orbit down');
            },
        });
        await broken.runner.tick();
        await broken.runner.idle();
        expect(broken.modelRun).not.toHaveBeenCalled();
        expect(broken.reports).toEqual([]);
    });

    it('does not run, or say, a run again that was said before: it is reported done', async () => {
        const { runner, say, modelRun, reports } = setUp([run({ attempt: 2, deliveredEventId: '$e1' })], result({ kind: 'unsure' }));
        await runner.tick();
        await runner.idle();
        expect(modelRun).not.toHaveBeenCalled();
        expect(say).not.toHaveBeenCalled();
        expect(reports[0].report).toMatchObject({ attempt: 2, state: 'done', outcome: 'spoke' });
    });

    it('reports a goal that was said but could not be reported whole when it is handed out again, not as a plain “said”', async () => {
        const due = [run({ kind: 'goal', condition: null, outcome: 'My visa in hand' })];
        const reached: TaskOutcome = { kind: 'result', result: { kind: 'reached', message: 'Your visa is approved', evidence: 'The site shows Issued', progress: { statusLine: 'Done' } } };
        const { runner, say, api, reports } = setUp(due, result(reached));
        // Orbit does not take the first report
        vi.mocked(api.report).mockImplementationOnce(async () => null);
        await runner.tick();
        await runner.idle();
        expect(say).toHaveBeenCalledTimes(1);
        // Handed out again, said before
        due.splice(0, 1, run({ kind: 'goal', condition: null, outcome: 'My visa in hand', attempt: 2, deliveredEventId: '$e1' }));
        await runner.tick();
        await runner.idle();
        expect(say).toHaveBeenCalledTimes(1);
        expect(reports).toHaveLength(1);
        expect(reports[0].report).toMatchObject({ attempt: 2, state: 'done', outcome: 'spoke', result: 'The site shows Issued', reached: true, progress: { statusLine: 'Done' } });
        // Reported now: the next hand out is a plain “said”
        due.splice(0, 1, run({ kind: 'goal', attempt: 3, deliveredEventId: '$e1' }));
        await runner.tick();
        await runner.idle();
        expect(reports[1].report).toMatchObject({ attempt: 3, result: 'Said in chat' });
        expect(reports[1].report).not.toHaveProperty('reached');
    });

    it('reports a goal that reached its outcome whole after a restart, from what Orbit kept with the delivery', async () => {
        const kept = { outcome: 'spoke' as const, result: 'The site shows Issued', reached: true, progress: { statusLine: 'Done' } };
        const { runner, say, modelRun, reports } = setUp([run({ kind: 'goal', condition: null, outcome: 'My visa in hand', attempt: 2, deliveredEventId: '$e1', deliveredReport: kept })], result({ kind: 'unsure' }));
        await runner.tick();
        await runner.idle();
        expect(modelRun).not.toHaveBeenCalled();
        expect(say).not.toHaveBeenCalled();
        expect(reports).toHaveLength(1);
        expect(reports[0].report).toEqual({ attempt: 2, state: 'done', ...kept });
    });

    it('keeps a goal’s whole report with where it went, so it is there to be handed back', async () => {
        const reached: TaskOutcome = { kind: 'result', result: { kind: 'reached', message: 'Your visa is approved', evidence: 'The site shows Issued', progress: { statusLine: 'Done' } } };
        const { runner, api } = setUp([run({ kind: 'goal', condition: null, outcome: 'My visa in hand' })], result(reached));
        await runner.tick();
        await runner.idle();
        expect(api.keepDelivered).toHaveBeenCalledWith('run-1', '$e1', { outcome: 'spoke', result: 'The site shows Issued', reached: true, progress: { statusLine: 'Done' } });
    });

    it('reads what Orbit kept only when it is well formed', () => {
        const base = { runId: 'r', itemId: 'i', brickId: 'b', userId: 'u', words: 'w', timeZone: 'Asia/Kuwait', dueAt: '2026-11-15T09:00:00.000Z', kind: 'goal', attempt: 2, deliveredEventId: '$e' };
        expect(dueRunOf({ ...base, deliveredReport: { outcome: 'spoke', result: 'x', reached: true } })?.deliveredReport).toEqual({ outcome: 'spoke', result: 'x', reached: true });
        expect(dueRunOf({ ...base, deliveredReport: { outcome: 'quiet', result: 'x' } })?.deliveredReport).toBeNull();
        expect(dueRunOf({ ...base, deliveredReport: { outcome: 'spoke' } })?.deliveredReport).toBeNull();
        expect(dueRunOf(base)?.deliveredReport).toBeNull();
    });

    it('carries on as the newer try when a run is handed out again while its first try is at work', async () => {
        const due = [run({ attempt: 1 })];
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const checks: number[] = [];
        let handedAgain = false;
        const { runner, modelRun, reports } = setUp(
            due,
            async (_run, permit) => {
                await gate;
                // Asked after the second try was handed out: it is asked for the try held now
                expect(await permit()).toBe(true);
                return { kind: 'result', result: { kind: 'nothing_new', progress: {} } };
            },
            { check: async () => ({ ok: true }) }
        );
        vi.mocked(runner['api'].checkRun).mockImplementation(async (_runId: string, attempt: number) => {
            checks.push(attempt);
            // Orbit: once it was handed out again, only the newer try may go on
            return handedAgain && attempt === 1 ? { ok: false, reason: 'stale' } : { ok: true };
        });
        await runner.tick();
        await vi.waitFor(() => expect(modelRun).toHaveBeenCalledTimes(1));
        // The lease ran out: the same run, a newer try
        due.splice(0, 1, run({ attempt: 2 }));
        handedAgain = true;
        await runner.tick();
        release();
        await runner.idle();
        expect(modelRun).toHaveBeenCalledTimes(1);
        expect(checks.at(-1)).toBe(2);
        expect(reports).toEqual([{ runId: 'run-1', report: { attempt: 2, state: 'done', outcome: 'quiet', result: 'Nothing new' } }]);
    });

    it('reports a person with no chat as failed, and leaves one it cannot tell about unreported', async () => {
        const noChat = setUp([run({ matrixUserId: null })], result({ kind: 'result', result: { kind: 'tell', message: 'x', needsYou: false, progress: {} } }));
        await noChat.runner.tick();
        await noChat.runner.idle();
        expect(noChat.reports[0].report).toMatchObject({ state: 'failed' });
        const blip = setUp([run()], result({ kind: 'result', result: { kind: 'tell', message: 'x', needsYou: false, progress: {} } }), { say: async () => ({ ok: false, reason: 'unsure' }) });
        await blip.runner.tick();
        await blip.runner.idle();
        expect(blip.reports).toEqual([]);
    });

    it('leaves a run that is handed out again while it is still being worked on to the first try', async () => {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const { runner, modelRun } = setUp([run()], async () => (await gate, { kind: 'unsure' as const }));
        await runner.tick();
        await runner.tick();
        expect(modelRun).toHaveBeenCalledTimes(1);
        release();
        await runner.idle();
    });

    it('never makes a reminder wait behind a model: the round ends with the reminder said while the model still works', async () => {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const reminder = run({ runId: 'run-r', kind: 'reminder', condition: null });
        const { runner, say, reports } = setUp([run(), reminder], async () => (await gate, { kind: 'unsure' as const }));
        expect(await runner.tick()).toBe(1);
        expect(reports.map((one) => one.runId)).toEqual(['run-r']);
        expect(say.mock.calls[0][2]).toBe('Reminder: Tell me when the flight drops under KWD 90');
        release();
        await runner.idle();
    });

    it('works on three at a time, and the next one starts when one ends', async () => {
        const gates: Array<() => void> = [];
        let live = 0;
        let most = 0;
        const model: BrickTaskModel['run'] = async () => {
            live += 1;
            most = Math.max(most, live);
            await new Promise<void>((resolve) => gates.push(resolve));
            live -= 1;
            return { kind: 'unsure' };
        };
        const { runner } = setUp([1, 2, 3, 4, 5].map((n) => run({ runId: `run-${n}` })), model);
        await runner.tick();
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(most).toBe(3);
        while (gates.length > 0) {
            gates.shift()!();
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        await runner.idle();
        expect(most).toBe(3);
    });
});

describe('what waits for usage is said once', () => {
    it('says it under its own id for that wait, and keeps it only after it went out', async () => {
        const { runner, say, api } = setUp([], result({ kind: 'unsure' }), { held: [heldNotice()] });
        await runner.tick();
        expect(say).toHaveBeenCalledWith('brick-1', '@sara:matrix.test', heldText(heldNotice()), 'brick-held:item-9:wait-1');
        expect(api.keepHeldTold).toHaveBeenCalledWith('item-9', 'wait-1');
    });

    it('says when it carries on, in the person’s own zone, and that nothing is lost and chat still works', () => {
        const text = heldText(heldNotice());
        expect(text).toContain('goals and tasks have used their part of your usage for now');
        expect(text).toContain('Nothing is lost');
        expect(text).toContain('carries on at 11:20 AM');
        expect(text).toContain('You can still chat with me as usual');
    });

    it('does not keep it as told when it could not be said just now, so it is handed out again', async () => {
        const blip = setUp([], result({ kind: 'unsure' }), { held: [heldNotice()], say: async () => ({ ok: false, reason: 'unsure' }) });
        await blip.runner.tick();
        expect(blip.api.keepHeldTold).not.toHaveBeenCalled();
    });

    it('keeps it as told, once and with a line in the log, when it can never be said: no chat, or a chat that refuses', async () => {
        const noChat = setUp([], result({ kind: 'unsure' }), { held: [heldNotice({ matrixUserId: null })] });
        await noChat.runner.tick();
        expect(noChat.say).not.toHaveBeenCalled();
        expect(noChat.api.keepHeldTold).toHaveBeenCalledTimes(1);
        expect(noChat.api.keepHeldTold).toHaveBeenCalledWith('item-9', 'wait-1');
        expect(noChat.warn).toHaveBeenCalledTimes(1);
        for (const reason of ['no_chat', 'not_allowed'] as const) {
            const refused = setUp([], result({ kind: 'unsure' }), { held: [heldNotice()], say: async () => ({ ok: false, reason }) });
            await refused.runner.tick();
            expect(refused.api.keepHeldTold).toHaveBeenCalledTimes(1);
            expect(refused.warn).toHaveBeenCalledTimes(1);
        }
    });
});

// --- the model's own loop --------------------------------------------------------------------------------------------------------------------

describe('the model of a check', () => {
    const brick: TaskBrick = { name: 'Brick', instructions: 'You are Brick.', providerId: 'universe-ai', deleted: false };

    function modelWith(runBrickTask: (opts: any) => Promise<any>, over: Partial<TaskBrick> | null = {}) {
        const readPage = vi.fn(async () => ({ text: 'Price: KWD 86' }));
        const ai = { runBrickTask: vi.fn(runBrickTask) };
        const runner = new ModelTaskRunner({ ai: ai as never, brick: async () => (over === null ? null : { ...brick, ...over }), readPage, now: () => new Date('2026-11-15T06:00:00Z') });
        return { runner, ai, readPage };
    }

    it('gives the model its own context and the run’s id, runs its tools, and reads how it ended', async () => {
        const { runner, ai, readPage } = modelWith(async (opts) => {
            expect(await opts.runTool(READ_PAGE_TOOL, { url: 'https://example.com' })).toContain('KWD 86');
            expect(await opts.runTool(FINISH_CHECK_TOOL, { result: 'tell_them', message: 'KWD 86 now' })).toContain('ok');
            return { ended: 'final' };
        });
        const outcome = await runner.run(run(), async () => true);
        expect(outcome).toEqual({ kind: 'result', result: { kind: 'tell', message: 'KWD 86 now', needsYou: false, progress: {} } });
        const opts = ai.runBrickTask.mock.calls[0][0];
        expect(opts).toMatchObject({ botId: 'brick-1', providerId: 'universe-ai', final: FINISH_CHECK_TOOL, usage: { runId: 'run-1', attempt: 1, userId: 'sara-uuid' } });
        expect(opts.system.startsWith('You are Brick.')).toBe(true);
        expect(readPage).toHaveBeenCalledWith('brick-1', 'https://example.com');
    });

    it('gives a web page the room a chat reply has, and says when it cut it', async () => {
        const sentence = 'Price list. ';
        for (const [length, cut] of [[60_000, false], [200_000, true]] as const) {
            const content = sentence.repeat(Math.ceil(length / sentence.length)).slice(0, length);
            const readPage = vi.fn(async () => ({ content }));
            const ai = {
                runBrickTask: vi.fn(async (opts: any) => {
                    const text: string = await opts.runTool(READ_PAGE_TOOL, { url: 'https://example.com' });
                    // Whole page, valid JSON, when it fits; cut with the chat notice when it does not
                    if (cut) expect(text).toMatch(/Only the first 80,000 of 200,0\d\d characters fit/);
                    else expect(JSON.parse(text)).toEqual({ content });
                    return { ended: 'final' };
                }),
            };
            await new ModelTaskRunner({ ai: ai as never, brick: async () => brick, readPage }).run(run(), async () => true);
            expect(ai.runBrickTask).toHaveBeenCalledTimes(1);
        }
    });

    it('refuses a tool it was not given, and tells the model what to fix in a result it cannot use', async () => {
        const { runner } = modelWith(async (opts) => {
            expect(await opts.runTool('send_message', {})).toContain('error');
            expect(await opts.runTool(FINISH_CHECK_TOOL, { result: 'nothing_new' })).toContain('"ok":true');
            return { ended: 'final' };
        });
        expect(await runner.run(run(), async () => true)).toMatchObject({ kind: 'result', result: { kind: 'nothing_new' } });
        const { runner: briefing } = modelWith(async (opts) => {
            expect(await opts.runTool(FINISH_CHECK_TOOL, { result: 'nothing_new' })).toContain('always delivered');
            return { ended: 'no_tool' };
        });
        expect(await briefing.run(run({ kind: 'schedule' }), async () => true)).toEqual({ kind: 'failed', error: 'The check did not end with a result.' });
    });

    it('tells the person when the provider said no for good, and stays quiet about a blip or a busy provider', async () => {
        const failedWith = (status?: number) => modelWith(async () => ({ ended: 'failed', error: 'boom', ...(status ? { status } : {}) })).runner.run(run(), async () => true);
        expect(await failedWith(401)).toMatchObject({ kind: 'failed', error: expect.stringContaining('would not let it in') });
        expect(await failedWith(403)).toMatchObject({ kind: 'failed' });
        expect(await failedWith(400)).toMatchObject({ kind: 'failed', error: expect.stringContaining('turned this check down') });
        expect(await failedWith(404)).toMatchObject({ kind: 'failed' });
        for (const status of [408, 409, 429, 500, 503, undefined]) expect(await failedWith(status)).toEqual({ kind: 'unsure' });
    });

    it('is a failure when the model never ended the check, unsure when it could not answer, and stopped when the run may not go on', async () => {
        expect(await modelWith(async () => ({ ended: 'steps' })).runner.run(run(), async () => true)).toMatchObject({ kind: 'failed' });
        expect(await modelWith(async () => ({ ended: 'failed', error: 'timeout' })).runner.run(run(), async () => true)).toEqual({ kind: 'unsure' });
        expect(await modelWith(async () => ({ ended: 'resting' })).runner.run(run(), async () => true)).toEqual({ kind: 'unsure' });
        expect(await modelWith(async () => ({ ended: 'not_permitted' })).runner.run(run(), async () => true)).toEqual({ kind: 'stopped' });
    });

    it('does nothing for a Brick that is gone, and fails plainly for one with no AI', async () => {
        const gone = modelWith(async () => ({ ended: 'final' }), null);
        expect(await gone.runner.run(run(), async () => true)).toEqual({ kind: 'stopped' });
        expect(gone.ai.runBrickTask).not.toHaveBeenCalled();
        expect(await modelWith(async () => ({ ended: 'final' }), { deleted: true }).runner.run(run(), async () => true)).toEqual({ kind: 'stopped' });
        expect(await modelWith(async () => ({ ended: 'final' }), { providerId: null }).runner.run(run(), async () => true)).toMatchObject({ kind: 'failed' });
        const unreadable = new ModelTaskRunner({
            ai: { runBrickTask: vi.fn() } as never,
            brick: async () => {
                throw new Error('Orbit down');
            },
            readPage: vi.fn(),
        });
        expect(await unreadable.run(run(), async () => true)).toEqual({ kind: 'unsure' });
    });
});

describe('each model call of a run is on the books, one row each, under the run’s id', () => {
    function service(rounds: Array<Array<Record<string, unknown>>>) {
        const ai = Object.create(AIService.prototype) as AIService;
        const tracked: any[] = [];
        let call = 0;
        const asked: string[] = [];
        Object.assign(ai, {
            resolveProvider: vi.fn(async () => ({ resting: false, source: 'universe-ai', config: { providerId: 'deepseek-flash' } })),
            meteredStream: async function* (_ledger: unknown, _provider: unknown, _system: unknown, user: string) {
                asked.push(user);
                for (const chunk of rounds[call++] ?? []) yield chunk;
            },
            trackUsage: vi.fn(async (...args: unknown[]) => void tracked.push(args)),
        });
        return { ai: ai as unknown as Pick<AIService, 'runBrickTask'>, tracked, asked };
    }
    const base = { botId: 'brick-1', providerId: 'universe-ai', system: 's', user: 'u', tools: [], maxSteps: 4, final: 'finish_check', usage: { runId: 'run-1', attempt: 2, userId: 'sara-uuid' } };
    const done = (tokens: number) => ({ content: '', done: true, metadata: { tokensUsed: tokens, promptTokens: tokens - 10, completionTokens: 10 } });

    it('gives the rounds of a run the room a chat reply has: older answers are set aside to a line, a longer one is cut and says so', async () => {
        const seen: { content: string; name: string }[][] = [];
        const ai = Object.create(AIService.prototype) as AIService;
        let call = 0;
        Object.assign(ai, {
            resolveProvider: vi.fn(async () => ({ resting: false, source: 'universe-ai', config: { providerId: 'deepseek-flash', limits: { roomChars: 1_000 } } })),
            meteredStream: async function* (_l: unknown, _p: unknown, _s: unknown, _u: string, _c: unknown, _t: unknown, _sig: unknown, _i: unknown, steps?: { steps: { results: { content: string; name: string }[] }[] }) {
                seen.push((steps?.steps ?? []).flatMap((step) => step.results.map((result) => ({ ...result }))));
                call++;
                yield { content: call < 3 ? 'x'.repeat(300) : '', done: false, toolCalls: [{ id: `c${call}`, name: call < 3 ? 'search' : 'finish_check', arguments: call < 3 ? '{}' : '{"result":"nothing_new"}' }] };
                yield { content: '', done: true, metadata: { tokensUsed: 10, promptTokens: 5, completionTokens: 5 } };
            },
            trackUsage: vi.fn(async () => undefined),
        });
        const answers = ['A'.repeat(600), 'B'.repeat(700)];
        let n = 0;
        const runTool = vi.fn(async (name: string) => (name === 'search' ? answers[n++] : '{"ok":true}'));
        const base = { botId: 'brick-1', providerId: 'universe-ai', system: 's', user: 'u', tools: [], maxSteps: 4, final: 'finish_check', usage: { runId: 'run-1', attempt: 1 } };
        expect(await (ai as unknown as Pick<AIService, 'runBrickTask'>).runBrickTask({ ...base, permit: async () => true, runTool })).toEqual({ ended: 'final' });
        // Round two still sees round one whole; round three sees round one's answer set aside to a line and round two's cut to what is left of
        // the room beside what the model said in both (700 would fit alone, but not with the 600 it said before it, and 600 more it said now)
        expect(seen[0]).toEqual([]);
        expect(seen[1].map((result) => result.content)).toEqual(['A'.repeat(600)]);
        expect(seen[2][0].content).toMatch(/^\[search: 600 characters, set aside to make room/);
        expect(seen[2][1].content).toContain('Only the first');
        expect(seen[2][1].content.startsWith('B'.repeat(100))).toBe(true);
        expect(seen[2][1].content.length).toBeLessThan(700);
    });

    it('goes on after a tool, ends after finish_check ran, and books each call on the task channel with its own id', async () => {
        const { ai, tracked } = service([
            [{ content: '', done: false, toolCalls: [{ id: 'c1', name: 'read_web_page', arguments: '{"url":"https://x.test"}' }] }, done(100)],
            [{ content: '', done: false, toolCalls: [{ id: 'c2', name: 'finish_check', arguments: '{"result":"nothing_new"}' }] }, done(150)],
        ]);
        const runTool = vi.fn(async (name: string, _args?: Record<string, unknown>) => (name === 'finish_check' ? '{"ok":true}' : '{"text":"page"}'));
        const ended = await ai.runBrickTask({ ...base, permit: async () => true, runTool });
        expect(ended).toEqual({ ended: 'final' });
        expect(runTool.mock.calls.map((call) => [call[0], call[1]])).toEqual([['read_web_page', { url: 'https://x.test' }], ['finish_check', { result: 'nothing_new' }]]);
        expect(tracked).toHaveLength(2);
        expect(tracked.map((args) => args[4])).toEqual([
            { channel: 'task', runId: 'run-1', eventId: '2.1', userId: 'sara-uuid' },
            { channel: 'task', runId: 'run-1', eventId: '2.2', userId: 'sara-uuid' },
        ]);
        expect(tracked.map((args) => args[2].tokensUsed)).toEqual([100, 150]);
    });

    it('keeps a `{}` that arrives in the middle of a call\'s streamed arguments, and skips only the placeholder it opens with', async () => {
        const { ai } = service([
            [
                { content: '', done: false, toolCalls: [{ id: 'c1', name: 'finish_check', arguments: '{}' }] },
                { content: '', done: false, toolCalls: [{ id: 'c1', name: '', arguments: '{"result":"tell_them","extra":' }] },
                { content: '', done: false, toolCalls: [{ id: 'c1', name: '', arguments: '{}' }] },
                { content: '', done: false, toolCalls: [{ id: 'c1', name: '', arguments: '}' }] },
                done(100),
            ],
        ]);
        const runTool = vi.fn(async (_name: string, _args?: Record<string, unknown>) => '{"ok":true}');
        await ai.runBrickTask({ ...base, permit: async () => true, runTool });
        expect(runTool.mock.calls[0][1]).toEqual({ result: 'tell_them', extra: {} });
    });

    it('does not go on when the finish was refused: the model is told and calls it again', async () => {
        const { ai } = service([
            [{ content: '', done: false, toolCalls: [{ id: 'c1', name: 'finish_check', arguments: '{"result":"nothing_new"}' }] }, done(100)],
            [{ content: '', done: false, toolCalls: [{ id: 'c2', name: 'finish_check', arguments: '{"result":"tell_them","message":"Hi"}' }] }, done(100)],
        ]);
        let calls = 0;
        const runTool = vi.fn(async () => (++calls === 1 ? '{"error":"say it"}' : '{"ok":true}'));
        expect(await ai.runBrickTask({ ...base, permit: async () => true, runTool })).toEqual({ ended: 'final' });
        expect(runTool).toHaveBeenCalledTimes(2);
    });

    it('stops before the next model call or tool when the run may not go on, and books only what was called', async () => {
        const { ai, tracked } = service([[{ content: '', done: false, toolCalls: [{ id: 'c1', name: 'read_web_page', arguments: '{}' }] }, done(100)]]);
        let asked = 0;
        const runTool = vi.fn(async () => '{}');
        const ended = await ai.runBrickTask({ ...base, permit: async () => ++asked < 2, runTool });
        expect(ended).toEqual({ ended: 'not_permitted' });
        expect(runTool).not.toHaveBeenCalled();
        expect(tracked).toHaveLength(1);
    });

    it('ends when the model stops calling tools, or the steps are used up', async () => {
        expect(await service([[{ content: 'Done.', done: false }, done(50)]]).ai.runBrickTask({ ...base, permit: async () => true, runTool: async () => '{}' })).toEqual({ ended: 'no_tool' });
        const looping = service([1, 2, 3].map((n) => [{ content: '', done: false, toolCalls: [{ id: `c${n}`, name: 'read_web_page', arguments: '{}' }] }, done(50)]));
        expect(await looping.ai.runBrickTask({ ...base, maxSteps: 3, permit: async () => true, runTool: async () => '{}' })).toEqual({ ended: 'steps' });
        expect(looping.tracked).toHaveLength(3);
    });

    it('asks once more, in plain words, when the model answers without calling a tool, and then it is a no', async () => {
        const answered = service([
            [{ content: 'Nothing new.', done: false }, done(50)],
            [{ content: '', done: false, toolCalls: [{ id: 'c1', name: 'finish_check', arguments: '{"result":"nothing_new"}' }] }, done(60)],
        ]);
        expect(await answered.ai.runBrickTask({ ...base, permit: async () => true, runTool: async () => '{"ok":true}' })).toEqual({ ended: 'final' });
        expect(answered.asked[0]).toBe('u');
        expect(answered.asked[1]).toContain('finish_check');
        const twice = service([[{ content: 'Nothing new.', done: false }, done(50)], [{ content: 'Still nothing.', done: false }, done(50)], [{ content: 'x', done: false }, done(50)]]);
        expect(await twice.ai.runBrickTask({ ...base, permit: async () => true, runTool: async () => '{}' })).toEqual({ ended: 'no_tool' });
        expect(twice.asked).toHaveLength(2);
    });

    it('says which status the provider answered with when a call failed', async () => {
        const { ai } = service([[{ content: '', done: true, metadata: { error: true, errorText: 'no', errorStatus: 401, tokensUsed: 0 } }]]);
        expect(await ai.runBrickTask({ ...base, permit: async () => true, runTool: async () => '{}' })).toMatchObject({ ended: 'failed', status: 401 });
    });

    it('ends at the first finish that was accepted: nothing after it in the same round runs', async () => {
        const { ai } = service([
            [
                { content: '', done: false, toolCalls: [{ id: 'c1', name: 'finish_check', arguments: '{"result":"tell_them","message":"Price dropped"}' }] },
                { content: '', done: false, toolCalls: [{ id: 'c2', name: 'finish_check', arguments: '{"result":"nothing_new"}' }] },
                { content: '', done: false, toolCalls: [{ id: 'c3', name: 'read_web_page', arguments: '{}' }] },
                done(100),
            ],
        ]);
        const runTool = vi.fn(async () => '{"ok":true}');
        expect(await ai.runBrickTask({ ...base, permit: async () => true, runTool })).toEqual({ ended: 'final' });
        expect(runTool).toHaveBeenCalledTimes(1);
        expect(runTool.mock.calls[0]).toEqual(['finish_check', { result: 'tell_them', message: 'Price dropped' }]);
    });

    it('books a call that failed as an error row, and says it did not finish', async () => {
        const { ai, tracked } = service([[{ content: '', done: true, metadata: { error: true, errorText: 'boom', tokensUsed: 0 } }]]);
        const ended = await ai.runBrickTask({ ...base, permit: async () => true, runTool: async () => '{}' });
        expect(ended).toMatchObject({ ended: 'failed' });
        expect(tracked[0][2].error).toBe(true);
    });

    it('answers resting, and calls nothing, when the key is resting', async () => {
        const ai = Object.create(AIService.prototype) as AIService;
        Object.assign(ai, { resolveProvider: async () => ({ resting: true, line: 'resting' }), trackUsage: vi.fn() });
        expect(await (ai as unknown as Pick<AIService, 'runBrickTask'>).runBrickTask({ ...base, permit: async () => true, runTool: async () => '{}' })).toEqual({ ended: 'resting' });
    });
});

beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

describe('a run Orbit gave up on with no report is told once', () => {
    const failedNotice = (over: Partial<FailedNotice> = {}): FailedNotice => ({
        runId: 'run-77',
        itemId: 'item-9',
        brickId: 'brick-1',
        userId: 'user-1',
        matrixUserId: '@sara:matrix.test',
        kind: 'reminder',
        words: 'Call the bank',
        timeZone: 'Asia/Kuwait',
        error: 'the chat was not there',
        ...over,
    });

    it('keeps only a notice that has what saying it needs', () => {
        expect(failedNoticeOf(failedNotice())).toEqual(failedNotice());
        expect(failedNoticeOf({ ...failedNotice(), runId: '' })).toBeNull();
        expect(failedNoticeOf({ ...failedNotice(), kind: 'quest' })).toBeNull();
        expect(failedNoticeOf({ ...failedNotice(), matrixUserId: undefined, error: undefined })).toMatchObject({ matrixUserId: null, error: 'it did not work' });
    });

    it('says it in the failure words under the run\'s own told id, and tells Orbit only after it went out', async () => {
        const { runner, say, api } = setUp([], result({ kind: 'unsure' }), { failed: [failedNotice()] });
        await runner.tick();
        expect(say).toHaveBeenCalledWith('brick-1', '@sara:matrix.test', failedText({ words: 'Call the bank', kind: 'reminder' }, 'the chat was not there'), 'brick-told:run-77');
        expect(api.keepTold).toHaveBeenCalledWith('run-77');
    });

    it('does not promise another try for a reminder Orbit gave up on, but does for something that comes round again', () => {
        const reminder = failedText({ words: 'Call the bank', kind: 'reminder' }, 'the chat was not there');
        expect(reminder).toContain('Call the bank');
        expect(reminder).not.toMatch(/try again at the next time/);
        expect(reminder).toMatch(/won't try it again on my own/);
        expect(failedText({ words: 'Send the report', kind: 'schedule' }, 'x')).toMatch(/try again at the next time/);
    });

    it('is handed out again when it could not be said just now, and kept as told when it can never be said', async () => {
        const blip = setUp([], result({ kind: 'unsure' }), { failed: [failedNotice()], say: async () => ({ ok: false, reason: 'unsure' }) });
        await blip.runner.tick();
        expect(blip.api.keepTold).not.toHaveBeenCalled();
        const noChat = setUp([], result({ kind: 'unsure' }), { failed: [failedNotice({ matrixUserId: null })] });
        await noChat.runner.tick();
        expect(noChat.say).not.toHaveBeenCalled();
        expect(noChat.api.keepTold).toHaveBeenCalledWith('run-77');
        const refused = setUp([], result({ kind: 'unsure' }), { failed: [failedNotice()], say: async () => ({ ok: false, reason: 'not_allowed' }) });
        await refused.runner.tick();
        expect(refused.api.keepTold).toHaveBeenCalledWith('run-77');
    });
});
