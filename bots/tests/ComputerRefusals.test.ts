import { describe, expect, it, vi } from 'vitest';
import { createRefusalNotes, EVIDENCE_KEEP_MS, EVIDENCE_UNACKED_MS, FAULT_ROWS_PER_CALL, REFUSAL_NOTE_KEEP_MS, type CallRow, type EvidenceStore } from '../server/ComputerRefusals';

describe('what the relay refused for a person’s allowance or rules', () => {
    it('answers for a job only from the moment asked, and for no other job', () => {
        let at = 1000;
        const notes = createRefusalNotes(() => at);
        expect(notes.sawSince('a', 0)).toBe(false);
        notes.note('a');
        expect(notes.sawSince('a', 1000)).toBe(true);
        expect(notes.sawSince('a', 1001)).toBe(false);
        expect(notes.sawSince('b', 0)).toBe(false);
        at = 5000;
        notes.note('a');
        expect(notes.sawSince('a', 5000)).toBe(true);
    });

    it('forgets a note after a while, so the notes of finished jobs do not pile up', () => {
        let at = 0;
        const notes = createRefusalNotes(() => at);
        notes.note('old');
        at = REFUSAL_NOTE_KEEP_MS + 1;
        notes.note('new');
        expect(notes.sawSince('old', 0)).toBe(false);
        expect(notes.sawSince('new', 0)).toBe(true);
    });
});

describe('how a job’s model calls fared on Universe’s side', () => {
    it('says a turn ended on a fault of ours only while no call after the fault was answered', () => {
        // every event lands in the same millisecond: the order they came in decides
        const notes = createRefusalNotes(() => 1000);
        expect(notes.endedOnFault('a', 0)).toBe(false);
        notes.fault('a');
        expect(notes.endedOnFault('a', 1000)).toBe(true);
        notes.answered('a');
        expect(notes.endedOnFault('a', 1000)).toBe(false);
        notes.fault('a');
        expect(notes.endedOnFault('a', 1000)).toBe(true);
        expect(notes.endedOnFault('b', 0)).toBe(false);
    });

    it('does not count a fault from before the turn began, or a person’s refusal, and forgets old ones', () => {
        let at = 1000;
        const notes = createRefusalNotes(() => at);
        notes.fault('a');
        expect(notes.endedOnFault('a', 1001)).toBe(false);
        notes.note('b');
        expect(notes.endedOnFault('b', 0)).toBe(false);
        at = REFUSAL_NOTE_KEEP_MS + 2000;
        notes.fault('new');
        expect(notes.endedOnFault('a', 0)).toBe(false);
        expect(notes.endedOnFault('new', 0)).toBe(true);
    });
});


describe('the durable record of how a job’s model calls ended (sent to Orbit)', () => {
    const call = (callId: string, over: Partial<Parameters<ReturnType<typeof createRefusalNotes>['record']>[2]> = {}) => ({
        callId,
        kind: 'fault' as const,
        reason: 'provider_key_ours' as const,
        source: 'universe-ai' as const,
        route: 'universe-ai:p1',
        providerStatus: 401 as number | null,
        ...over,
    });
    const rig = (answers: boolean[] = []) => {
        const sent: Array<{ botId: string; jobId: string; rows: CallRow[] }> = [];
        let at = 1000;
        const notes = createRefusalNotes(() => at, {
            retryMs: [0, 0],
            sink: async (botId, jobId, rows) => {
                const answer = answers.length > 0 ? (answers.shift() as boolean) : true;
                if (answer) sent.push({ botId, jobId, rows: rows.map((row) => ({ ...row })) });
                return answer;
            },
        });
        return { notes, sent, advance: (ms: number) => (at += ms) };
    };

    it('stamps a row with the turn the runner was on, the ids, the reason and the time, and sends it to Orbit with the job’s bot', async () => {
        const { notes, sent } = rig();
        notes.turn('job-1', 3);
        notes.record('bot-1', 'job-1', call('call-a'));
        expect(await notes.flush('job-1')).toBe(true);
        expect(sent).toEqual([
            {
                botId: 'bot-1',
                jobId: 'job-1',
                rows: [{ turn: 3, callId: 'call-a', kind: 'fault', reason: 'provider_key_ours', source: 'universe-ai', route: 'universe-ai:p1', providerStatus: 401, at: new Date(1000).toISOString() }],
            },
        ]);
    });

    it('sends nothing for an answer, notes it as one, and keeps a fault that a later answer made good as no fault of the turn’s end', async () => {
        const { notes, sent } = rig();
        notes.record('b', 'j', call('c1', { kind: 'uncertain', reason: 'provider_5xx', providerStatus: 500 }));
        expect(notes.endedOnFault('j', 0)).toBe(true);
        notes.record('b', 'j', call('c2', { kind: 'answered' }));
        expect(notes.endedOnFault('j', 0)).toBe(false);
        await notes.flush('j');
        expect(sent.flatMap((entry) => entry.rows.map((row) => row.callId))).toEqual(['c1']);
    });

    it('counts a confirmed fault apart from an unresolved one, and a person’s side as neither', () => {
        const { notes } = rig();
        notes.record('b', 'a', call('c1', { kind: 'uncertain', reason: 'timeout_no_output', providerStatus: null }));
        expect(notes.endedOnFault('a', 0)).toBe(true);
        expect(notes.confirmedSince('a', 0)).toBe(false);
        notes.record('b', 'a', call('c2', { kind: 'fault', reason: 'relay_down', providerStatus: 503 }));
        expect(notes.confirmedSince('a', 0)).toBe(true);
        expect(notes.confirmedSince('a', 1001)).toBe(false);
        notes.record('b', 'p', call('c3', { kind: 'not_ours', reason: 'allowance', providerStatus: 429 }));
        expect(notes.sawSince('p', 0)).toBe(true);
        expect(notes.endedOnFault('p', 0)).toBe(false);
        expect(notes.confirmedSince('p', 0)).toBe(false);
    });

    it('keeps rows Orbit did not take and sends them again, in batches of at most 50, without losing or doubling any', async () => {
        const { notes, sent } = rig([false, false, true]);
        for (let n = 0; n < 120; n++) notes.record('b', 'j', call(`c${n}`, { kind: 'uncertain', reason: 'stream_cut', providerStatus: null }));
        expect(await notes.flush('j')).toBe(true);
        const ids = sent.flatMap((entry) => entry.rows.map((row) => row.callId));
        expect(new Set(ids).size).toBe(120);
        expect(ids).toHaveLength(120);
        expect(Math.max(...sent.map((entry) => entry.rows.length))).toBeLessThanOrEqual(FAULT_ROWS_PER_CALL);
    });

    it('says false when Orbit stays unreachable, keeps the rows, and sends them on the next flush', async () => {
        const { notes, sent } = rig([false, false, false, false, false, false, false, false]);
        notes.record('b', 'j', call('c1'));
        expect(await notes.flush('j')).toBe(false);
        expect(sent).toHaveLength(0);
        // Orbit is back (the scripted answers ran out: the sink says yes)
        expect(await notes.flush('j')).toBe(true);
        expect(sent.flatMap((entry) => entry.rows.map((row) => row.callId))).toEqual(['c1']);
    });

    it('does not keep a sink’s exception from ending a flush, and sends the same row again after an upgrade', async () => {
        let first = true;
        const sent: CallRow[][] = [];
        const notes = createRefusalNotes(() => 1000, {
            retryMs: [0],
            sink: async (_b, _j, rows) => {
                if (first) {
                    first = false;
                    throw new Error('network');
                }
                sent.push(rows.map((row) => ({ ...row })));
                return true;
            },
        });
        notes.record('b', 'j', call('c1', { kind: 'uncertain', reason: 'fieldless_400', providerStatus: 400 }));
        expect(await notes.flush('j')).toBe(true);
        notes.record('b', 'j', call('c1', { kind: 'fault', reason: 'provider_key_ours', providerStatus: 401 }));
        expect(await notes.flush('j')).toBe(true);
        expect(sent.map((rows) => rows.map((row) => row.kind))).toEqual([['uncertain'], ['fault']]);
    });

    it('tells the events of one millisecond apart by their order: a mark takes in only what is noted after it, while a moment still takes in the whole millisecond', () => {
        const notes = createRefusalNotes(() => 1000);
        notes.record('b', 'j', call('c1', { kind: 'not_ours', reason: 'allowance' }));
        notes.record('b', 'j', call('c2', { kind: 'fault' }));
        const mark = notes.mark();
        // nothing was noted since the mark, though everything happened at the same moment
        expect(notes.sawSince('j', mark)).toBe(false);
        expect(notes.confirmedSince('j', mark)).toBe(false);
        expect(notes.endedOnFault('j', mark)).toBe(false);
        // a moment can only say "this millisecond or later", so it still takes the earlier events in
        expect(notes.sawSince('j', 1000)).toBe(true);
        notes.record('b', 'j', call('c3', { kind: 'not_ours', reason: 'rule' }));
        notes.record('b', 'j', call('c4', { kind: 'fault' }));
        expect(notes.sawSince('j', mark)).toBe(true);
        expect(notes.confirmedSince('j', mark)).toBe(true);
        expect(notes.endedOnFault('j', mark)).toBe(true);
        // an answer after the fault, in the same window, makes it good
        notes.record('b', 'j', call('c5', { kind: 'answered' }));
        expect(notes.endedOnFault('j', mark)).toBe(false);
        // and the other notes (the in-process ones) are ordered the same way
        const later = notes.mark();
        notes.note('j');
        expect(notes.sawSince('j', later)).toBe(true);
    });

    it('is true for a job with nothing to send, and with no sink at all (the in-process notes still work)', async () => {
        const { notes } = rig();
        expect(await notes.flush('nothing')).toBe(true);
        const plain = createRefusalNotes(() => 1000);
        plain.record('b', 'j', call('c1'));
        expect(await plain.flush('j')).toBe(true);
        expect(plain.endedOnFault('j', 0)).toBe(true);
    });

    it('cuts a long call id and route to what Orbit takes, and forgets the rows of a finished job after a while', async () => {
        const { notes, sent, advance } = rig();
        notes.record('b', 'j', call('x'.repeat(300), { route: 'r'.repeat(300) }));
        await notes.flush('j');
        expect(sent[0].rows[0].callId).toHaveLength(120);
        expect(sent[0].rows[0].route).toHaveLength(80);
        const down = rig([false, false, false, false, false, false, false, false]);
        down.notes.record('b', 'old', call('c1'));
        expect(await down.notes.flush('old')).toBe(false);
        down.advance(REFUSAL_NOTE_KEEP_MS + 1);
        down.notes.record('b', 'new', call('c2'));
        advance(0);
        expect(await down.notes.flush('old')).toBe(true);
        // true only because the row is gone: had it been kept, the sink would have taken it on this try (it has only two refusals left)
        expect(down.sent.flatMap((entry) => entry.rows.map((row) => row.callId))).not.toContain('c1');
    });

    it('keeps trying in the background, a few times and then no more, after the quick tries and the last flush failed: Orbit coming back after the job ended still gets the rows', async () => {
        const sent: string[] = [];
        let up = false;
        const notes = createRefusalNotes(() => 1000, {
            retryMs: [0],
            laterMs: [20, 20],
            sink: async (_bot, _job, rows) => {
                if (up) sent.push(...rows.map((row) => row.callId));
                return up;
            },
        });
        notes.record('b', 'j', call('c1'));
        expect(await notes.flush('j')).toBe(false);
        expect(sent).toEqual([]);
        // Orbit is back after the job ended: no flush is called again
        up = true;
        await vi.waitFor(() => expect(sent).toEqual(['c1']), { timeout: 2000 });
        // a row once taken is final: nothing sends it again
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(sent).toEqual(['c1']);

        // bounded: with Orbit down throughout, the background tries stop after the last one
        let tries = 0;
        const down = createRefusalNotes(() => 1000, { retryMs: [], laterMs: [10, 10], sink: async () => (tries += 1) < 0 });
        down.record('b', 'k', call('c2'));
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(tries).toBe(3);
    });

    it('gives a flush one short time in all: it returns false at the budget while the rows go on being sent in the background', async () => {
        vi.useFakeTimers();
        try {
            const sent: string[] = [];
            let first = true;
            const notes = createRefusalNotes(() => 1000, {
                retryMs: [100, 100, 100],
                laterMs: [],
                flushBudgetMs: 50,
                sink: async (_bot, _job, rows) => {
                    if (first) {
                        first = false;
                        await new Promise((resolve) => setTimeout(resolve, 80));
                        return false;
                    }
                    sent.push(...rows.map((row) => row.callId));
                    return true;
                },
            });
            notes.record('b', 'j', call('c1'));
            const flushed = notes.flush('j');
            // the budget runs out while the first try is still waiting for Orbit: false, and the row is still pending
            await vi.advanceTimersByTimeAsync(50);
            expect(await flushed).toBe(false);
            expect(sent).toEqual([]);
            // the first try ends (false) at 80 ms, the sender waits its first retry, and then the row arrives, once
            await vi.advanceTimersByTimeAsync(30);
            expect(sent).toEqual([]);
            await vi.advanceTimersByTimeAsync(100);
            expect(sent).toEqual(['c1']);
            await vi.advanceTimersByTimeAsync(5000);
            expect(sent).toEqual(['c1']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('starts the later tries again once everything was taken, and drops a try that was waiting with nothing left to send', async () => {
        vi.useFakeTimers();
        try {
            const sent: string[] = [];
            let up = false;
            const notes = createRefusalNotes(() => 1000, {
                retryMs: [],
                laterMs: [1000, 1000],
                sink: async (_bot, _job, rows) => {
                    if (up) sent.push(...rows.map((row) => row.callId));
                    return up;
                },
            });
            // Orbit down throughout: both later tries are used up
            notes.record('b', 'j', call('c1'));
            await vi.advanceTimersByTimeAsync(1000);
            await vi.advanceTimersByTimeAsync(1000);
            await vi.advanceTimersByTimeAsync(5000);
            expect(vi.getTimerCount()).toBe(0);
            // Orbit is back and takes everything
            up = true;
            notes.record('b', 'j', call('c2'));
            await vi.advanceTimersByTimeAsync(0);
            expect(sent).toEqual(['c1', 'c2']);
            // the next row finds the budget of later tries whole again: the first of them fails, the second takes the row
            up = false;
            notes.record('b', 'j', call('c3'));
            await vi.advanceTimersByTimeAsync(1000);
            up = true;
            await vi.advanceTimersByTimeAsync(1000);
            expect(sent).toEqual(['c1', 'c2', 'c3']);
            // a try that is waiting when the rows are taken by another send is dropped, not left to fire for nothing
            up = false;
            notes.record('b', 'j', call('c4'));
            await vi.advanceTimersByTimeAsync(0);
            expect(vi.getTimerCount()).toBe(1);
            up = true;
            notes.record('b', 'j', call('c5'));
            await vi.advanceTimersByTimeAsync(0);
            expect(sent).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
            expect(vi.getTimerCount()).toBe(0);
            // rows still pending keep the budget they have: no reset while something waits
            up = false;
            notes.record('b', 'j', call('c6'));
            await vi.advanceTimersByTimeAsync(1000);
            await vi.advanceTimersByTimeAsync(1000);
            await vi.advanceTimersByTimeAsync(5000);
            up = true;
            await vi.advanceTimersByTimeAsync(5000);
            expect(sent).not.toContain('c6');
        } finally {
            vi.useRealTimers();
        }
    });

    it('sends a row that was queued while the sender was going idle: it joined a sender that had already looked and would otherwise stay unsent', async () => {
        // The row is queued after a number of microtask ticks that is tried from 0 up, so one of them falls between the sender's last look at its rows
        // and the moment it is gone, wherever that moment is
        for (let ticks = 0; ticks < 12; ticks++) {
            const sent: string[] = [];
            let queuedSecond = false;
            const notes: ReturnType<typeof createRefusalNotes> = createRefusalNotes(() => 1000, {
                retryMs: [],
                laterMs: [],
                sink: async (_bot, _job, rows) => {
                    sent.push(...rows.map((row) => row.callId));
                    if (!queuedSecond) {
                        queuedSecond = true;
                        let wait: Promise<void> = Promise.resolve();
                        for (let tick = 0; tick < ticks; tick++) wait = wait.then(() => undefined);
                        void wait.then(() => notes.record('b', 'j', call('second')));
                    }
                    return true;
                },
            });
            notes.record('b', 'j', call('first'));
            await vi.waitFor(() => expect(sent).toEqual(['first', 'second']), { timeout: 1000 });
            await new Promise((resolve) => setTimeout(resolve, 5));
            // once each: a row Orbit took is final
            expect(sent).toEqual(['first', 'second']);
        }
    });

    it('lets a call that belongs to a turn or a run the runner has left send its row, but not change what the runner reads for the turn it is on', async () => {
        const { notes, sent } = rig();
        notes.turn('j', 1, 'run-a');
        notes.turn('j', 2, 'run-a');
        // a fault of the turn in progress
        notes.record('b', 'j', call('now', { turn: 2, run: 'run-a', kind: 'uncertain', reason: 'provider_5xx', providerStatus: 500 }));
        expect(notes.endedOnFault('j', 0)).toBe(true);
        // an answer that arrives from turn 1 makes nothing good in turn 2
        notes.record('b', 'j', call('old-answer', { turn: 1, run: 'run-a', kind: 'answered', reason: 'provider_5xx' }));
        expect(notes.endedOnFault('j', 0)).toBe(true);
        // the same turn number in another run is another turn
        notes.turn('j', 1, 'run-b');
        const mark = notes.mark();
        notes.record('b', 'j', call('old-run-fault', { turn: 1, run: 'run-a', kind: 'fault' }));
        notes.record('b', 'j', call('old-run-refused', { turn: 1, run: 'run-a', kind: 'not_ours', reason: 'allowance', providerStatus: 429 }));
        expect(notes.confirmedSince('j', mark)).toBe(false);
        expect(notes.sawSince('j', mark)).toBe(false);
        expect(notes.endedOnFault('j', mark)).toBe(false);
        // their rows still reach Orbit under their own turn and run
        await notes.flush('j');
        const rows = sent.flatMap((entry) => entry.rows);
        expect(rows.filter((row) => ['old-run-fault', 'old-run-refused'].includes(row.callId)).map((row) => [row.callId, row.turn, row.run])).toEqual([['old-run-fault', 1, 'run-a'], ['old-run-refused', 1, 'run-a']]);
        // a call of the turn in progress (same number and run) is noted
        notes.record('b', 'j', call('current', { turn: 1, run: 'run-b', kind: 'fault' }));
        expect(notes.confirmedSince('j', mark)).toBe(true);
        notes.record('b', 'j', call('current-refused', { turn: 1, run: 'run-b', kind: 'not_ours', reason: 'allowance', providerStatus: 429 }));
        expect(notes.sawSince('j', mark)).toBe(true);
        // and a call that carries no turn is read as before
        notes.record('b', 'k', call('none', { kind: 'fault' }));
        expect(notes.confirmedSince('k', 0)).toBe(true);
    });

    it('stamps a row with the turn the call started in when it is given, and with the turn the runner is on when it is not', async () => {
        const { notes, sent } = rig();
        notes.turn('j', 4);
        expect(notes.turnOf('j')).toBe(4);
        expect(notes.turnOf('never')).toBe(0);
        const startedIn = notes.turnOf('j');
        // the runner moves on while the call is still open; the call then ends
        notes.turn('j', 5);
        notes.record('b', 'j', call('c1', { turn: startedIn }));
        notes.record('b', 'j', call('c2'));
        await notes.flush('j');
        expect(sent.flatMap((entry) => entry.rows.map((row) => [row.callId, row.turn]))).toEqual([['c1', 4], ['c2', 5]]);
    });

    it('stamps a row with the run its turn was in: after a restart the same turn number in another run is another turn', async () => {
        const { notes, sent } = rig();
        notes.turn('j', 1, 'run-a');
        expect(notes.runOf('j')).toBe('run-a');
        expect(notes.runOf('never')).toBeUndefined();
        const startedTurn = notes.turnOf('j');
        const startedRun = notes.runOf('j');
        // the runner of another run takes the job up and numbers its turns from 1 again, while the first call is still open
        notes.turn('j', 1, 'run-b');
        notes.record('b', 'j', call('c1', { turn: startedTurn, run: startedRun }));
        notes.record('b', 'j', call('c2'));
        await notes.flush('j');
        const rows = sent.flatMap((entry) => entry.rows.map((row) => [row.callId, row.turn, row.run]));
        expect(rows).toEqual([['c1', 1, 'run-a'], ['c2', 1, 'run-b']]);
    });

    it('tells the turn that was current at a point in the order of events, though the runner has moved on since', () => {
        const { notes } = rig();
        expect(notes.turnAt('j', notes.mark())).toEqual({ turn: 0 });
        notes.turn('j', 3, 'run-a');
        const arrived = notes.mark();
        notes.turn('j', 4, 'run-a');
        const later = notes.mark();
        notes.turn('j', 1, 'run-b');
        expect(notes.turnAt('j', arrived)).toEqual({ turn: 3, run: 'run-a' });
        expect(notes.turnAt('j', later)).toEqual({ turn: 4, run: 'run-a' });
        expect(notes.turnAt('j', notes.mark())).toEqual({ turn: 1, run: 'run-b' });
        // the current turn is still the newest one, and another job knows nothing of these
        expect(notes.turnOf('j')).toBe(1);
        expect(notes.runOf('j')).toBe('run-b');
        expect(notes.turnAt('other', arrived)).toEqual({ turn: 0 });
        // a point before the first turn it was told is no turn
        const first = rig().notes;
        const before = first.mark();
        first.turn('k', 1);
        expect(first.turnAt('k', before)).toEqual({ turn: 0 });
    });

    it('keeps only a short history of turns, and never loses the newest', () => {
        const { notes } = rig();
        const points: Array<{ order: number }> = [];
        for (let turn = 1; turn <= 40; turn++) {
            notes.turn('j', turn, 'run-a');
            points.push(notes.mark());
        }
        expect(notes.turnAt('j', points[39])).toEqual({ turn: 40, run: 'run-a' });
        expect(notes.turnAt('j', points[30])).toEqual({ turn: 31, run: 'run-a' });
        expect(notes.turnOf('j')).toBe(40);
    });

    it('sends no run for a runner that names none', async () => {
        const { notes, sent } = rig();
        notes.turn('j', 2);
        notes.record('b', 'j', call('c1'));
        await notes.flush('j');
        expect(sent.flatMap((entry) => entry.rows.map((row) => 'run' in row))).toEqual([false]);
    });
});

describe('the evidence kept before the money decision is final, and delivered after a restart', () => {
    const call = (callId: string, over: Partial<Parameters<ReturnType<typeof createRefusalNotes>['record']>[2]> = {}) => ({
        callId,
        kind: 'fault' as const,
        reason: 'relay_down' as const,
        source: 'universe-ai' as const,
        route: 'universe-ai:p1',
        providerStatus: 503 as number | null,
        ...over,
    });
    /** A shared store in memory that survives the "process" (the ledger) and can be told to fail or to hold a write. */
    const memoryStore = () => {
        const held = new Map<string, { botId: string; jobId: string; row: CallRow }>();
        const log: string[] = [];
        const state = { failSaves: 0, down: false, failLoad: false, gate: undefined as Promise<void> | undefined };
        const store: EvidenceStore = {
            save: async (botId, jobId, row) => {
                if (state.gate) await state.gate;
                if (state.down) return false;
                if (state.failSaves > 0) {
                    state.failSaves--;
                    return false;
                }
                log.push(`save ${row.callId}`);
                held.set(`${jobId}|${row.callId}`, { botId, jobId, row: { ...row } });
                return true;
            },
            // Each row only while the store still holds exactly the row that was taken (a newer row of the same call id stays)
            drop: async (botId, jobId, rows) => {
                for (const row of rows) {
                    log.push(`drop ${row.callId}`);
                    const kept = held.get(`${jobId}|${row.callId}`);
                    if (kept && kept.botId === botId && JSON.stringify(kept.row) === JSON.stringify(row)) held.delete(`${jobId}|${row.callId}`);
                }
            },
            load: async () => {
                if (state.failLoad) throw new Error('store down');
                const byJob = new Map<string, { botId: string; jobId: string; rows: CallRow[] }>();
                for (const one of held.values()) {
                    const entry = byJob.get(one.jobId) ?? { botId: one.botId, jobId: one.jobId, rows: [] };
                    entry.rows.push({ ...one.row });
                    byJob.set(one.jobId, entry);
                }
                return [...byJob.values()];
            },
        };
        return { store, held, log, state };
    };
    const ledger = (store: EvidenceStore, sinkAnswers: () => boolean, extra: { storeLaterMs?: number; report?: (what: 'not_durable' | 'unacked', info: { jobId: string; callId: string }) => void } = {}) => {
        const sent: Array<{ botId: string; jobId: string; rows: CallRow[] }> = [];
        let at = 1000;
        const notes = createRefusalNotes(() => at, {
            retryMs: [0],
            laterMs: [],
            store,
            ...extra,
            sink: async (botId, jobId, rows) => {
                if (!sinkAnswers()) return false;
                sent.push({ botId, jobId, rows: rows.map((row) => ({ ...row })) });
                return true;
            },
        });
        return { notes, sent, advance: (ms: number) => (at += ms) };
    };

    it('keeps a row in the store as it is made, before Orbit has taken it, and removes it once Orbit has', async () => {
        const mem = memoryStore();
        let orbitUp = false;
        const { notes, sent } = ledger(mem.store, () => orbitUp);
        notes.turn('j', 2, 'run-a');
        notes.record('b', 'j', call('c1'));
        await vi.waitFor(() => expect(mem.held.has('j|c1')).toBe(true));
        expect(mem.held.get('j|c1')?.row).toMatchObject({ turn: 2, run: 'run-a', callId: 'c1', kind: 'fault', reason: 'relay_down' });
        expect(sent).toHaveLength(0);
        orbitUp = true;
        expect(await notes.flush('j')).toBe(true);
        expect(sent.flatMap((one) => one.rows.map((row) => row.callId))).toEqual(['c1']);
        expect(mem.held.size).toBe(0);
    });

    it('after a restart a new ledger on the same store delivers the kept rows unchanged: same call, turn, run and time', async () => {
        const mem = memoryStore();
        const first = ledger(mem.store, () => false);
        first.notes.turn('j', 4, 'run-z');
        first.notes.record('bot-9', 'j', call('c1', { kind: 'uncertain', reason: 'stream_cut', providerStatus: null }));
        first.notes.record('bot-9', 'j', call('c2'));
        await vi.waitFor(() => expect(mem.held.size).toBe(2));
        const kept = [...mem.held.values()].map((one) => one.row);
        // the process is gone: a new one starts, Orbit is up
        const second = ledger(mem.store, () => true);
        expect(await second.notes.resume()).toBe(true);
        await vi.waitFor(() => expect(second.sent.flatMap((one) => one.rows).length).toBe(2));
        expect(second.sent.every((one) => one.botId === 'bot-9' && one.jobId === 'j')).toBe(true);
        expect(second.sent.flatMap((one) => one.rows).sort((a, b) => a.callId.localeCompare(b.callId))).toEqual(kept.sort((a, b) => a.callId.localeCompare(b.callId)));
        await vi.waitFor(() => expect(mem.held.size).toBe(0));
    });

    it('does not make the call, or anything else, run again: only rows are delivered, never an answered call', async () => {
        const mem = memoryStore();
        const first = ledger(mem.store, () => false);
        first.notes.record('b', 'j', call('c1', { kind: 'answered' }));
        await first.notes.flush('j');
        expect(mem.held.size).toBe(0);
    });

    it('flush waits for the write to the store, and a write that failed is made again before the flush ends', async () => {
        const mem = memoryStore();
        mem.state.failSaves = 1;
        const { notes } = ledger(mem.store, () => true);
        notes.record('b', 'j', call('c1'));
        // Orbit takes it at once; the store never kept it, so there is nothing to remove and nothing is left behind
        expect(await notes.flush('j')).toBe(true);
        expect(mem.held.size).toBe(0);
        // with Orbit down the failed write is made again by the flush
        const down = memoryStore();
        down.state.failSaves = 1;
        const second = ledger(down.store, () => false);
        second.notes.record('b', 'j', call('c1'));
        await second.notes.flush('j');
        expect(down.held.has('j|c1')).toBe(true);
    });

    it('removes a row only after the write of that row has ended, so a late write does not bring a delivered row back', async () => {
        const mem = memoryStore();
        let release!: () => void;
        mem.state.gate = new Promise<void>((resolve) => (release = resolve));
        const { notes, sent } = ledger(mem.store, () => true);
        notes.record('b', 'j', call('c1'));
        await vi.waitFor(() => expect(sent).toHaveLength(1));
        expect(mem.log).toEqual([]);
        release();
        await vi.waitFor(() => expect(mem.log).toEqual(['save c1', 'drop c1']));
        expect(mem.held.size).toBe(0);
    });

    it('does not let the acknowledgement of an older row delete a newer row of the same call that Orbit has not taken', async () => {
        const mem = memoryStore();
        let release!: () => void;
        mem.state.gate = new Promise<void>((resolve) => (release = resolve));
        let orbitUp = true;
        const { notes, sent } = ledger(mem.store, () => orbitUp);
        notes.record('b', 'j', call('c1', { kind: 'uncertain', reason: 'provider_5xx', providerStatus: 500 }));
        // Orbit takes the first row while its write to the store is still going
        await vi.waitFor(() => expect(sent).toHaveLength(1));
        orbitUp = false;
        // the same call is written again (a later, firmer reading of it) while the first write is pending, and Orbit does not take it
        notes.record('b', 'j', call('c1', { kind: 'fault', reason: 'provider_key_ours', providerStatus: 401 }));
        release();
        await vi.waitFor(() => expect(mem.log.filter((entry) => entry.startsWith('save'))).toHaveLength(2));
        await vi.waitFor(() => expect(mem.log).toContain('drop c1'));
        await new Promise((resolve) => setTimeout(resolve, 20));
        // what the store holds is the newer row, for a restart to deliver
        expect(mem.held.get('j|c1')?.row).toMatchObject({ kind: 'fault', reason: 'provider_key_ours' });
    });

    it('writes a row the store could not keep again while Orbit is still away and Redis is back, and never writes one Orbit has taken', async () => {
        const mem = memoryStore();
        // Redis is away for the first write, for the retry of the flush and for as long as the flush takes; Orbit does not answer either
        mem.state.down = true;
        let orbitUp = false;
        const { notes, sent } = ledger(mem.store, () => orbitUp, { storeLaterMs: 5 });
        notes.record('b', 'j', call('c1'));
        expect(await notes.flush('j')).toBe(false);
        // nothing was kept when the flush returned: only the tries that come after it can keep the row
        expect(mem.held.size).toBe(0);
        expect(mem.log.filter((entry) => entry.startsWith('save'))).toEqual([]);
        // Redis is back while Orbit is still away: the background tries, which reach Orbit, keep the row in the store too
        mem.state.down = false;
        await vi.waitFor(() => expect(mem.held.has('j|c1')).toBe(true), { timeout: 3000 });
        expect(sent).toHaveLength(0);
        // Orbit takes it: it is removed from the store, and nothing is written for it afterwards
        orbitUp = true;
        await vi.waitFor(() => expect(sent).toHaveLength(1), { timeout: 3000 });
        await vi.waitFor(() => expect(mem.held.size).toBe(0));
        const saves = mem.log.filter((entry) => entry.startsWith('save')).length;
        await new Promise((resolve) => setTimeout(resolve, 40));
        expect(mem.log.filter((entry) => entry.startsWith('save'))).toHaveLength(saves);
    });

    it('removes the row Orbit took from the store even when a newer row of the call is waiting in memory and its own write failed', async () => {
        const mem = memoryStore();
        const sends: Array<(took: boolean) => void> = [];
        const notes = createRefusalNotes(() => 1000, { retryMs: [], laterMs: [], store: mem.store, sink: () => new Promise<boolean>((resolve) => sends.push(resolve)) });
        notes.record('b', 'j', call('c1', { kind: 'uncertain', reason: 'provider_5xx', providerStatus: 500 }));
        await vi.waitFor(() => expect(mem.held.get('j|c1')?.row).toMatchObject({ kind: 'uncertain' }));
        await vi.waitFor(() => expect(sends).toHaveLength(1));
        // a newer row of the same call takes its place in memory, and its write to the store fails
        mem.state.failSaves = 1;
        notes.record('b', 'j', call('c1', { kind: 'fault', reason: 'provider_key_ours', providerStatus: 401 }));
        await vi.waitFor(() => expect(mem.state.failSaves).toBe(0));
        // Orbit takes the OLDER row: the store must not go on holding it, or a restart would bring the older outcome back
        sends[0](true);
        await vi.waitFor(() => expect(mem.held.has('j|c1')).toBe(false));
    });

    it('does not save a row over its replacement: only the current row of a call is written again by a flush', async () => {
        const mem = memoryStore();
        // no quick tries and nothing in the background yet: only the flush looks again at what was not kept
        const notes = createRefusalNotes(() => 1000, { retryMs: [], laterMs: [], store: mem.store, sink: async () => false });
        // the first row of the call cannot be kept; its replacement can
        mem.state.failSaves = 1;
        notes.record('b', 'j', call('c1', { kind: 'uncertain', reason: 'provider_5xx', providerStatus: 500 }));
        await new Promise((resolve) => setTimeout(resolve, 15));
        notes.record('b', 'j', call('c1', { kind: 'fault', reason: 'provider_key_ours', providerStatus: 401 }));
        await vi.waitFor(() => expect(mem.held.get('j|c1')?.row).toMatchObject({ kind: 'fault' }));
        // Orbit is away: the flush looks at what is left to keep, and must not write the older row over the newer one
        expect(await notes.flush('j')).toBe(false);
        expect(mem.held.get('j|c1')?.row).toMatchObject({ kind: 'fault', reason: 'provider_key_ours' });
        expect(mem.log.filter((entry) => entry.startsWith('save'))).toEqual(['save c1']);
    });

    it('does not write a row to the store that Orbit took while the store was away', async () => {
        const mem = memoryStore();
        mem.state.failSaves = 1;
        const { notes } = ledger(mem.store, () => true);
        notes.record('b', 'j', call('c1'));
        expect(await notes.flush('j')).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(mem.log.filter((entry) => entry.startsWith('save'))).toEqual([]);
        expect(mem.held.size).toBe(0);
    });

    it('says false while the store cannot be read and true once it can, and keeps what it has meanwhile', async () => {
        const mem = memoryStore();
        const first = ledger(mem.store, () => false);
        first.notes.record('b', 'j', call('c1'));
        await vi.waitFor(() => expect(mem.held.size).toBe(1));
        const second = ledger(mem.store, () => true);
        mem.state.failLoad = true;
        expect(await second.notes.resume()).toBe(false);
        expect(second.sent).toHaveLength(0);
        mem.state.failLoad = false;
        expect(await second.notes.resume()).toBe(true);
        await vi.waitFor(() => expect(second.sent).toHaveLength(1));
    });

    it('goes on trying slowly while rows are kept and Orbit does not answer, and delivers when it does', async () => {
        const mem = memoryStore();
        let orbitUp = false;
        const { notes, sent } = ledger(mem.store, () => orbitUp, { storeLaterMs: 5 });
        notes.record('b', 'j', call('c1'));
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(sent).toHaveLength(0);
        expect(mem.held.size).toBe(1);
        orbitUp = true;
        await vi.waitFor(() => expect(sent).toHaveLength(1), { timeout: 2000 });
        expect(mem.held.size).toBe(0);
    });

    it('a row made in this process wins over the same call kept before, and rows are kept 7 days', async () => {
        const mem = memoryStore();
        const old = ledger(mem.store, () => false);
        old.notes.record('b', 'j', call('c1', { kind: 'uncertain', reason: 'stream_cut', providerStatus: null }));
        await vi.waitFor(() => expect(mem.held.size).toBe(1));
        let up = false;
        const fresh = ledger(mem.store, () => up);
        fresh.notes.record('b', 'j', call('c1', { kind: 'fault', reason: 'relay_down' }));
        await fresh.notes.resume();
        up = true;
        await fresh.notes.flush('j');
        const rows = fresh.sent.flatMap((one) => one.rows).filter((row) => row.callId === 'c1');
        expect(rows.map((row) => row.kind)).toEqual(['fault']);
        expect(EVIDENCE_KEEP_MS).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('tells the operators once that evidence is not durable while the store keeps failing, the row staying in memory and still sent, and again after the store recovers and fails again', async () => {
        const mem = memoryStore();
        mem.state.failSaves = 2;
        const told: Array<[string, string, string]> = [];
        const { notes, sent } = ledger(mem.store, () => true, { report: (what, info) => told.push([what, info.jobId, info.callId]) });
        notes.record('b', 'j', call('c1'));
        notes.record('b', 'j', call('c2'));
        await notes.flush('j');
        // c1 and c2 failed to be kept: told once, not twice
        expect(told.filter(([what]) => what === 'not_durable')).toHaveLength(1);
        expect(sent.flatMap((one) => one.rows).map((row) => row.callId).sort()).toEqual(['c1', 'c2']);
        // the store works again for a row, then fails again: a new telling
        notes.record('b', 'j', call('c3'));
        await notes.flush('j');
        expect(told.filter(([what]) => what === 'not_durable')).toHaveLength(1);
        mem.state.failSaves = 1;
        notes.record('b', 'j', call('c4'));
        await notes.flush('j');
        expect(told.filter(([what]) => what === 'not_durable')).toHaveLength(2);
        expect(told.every(([, jobId]) => jobId === 'j')).toBe(true);
    });

    it('tells the operators once of a row Orbit has not taken for an hour, and not again for that row, nor for a row taken in time', async () => {
        const mem = memoryStore();
        const told: string[] = [];
        let up = false;
        const { notes, sent, advance } = ledger(mem.store, () => up, { report: (what, info) => what === 'unacked' && told.push(info.callId) });
        notes.record('b', 'j', call('c1'));
        await notes.flush('j');
        expect(told).toEqual([]);
        advance(EVIDENCE_UNACKED_MS - 1000);
        await notes.flush('j');
        expect(told).toEqual([]);
        advance(2000);
        await notes.flush('j');
        await notes.flush('j');
        expect(told).toEqual(['c1']);
        up = true;
        await notes.flush('j');
        expect(sent.flatMap((one) => one.rows).map((row) => row.callId)).toEqual(['c1']);
        expect(told).toEqual(['c1']);
    });

    it('a failing report never holds or loses the evidence: the row is still made again in the store and still sent', async () => {
        const mem = memoryStore();
        mem.state.failSaves = 1;
        let up = false;
        const { notes, sent } = ledger(mem.store, () => up, { report: () => { throw new Error('Sentry down'); } });
        notes.record('b', 'j', call('c1'));
        await notes.flush('j');
        expect(mem.held.has('j|c1')).toBe(true);
        up = true;
        expect(await notes.flush('j')).toBe(true);
        expect(sent).toHaveLength(1);
    });

    it('a ledger with no store behaves as before: rows are not kept anywhere but memory, and resume is a yes', async () => {
        const notes = createRefusalNotes(() => 1000, { sink: async () => true });
        expect(await notes.resume()).toBe(true);
    });
});

describe('whether any call of a job reached the relay', () => {
    it('is true from the moment one is noted, for that job only, and false for the window before it', () => {
        const notes = createRefusalNotes(() => 1000);
        const before = notes.mark();
        expect(notes.calledSince('a', before)).toBe(false);
        notes.called('a');
        expect(notes.calledSince('a', before)).toBe(true);
        expect(notes.calledSince('b', before)).toBe(false);
        // a window that began after it does not hold it
        expect(notes.calledSince('a', notes.mark())).toBe(false);
    });

    it('is true after a call that ended in any way: an answer, a fault, a refusal of the person’s allowance, a note', () => {
        const notes = createRefusalNotes(() => 1000);
        for (const [job, make] of [
            ['answered', () => notes.answered('answered')],
            ['fault', () => notes.fault('fault')],
            ['note', () => notes.note('note')],
            ['row-fault', () => notes.record('b', 'row-fault', { callId: 'c1', kind: 'fault', reason: 'provider_5xx', source: 'universe-ai', route: 'r', providerStatus: 500 })],
            ['row-not-ours', () => notes.record('b', 'row-not-ours', { callId: 'c2', kind: 'not_ours', reason: 'allowance', source: 'universe-ai', route: 'r', providerStatus: 429 })],
            ['row-answered', () => notes.record('b', 'row-answered', { callId: 'c3', kind: 'answered', reason: 'provider_5xx', source: 'universe-ai', route: 'r', providerStatus: 200 })],
        ] as const) {
            const before = notes.mark();
            expect(notes.calledSince(job, before), job).toBe(false);
            make();
            expect(notes.calledSince(job, before), job).toBe(true);
        }
    });

    it('is told in milliseconds as well, and forgotten after a while', () => {
        let at = 1000;
        const notes = createRefusalNotes(() => at);
        notes.called('a');
        expect(notes.calledSince('a', 1000)).toBe(true);
        expect(notes.calledSince('a', 1001)).toBe(false);
        at = REFUSAL_NOTE_KEEP_MS + 5000;
        notes.called('new');
        expect(notes.calledSince('a', 0)).toBe(false);
    });
});

describe('whether every call of a turn was refused for want of room in the shared pool', () => {
    const pool = (notes: ReturnType<typeof createRefusalNotes>, job: string, id: string, kind: 'fault' | 'uncertain' = 'fault') =>
        notes.record('b', job, { callId: id, kind, reason: 'pool_busy', source: 'universe-ai', route: 'r', providerStatus: 503 });

    it('is true after a refusal for room when no call was taken up since the turn began, for that job only', () => {
        const notes = createRefusalNotes(() => 1000);
        const before = notes.mark();
        expect(notes.onlyPoolBusySince('a', before)).toBe(false);
        pool(notes, 'a', 'c1');
        expect(notes.onlyPoolBusySince('a', before)).toBe(true);
        // a call refused for its own size is unresolved: it is not a confirmed refusal for room, alone it starts nothing
        pool(notes, 'c', 'c1', 'uncertain');
        expect(notes.onlyPoolBusySince('c', before)).toBe(false);
        // beside a confirmed one in the same turn, it does not hide it
        pool(notes, 'c', 'c2');
        expect(notes.onlyPoolBusySince('c', before)).toBe(true);
        const order = notes.mark();
        pool(notes, 'e', 'c1');
        pool(notes, 'e', 'c2', 'uncertain');
        expect(notes.onlyPoolBusySince('e', order)).toBe(true);
        expect(notes.onlyPoolBusySince('b', before)).toBe(false);
        // a turn that began after it does not hold it
        expect(notes.onlyPoolBusySince('a', notes.mark())).toBe(false);
    });

    it('is false when the person’s allowance or a rule of theirs refused a call of the turn too, whatever the order', () => {
        const notes = createRefusalNotes(() => 1000);
        for (const [job, order] of [['a', ['pool', 'allowance']], ['b', ['allowance', 'pool']], ['c', ['pool', 'rule']]] as const) {
            const before = notes.mark();
            for (const [n, what] of order.entries()) {
                if (what === 'pool') pool(notes, job, `p${n}`);
                else notes.record('b', job, { callId: `r${n}`, kind: 'not_ours', reason: what, source: 'universe-ai', route: 'r', providerStatus: 429 });
            }
            expect(notes.onlyPoolBusySince(job, before), job).toBe(false);
        }
        // only pool refusals (confirmed, with an unresolved one beside them) is still pool-only
        const before = notes.mark();
        pool(notes, 'd', 'p1');
        pool(notes, 'd', 'p2', 'uncertain');
        expect(notes.onlyPoolBusySince('d', before)).toBe(true);
        // a refusal of the person's from an earlier turn does not make this one mixed
        const next = notes.mark();
        pool(notes, 'a', 'p9');
        expect(notes.onlyPoolBusySince('a', next)).toBe(true);
    });

    it('is false when a call of the turn failed some other way of ours too (the relay could not find its route, a provider error), whatever the order', () => {
        const notes = createRefusalNotes(() => 1000);
        const fail = (job: string, id: string, reason: 'relay_down' | 'provider_5xx' | 'field_relay_set', kind: 'fault' | 'uncertain') =>
            notes.record('b', job, { callId: id, kind, reason, source: 'universe-ai', route: 'r', providerStatus: null });
        for (const [job, order] of [
            ['a', ['pool', 'relay']],
            ['b', ['relay', 'pool']],
            ['c', ['pool', 'provider']],
            ['d', ['pool', 'field']],
        ] as const) {
            const before = notes.mark();
            for (const [n, what] of order.entries()) {
                if (what === 'pool') pool(notes, job, `p${n}`);
                else if (what === 'relay') fail(job, `r${n}`, 'relay_down', 'fault');
                else if (what === 'provider') fail(job, `r${n}`, 'provider_5xx', 'uncertain');
                else fail(job, `r${n}`, 'field_relay_set', 'uncertain');
            }
            expect(notes.onlyPoolBusySince(job, before), job).toBe(false);
        }
        // a failure of an earlier turn does not make this one mixed
        const next = notes.mark();
        pool(notes, 'a', 'p9');
        expect(notes.onlyPoolBusySince('a', next)).toBe(true);
    });

    it('is false for a turn with a call taken up, before or after the refusal, and for a refusal that was no refusal for room', () => {
        const notes = createRefusalNotes(() => 1000);
        const before = notes.mark();
        notes.accepted('a');
        pool(notes, 'a', 'c1');
        expect(notes.onlyPoolBusySince('a', before)).toBe(false);
        const second = notes.mark();
        pool(notes, 'b', 'c1');
        notes.accepted('b');
        expect(notes.onlyPoolBusySince('b', second)).toBe(false);
        // an answer was a call taken up too
        notes.record('b', 'd', { callId: 'x', kind: 'answered', reason: 'provider_5xx', source: 'universe-ai', route: 'r', providerStatus: 200 });
        pool(notes, 'd', 'c1');
        expect(notes.onlyPoolBusySince('d', second)).toBe(false);
        const third = notes.mark();
        notes.record('b', 'e', { callId: 'c1', kind: 'fault', reason: 'provider_5xx', source: 'universe-ai', route: 'r', providerStatus: 500 });
        expect(notes.onlyPoolBusySince('e', third)).toBe(false);
        // a call taken up in an earlier turn does not make this one mixed
        const next = notes.mark();
        pool(notes, 'a', 'c2');
        expect(notes.acceptedSince('a', 0)).toBe(true);
        expect(notes.acceptedSince('a', next)).toBe(false);
        expect(notes.onlyPoolBusySince('a', next)).toBe(true);
    });
});
