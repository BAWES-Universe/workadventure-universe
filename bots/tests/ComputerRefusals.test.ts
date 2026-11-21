import { describe, expect, it, vi } from 'vitest';
import { KEEP_LATER, RedisSharedCalls, SET_AND_RENEW, type EvidenceRedis } from '../server/ComputerEvidenceStore';
import { createRefusalNotes, EVIDENCE_KEEP_MS, FAULT_EVIDENCE_MESSAGES, EVIDENCE_UNACKED_MS, FAULT_ROWS_PER_CALL, REFUSAL_NOTE_KEEP_MS, ORBIT_TAKING_ROWS_MS, SHARED_WRITE_BOUND_MS, SHARED_CALL_SKEW_MS, SHARED_TURN_LEASE_MS, SHARED_TURN_RENEW_MS, type CallRow, type EvidenceStore, type SharedCalls, type SharedTurn, type SharedTurnList, type CallTurn } from '../server/ComputerRefusals';

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
        const dead = new Map<string, { botId: string; jobId: string; row: CallRow }>();
        const state = { failSaves: 0, down: false, failLoad: false, failDead: false, gate: undefined as Promise<void> | undefined };
        const store: EvidenceStore = {
            deadLetter: async (botId, jobId, row) => {
                if (state.failDead) return false;
                dead.set(`${jobId}|${row.callId}`, { botId, jobId, row: { ...row } });
                return true;
            },
            dropDead: async (botId, jobId, rows) => {
                for (const row of rows) {
                    const kept = dead.get(`${jobId}|${row.callId}`);
                    if (kept && kept.botId === botId && JSON.stringify(kept.row) === JSON.stringify(row)) dead.delete(`${jobId}|${row.callId}`);
                }
            },
            loadDead: async () => {
                const byJob = new Map<string, { botId: string; jobId: string; rows: CallRow[] }>();
                for (const one of dead.values()) {
                    const entry = byJob.get(one.jobId) ?? { botId: one.botId, jobId: one.jobId, rows: [] };
                    entry.rows.push({ ...one.row });
                    byJob.set(one.jobId, entry);
                }
                return [...byJob.values()];
            },
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
        return { store, held, dead, log, state };
    };
    const ledger = (store: EvidenceStore, sinkAnswers: () => boolean, extra: { storeLaterMs?: number; report?: (what: 'not_durable' | 'unacked' | 'dead_letter' | 'all_refused' | 'called_unrecorded', info: { jobId: string; callId: string }) => void } = {}) => {
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

    describe('a batch Orbit refuses for what is in it', () => {
        /**
         * A sink that refuses (Orbit's own 400) any batch with a bad row in it, takes the others, and can be told to be away. The first row sent goes at once,
         * on its own: the sink holds every answer until `open()`, so the rows that are recorded meanwhile are sent together in the next batch.
         */
        const orbit = (bad: Set<string>) => {
            const state = { away: false, awayForOnly: undefined as string | undefined, awayWhenHas: undefined as string | undefined };
            let open!: () => void;
            const gate = new Promise<void>((resolve) => (open = resolve));
            const taken: string[] = [];
            const calls: string[][] = [];
            const sink = async (_botId: string, _jobId: string, rows: CallRow[]): Promise<boolean | 'rejected'> => {
                await gate;
                const ids = rows.map((row) => row.callId);
                calls.push(ids);
                if (state.away || (state.awayForOnly !== undefined && ids.join() === state.awayForOnly) || (state.awayWhenHas !== undefined && ids.includes(state.awayWhenHas) && !ids.some((id) => bad.has(id)))) return false;
                if (ids.some((id) => bad.has(id))) return 'rejected';
                taken.push(...ids);
                return true;
            };
            return { state, taken, calls, sink, open };
        };

        it('splits the batch so the good rows get through, and sets the row that is refused alone aside (out of the queue and the pending store, kept apart), telling the operators once with its ids', async () => {
            const mem = memoryStore();
            const o = orbit(new Set(['bad']));
            const told: Array<[string, { jobId: string; callId: string }]> = [];
            const notes = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], store: mem.store, sink: o.sink, report: (what, info) => told.push([what, info]) });
            for (const id of ['a', 'b', 'bad', 'c', 'd']) notes.record('bot', 'job', call(id));
            await vi.waitFor(() => expect(mem.held.size).toBe(5));
            o.open();
            expect(await notes.flush('job')).toBe(true);
            expect([...o.taken].sort()).toEqual(['a', 'b', 'c', 'd']);
            expect(told).toEqual([['dead_letter', { jobId: 'job', callId: 'bad' }]]);
            await vi.waitFor(() => expect(mem.held.size).toBe(0));
            // set aside, not lost: kept apart under its own id
            expect([...mem.dead.keys()]).toEqual(['job|bad']);
            // it is not sent again, and the operators are not told again
            const before = o.calls.length;
            expect(await notes.flush('job')).toBe(true);
            expect(o.calls.length).toBe(before);
            expect(told).toHaveLength(1);
        });

        it('lets the rows that came after a bad one through when there are more rows than one batch holds', async () => {
            const o = orbit(new Set(['c000']));
            const told: string[] = [];
            const notes = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], sink: o.sink, report: (what, info) => told.push(`${what} ${info.callId}`) });
            const ids = Array.from({ length: 130 }, (_, n) => `c${String(n).padStart(3, '0')}`);
            for (const id of ids) notes.record('bot', 'job', call(id));
            o.open();
            expect(await notes.flush('job')).toBe(true);
            expect([...o.taken].sort()).toEqual(ids.filter((id) => id !== 'c000'));
            expect(told).toEqual(['dead_letter c000']);
        });

        it('drops every row Orbit refuses, each told once, and still takes the rest', async () => {
            const o = orbit(new Set(['x', 'y']));
            const told: string[] = [];
            const notes = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], sink: o.sink, report: (_what, info) => told.push(info.callId) });
            for (const id of ['x', 'a', 'y', 'b']) notes.record('bot', 'job', call(id));
            o.open();
            expect(await notes.flush('job')).toBe(true);
            expect([...o.taken].sort()).toEqual(['a', 'b']);
            expect(told.sort()).toEqual(['x', 'y']);
        });

        it('keeps a row, with its call id, while Orbit is away or fails: only a refusal of the row alone drops it', async () => {
            const o = orbit(new Set(['bad']));
            const told: string[] = [];
            const notes = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], sink: o.sink, report: (what) => told.push(what) });
            o.state.away = true;
            for (const id of ['a', 'bad']) notes.record('bot', 'job', call(id));
            o.open();
            expect(await notes.flush('job')).toBe(false);
            expect(o.taken).toEqual([]);
            expect(told).toEqual([]);
            o.state.away = false;
            expect(await notes.flush('job')).toBe(true);
            expect(o.taken).toEqual(['a']);
            expect(told).toEqual(['dead_letter']);
        });

        it('stops where Orbit goes away in the middle of a split, after a good child was taken, and sends only the rest again later, with the same call ids', async () => {
            const o = orbit(new Set(['bad']));
            const notes = createRefusalNotes(() => 1000, { retryMs: [], laterMs: [], sink: o.sink });
            // the batch [b, bad, c, d] is split in halves: [b, bad] is split again and its child [b] is TAKEN, then Orbit goes away for the other half [c, d]
            o.state.awayWhenHas = 'c';
            for (const id of ['a', 'b', 'bad', 'c', 'd']) notes.record('bot', 'job', call(id));
            o.open();
            expect(await notes.flush('job')).toBe(false);
            // [a] went first, and [b] was taken before Orbit went away
            expect(o.taken).toEqual(['a', 'b']);
            const before = o.calls.length;
            o.state.awayWhenHas = undefined;
            expect(await notes.flush('job')).toBe(true);
            // the retry sends only what Orbit has not dealt with, under the ids they had: the rows it took are not sent again
            const again = o.calls.slice(before).flat();
            expect(again).not.toContain('a');
            expect(again).not.toContain('b');
            expect([...again].sort()).toEqual(expect.arrayContaining(['bad', 'c', 'd']));
            expect([...o.taken].sort()).toEqual(['a', 'b', 'c', 'd']);
            // every call id was taken once
            expect(new Set(o.taken).size).toBe(o.taken.length);
        });

        it('leaves a newer row of the same call id where it is when the older one was refused alone', async () => {
            const mem = memoryStore();
            let release!: () => void;
            const gate = new Promise<void>((resolve) => (release = resolve));
            const taken: CallRow[] = [];
            const told: string[] = [];
            const notes = createRefusalNotes(() => 1000, {
                retryMs: [0],
                laterMs: [],
                store: mem.store,
                report: (what) => told.push(what),
                sink: async (_b, _j, rows) => {
                    await gate;
                    if (rows.some((row) => row.kind === 'uncertain')) return 'rejected';
                    taken.push(...rows.map((row) => ({ ...row })));
                    return true;
                },
            });
            notes.record('bot', 'job', call('c1', { kind: 'uncertain', reason: 'provider_5xx', providerStatus: 500 }));
            const flushed = notes.flush('job');
            // upgraded while the older one is on its way
            notes.record('bot', 'job', call('c1', { kind: 'fault', reason: 'provider_key_ours', providerStatus: 401 }));
            release();
            expect(await flushed).toBe(true);
            // the older row was refused alone and dropped; the newer row was not touched by that, and went on its own
            await vi.waitFor(() => expect(taken.map((row) => row.kind)).toEqual(['fault']));
            expect(told).toEqual(['dead_letter']);
            await vi.waitFor(() => expect(mem.held.size).toBe(0));
        });

        describe('when Orbit refuses every row, it is treated like Orbit being away', () => {
            it('keeps every row and sends it again, tells the operators once, and sets nothing aside', async () => {
                const mem = memoryStore();
                const o = orbit(new Set(['x', 'y', 'z']));
                const told: Array<[string, string]> = [];
                const notes = createRefusalNotes(() => 1000, { retryMs: [0, 0], laterMs: [], store: mem.store, sink: o.sink, report: (what, info) => told.push([what, info.callId]) });
                for (const id of ['x', 'y', 'z']) notes.record('bot', 'job', call(id));
                o.open();
                expect(await notes.flush('job')).toBe(false);
                expect(await notes.flush('job')).toBe(false);
                expect(o.taken).toEqual([]);
                expect(mem.dead.size).toBe(0);
                expect([...mem.held.keys()].sort()).toEqual(['job|x', 'job|y', 'job|z']);
                expect(told.map(([what]) => what)).toEqual(['all_refused']);
            });

            it('sets the refused rows aside once Orbit is taking others: the same rows, under the same ids, nothing lost', async () => {
                const mem = memoryStore();
                const o = orbit(new Set(['x']));
                const told: string[] = [];
                const notes = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], store: mem.store, sink: o.sink, report: (what) => told.push(what) });
                notes.record('bot', 'job', call('x'));
                o.open();
                // a job whose only row Orbit refuses, while Orbit has taken nothing: kept
                expect(await notes.flush('job')).toBe(false);
                expect(mem.dead.size).toBe(0);
                // Orbit takes the rows of another job: it works, so the row is its own fault
                notes.record('bot', 'other', call('fine'));
                expect(await notes.flush('other')).toBe(true);
                expect(await notes.flush('job')).toBe(true);
                expect([...mem.dead.keys()]).toEqual(['job|x']);
                expect(mem.dead.get('job|x')?.row).toMatchObject({ callId: 'x', kind: 'fault', reason: 'relay_down' });
                expect(mem.held.size).toBe(0);
                expect(told).toEqual(['all_refused', 'dead_letter']);
            });

            it('does not take a row Orbit took long ago as proof that it takes rows now', async () => {
                let at = 1000;
                const o = orbit(new Set(['x']));
                const notes = createRefusalNotes(() => at, { retryMs: [0], laterMs: [], sink: o.sink });
                o.open();
                notes.record('bot', 'other', call('fine'));
                expect(await notes.flush('other')).toBe(true);
                at += ORBIT_TAKING_ROWS_MS + 1;
                notes.record('bot', 'job', call('x'));
                expect(await notes.flush('job')).toBe(false);
                at += 1;
                notes.record('bot', 'other', call('fine2'));
                expect(await notes.flush('other')).toBe(true);
                expect(await notes.flush('job')).toBe(true);
            });

            it('tells the operators once for each time Orbit stops taking rows: again after it took some and then refused every one', async () => {
                let at = 1000;
                const o = orbit(new Set(['x', 'y']));
                const told: string[] = [];
                const notes = createRefusalNotes(() => at, { retryMs: [], laterMs: [], sink: o.sink, report: (what) => told.push(what) });
                o.open();
                notes.record('bot', 'j1', call('x'));
                expect(await notes.flush('j1')).toBe(false);
                expect(await notes.flush('j1')).toBe(false);
                expect(told).toEqual(['all_refused']);
                notes.record('bot', 'j2', call('fine'));
                expect(await notes.flush('j2')).toBe(true);
                expect(await notes.flush('j1')).toBe(true);
                expect(told).toEqual(['all_refused', 'dead_letter']);
                // Orbit stops taking rows again (nothing taken for longer than the proof lasts)
                at += ORBIT_TAKING_ROWS_MS + 1;
                notes.record('bot', 'j3', call('y'));
                expect(await notes.flush('j3')).toBe(false);
                expect(told).toEqual(['all_refused', 'dead_letter', 'all_refused']);
            });
        });

        it('keeps the row where it is, and tells nothing of it, when the dead letters could not be kept: it is sent again later', async () => {
            const mem = memoryStore();
            mem.state.failDead = true;
            const o = orbit(new Set(['bad']));
            const told: string[] = [];
            const notes = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], store: mem.store, sink: o.sink, report: (what) => told.push(what) });
            for (const id of ['a', 'bad']) notes.record('bot', 'job', call(id));
            o.open();
            expect(await notes.flush('job')).toBe(false);
            expect(told).toEqual([]);
            expect(mem.held.has('job|bad')).toBe(true);
            mem.state.failDead = false;
            expect(await notes.flush('job')).toBe(true);
            expect(told).toEqual(['dead_letter']);
            expect([...mem.dead.keys()]).toEqual(['job|bad']);
        });

        it('replays the dead letters under their own ids once Orbit takes them, and keeps them kept', async () => {
            const mem = memoryStore();
            const bad = new Set(['bad']);
            const o = orbit(bad);
            const notes = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], store: mem.store, sink: o.sink });
            for (const id of ['a', 'bad']) notes.record('bot', 'job', call(id));
            o.open();
            expect(await notes.flush('job')).toBe(true);
            expect(o.taken).toEqual(['a']);
            // the cause is mended (an upgraded Orbit)
            bad.clear();
            expect(await notes.replayDeadLetters()).toBe(1);
            expect(await notes.flush('job')).toBe(true);
            expect(o.taken).toEqual(['a', 'bad']);
            expect(mem.held.size).toBe(0);
            // a row Orbit took leaves the dead letters
            await vi.waitFor(() => expect(mem.dead.size).toBe(0));
        });

        it('keeps a dead letter a replay did not get taken, with nothing told again', async () => {
            const mem = memoryStore();
            const o = orbit(new Set(['bad']));
            const told: string[] = [];
            const notes = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], store: mem.store, sink: o.sink, report: (what) => told.push(what) });
            for (const id of ['a', 'bad']) notes.record('bot', 'job', call(id));
            o.open();
            expect(await notes.flush('job')).toBe(true);
            expect(told).toEqual(['dead_letter']);
            // offered again while the cause stands, with Orbit taking other rows: refused alone again, it stays where it is
            expect(await notes.replayDeadLetters()).toBe(1);
            notes.record('bot', 'job', call('b'));
            expect(await notes.flush('job')).toBe(true);
            expect([...mem.dead.keys()]).toEqual(['job|bad']);
            expect(mem.held.size).toBe(0);
            expect(told).toEqual(['dead_letter']);
            expect(o.taken).toEqual(['a', 'b']);
        });

        it('replays the dead letters of one job only, or of all', async () => {
            const mem = memoryStore();
            const bad = new Set(['bad1', 'bad2']);
            const o = orbit(bad);
            const notes = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], store: mem.store, sink: o.sink });
            for (const [job, id] of [['j1', 'bad1'], ['j1', 'ok1'], ['j2', 'bad2'], ['j2', 'ok2']]) notes.record('bot', job, call(id));
            o.open();
            await notes.flush('j1');
            await notes.flush('j2');
            expect([...mem.dead.keys()].sort()).toEqual(['j1|bad1', 'j2|bad2']);
            bad.clear();
            expect(await notes.replayDeadLetters('j1')).toBe(1);
            await notes.flush('j1');
            await vi.waitFor(() => expect([...mem.dead.keys()]).toEqual(['j2|bad2']));
            expect(await notes.replayDeadLetters('nothing')).toBe(0);
            expect(await notes.replayDeadLetters()).toBe(1);
            await notes.flush('j2');
            await vi.waitFor(() => expect(mem.dead.size).toBe(0));
            expect(o.taken.filter((id) => id.startsWith('bad')).sort()).toEqual(['bad1', 'bad2']);
        });

        it('says null when the dead letters cannot be read, and with no store keeps them in memory, replayable', async () => {
            const mem = memoryStore();
            mem.store.loadDead = async () => {
                throw new Error('store down');
            };
            const down = createRefusalNotes(() => 1000, { store: mem.store, sink: async () => true });
            expect(await down.replayDeadLetters()).toBeNull();
            const bad = new Set(['bad']);
            const o = orbit(bad);
            const notes = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], sink: o.sink });
            for (const id of ['a', 'bad']) notes.record('bot', 'job', call(id));
            o.open();
            expect(await notes.flush('job')).toBe(true);
            bad.clear();
            expect(await notes.replayDeadLetters()).toBe(1);
            expect(await notes.flush('job')).toBe(true);
            expect(o.taken).toEqual(['a', 'bad']);
        });

        it('does not let a report that throws hold the rows', async () => {
            const o = orbit(new Set(['bad']));
            const notes = createRefusalNotes(() => 1000, {
                retryMs: [0],
                laterMs: [],
                sink: o.sink,
                report: () => {
                    throw new Error('sentry down');
                },
            });
            for (const id of ['a', 'bad', 'b']) notes.record('bot', 'job', call(id));
            o.open();
            expect(await notes.flush('job')).toBe(true);
            expect([...o.taken].sort()).toEqual(['a', 'b']);
        });
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


/** What the bot servers share in the store, in memory: one latest call per job and server; a server reads the others' only. */
const sharedStore = () => {
    const seen = new Map<string, Map<string, number>>();
    const state = { moments: [] as Array<[string, number]>, down: false, failCalled: 0, failTurns: 0, failAccepted: 0, failUnrecorded: false, told: [] as string[], unrecorded: [] as string[], hold: undefined as Promise<void> | undefined };
    /** The turns each server's runner said, per job: the field `turn:<server>` of the shared record. */
    const turns = new Map<string, Map<string, SharedTurnList>>();
    /** The acceptances each server noted, per job: its moment and the turn (and run) the call began in (`undefined`: not known). */
    const accepted: Array<{ server: string; jobId: string; at: number; turn?: CallTurn }> = [];
    const put = (jobId: string, field: string, at: number) => {
        const byServer = seen.get(jobId) ?? new Map<string, number>();
        byServer.set(field, Math.max(at, byServer.get(field) ?? 0));
        seen.set(jobId, byServer);
    };
    const forServer = (id: string): SharedCalls => ({
        noteCalled: async (jobId, at) => {
            if (state.hold) await state.hold;
            if (state.down) throw new Error('shared store down');
            state.moments.push(['called', at]);
            if (state.failCalled > 0) {
                state.failCalled -= 1;
                throw new Error('write lost');
            }
            state.told.push(`${id}:${jobId}`);
            put(jobId, id, at);
        },
        noteUnrecorded: async (jobId, at) => {
            state.moments.push(['unrecorded', at]);
            if (state.down || state.failUnrecorded) throw new Error('shared store down');
            state.unrecorded.push(`${id}:${jobId}`);
            put(jobId, `unsure:${id}`, at);
        },
        noteTurn: async (jobId, said, until) => {
            if (state.down || state.failTurns > 0) {
                if (state.failTurns > 0) state.failTurns -= 1;
                throw new Error('shared store down');
            }
            const byServer = turns.get(jobId) ?? new Map<string, SharedTurnList>();
            byServer.set(id, { turns: said, until });
            turns.set(jobId, byServer);
        },
        turnsByOthers: async (jobId) => {
            if (state.down) throw new Error('shared store down');
            const out: SharedTurnList[] = [];
            for (const [server, said] of turns.get(jobId) ?? []) if (server !== id) out.push(said);
            return out;
        },
        noteAccepted: async (jobId, at, turn) => {
            if (state.down || state.failAccepted > 0) {
                if (state.failAccepted > 0) state.failAccepted -= 1;
                throw new Error('shared store down');
            }
            accepted.push({ server: id, jobId, at, ...(turn ? { turn } : {}) });
        },
        lastAcceptedByOthers: async (jobId, turn) => {
            if (state.down) throw new Error('shared store down');
            let latest: number | null = null;
            for (const one of accepted) {
                if (one.server === id || one.jobId !== jobId) continue;
                if (turn && one.turn && (one.turn.turn !== turn.turn || one.turn.run !== turn.run)) continue;
                if (latest === null || one.at > latest) latest = one.at;
            }
            return latest;
        },
        lastCalledByOthers: async (jobId) => {
            if (state.down) throw new Error('shared store down');
            let latest: number | null = null;
            for (const [field, at] of seen.get(jobId) ?? []) {
                const server = field.startsWith('unsure:') ? field.slice('unsure:'.length) : field;
                if (server !== id && (latest === null || at > latest)) latest = at;
            }
            return latest;
        },
    });
    return { forServer, state };
};

describe('calls of a job that arrive at another bot server', () => {
    const call = (callId: string) => ({ callId, kind: 'fault' as const, reason: 'relay_down' as const, source: 'universe-ai' as const, route: 'r', providerStatus: 503 as number | null });
    const rig = () => {
        let at = 100_000;
        const store = sharedStore();
        /** The jobs whose runner is working on B this moment. */
        const here = new Set<string>();
        // the runner of the jobs of these tests works on A
        const a = createRefusalNotes(() => at, { shared: store.forServer('A'), runsHere: () => true });
        const b = createRefusalNotes(() => at, { shared: store.forServer('B'), runsHere: (jobId) => here.has(jobId) });
        return { a, b, store, here, advance: (ms: number) => (at += ms) };
    };

    it('says a call arrived when the other server saw it, though this server’s own notes have none', async () => {
        const { a, b, advance } = rig();
        a.turn('j', 1);
        advance(10);
        const mark = a.mark();
        advance(10);
        // the machine's call lands on B (a rolling deploy, a second replica); the runner of the job is on A
        b.called('j');
        expect(a.calledSince('j', mark)).toBe(false);
        expect(await a.calledAnywhereSince('j', mark)).toBe(true);
        // the other way round the same: B's own notes say it, and A's call is not B's to hear of
        expect(await b.calledAnywhereSince('j', b.mark())).toBe(false);
    });

    it('says none arrived only when no server saw one in the window', async () => {
        const { a, b, advance } = rig();
        // a call of an earlier window (more than the clocks can differ before it) is not in this one, at either server
        b.called('j');
        a.called('j');
        advance(60_000);
        const mark = a.mark();
        expect(await a.calledAnywhereSince('j', mark)).toBe(false);
        // another job's call is not this job's
        b.called('other');
        expect(await a.calledAnywhereSince('j', mark)).toBe(false);
        advance(10);
        b.called('j');
        expect(await a.calledAnywhereSince('j', mark)).toBe(true);
    });

    it('lets the clocks of two servers differ a little: a call the other server saw just before this server’s turn began still counts', async () => {
        const { a, b, advance } = rig();
        b.called('j');
        advance(1000);
        expect(await a.calledAnywhereSince('j', a.mark())).toBe(true);
        advance(60_000);
        expect(await a.calledAnywhereSince('j', a.mark())).toBe(false);
    });

    it('does not conclude "no call" when it cannot tell: the shared store cannot be read, or the window has no moment in it', async () => {
        const { a, store } = rig();
        store.state.down = true;
        expect(await a.calledAnywhereSince('j', a.mark())).toBe(true);
        expect(await a.calledAnywhereSince('j', Date.now())).toBe(true);
        store.state.down = false;
        // a window given as a place in the order only (no moment) cannot be put in the other servers' time
        expect(await a.calledAnywhereSince('j', { order: a.mark().order })).toBe(true);
        expect(await a.calledAnywhereSince('j', a.mark())).toBe(false);
    });

    it('is what this server saw when there is no shared store', async () => {
        const notes = createRefusalNotes(() => 1000);
        const mark = notes.mark();
        expect(await notes.calledAnywhereSince('j', mark)).toBe(false);
        notes.called('j');
        expect(await notes.calledAnywhereSince('j', mark)).toBe(true);
    });

    it('tells the other servers of a call it noted, and of none it left out as a call of a turn the runner has left', async () => {
        const { a, store } = rig();
        a.turn('j', 2);
        a.called('j', { turn: 1 });
        expect(store.state.told).toEqual([]);
        a.called('j', { turn: 2 });
        expect(store.state.told).toEqual(['A:j']);
        // how a call ended is no arrival: nothing more is told by a record, an answer, a fault or a refusal
        a.record('b', 'j', call('c1'));
        // a call the person's own key or allowance stopped is a call that ended too: the arrival was told when it reached the relay
        a.record('b', 'j', { ...call('c2'), kind: 'not_ours', reason: 'own_provider', source: 'own-key' });
        a.record('b', 'j', { ...call('c3'), kind: 'uncertain', reason: 'provider_5xx' });
        a.record('b', 'j', { ...call('c4'), kind: 'answered' as never });
        a.answered('j');
        a.fault('j');
        a.note('j');
        a.accepted('j');
        expect(store.state.told).toEqual(['A:j']);
    });

    it('does not publish the end of a call as a new arrival: a call that reached B in an earlier turn and finishes in this one does not hide a genuine no_call of this turn', async () => {
        const { a, b, advance } = rig();
        a.turn('j', 4);
        // the call of turn 4 reaches B and is recorded at its arrival
        expect(await b.reached('j')).toBe(true);
        // the runner on A moves on to turn 5 (well after the clocks of the servers can differ)
        advance(60_000);
        a.turn('j', 5);
        const mark = a.mark();
        advance(10);
        // the call of turn 4 only now finishes on B, by every kind of ending
        b.answered('j');
        b.fault('j');
        b.record('b', 'j', call('c1'));
        b.record('b', 'j', { ...call('c2'), kind: 'not_ours', reason: 'own_provider', source: 'own-key' });
        b.note('j');
        expect(await a.calledAnywhereSince('j', mark)).toBe(false);
    });

    it('says a call was taken up when another server took one up, tells the others of its own, and concludes nothing when it cannot tell', async () => {
        let at = 100_000;
        const accepted = new Map<string, number>();
        const reads = { down: false };
        const forServer = (id: string): SharedCalls => ({
            noteCalled: async () => undefined,
            noteUnrecorded: async () => undefined,
            lastCalledByOthers: async () => null,
            noteAccepted: async (_job, when) => void accepted.set(id, when),
            lastAcceptedByOthers: async () => {
                if (reads.down) throw new Error('down');
                const others = [...accepted].filter(([server]) => server !== id).map(([, when]) => when);
                return others.length > 0 ? Math.max(...others) : null;
            },
        });
        const a = createRefusalNotes(() => at, { shared: forServer('A') });
        const b = createRefusalNotes(() => at, { shared: forServer('B') });
        a.turn('j', 1);
        const mark = a.mark();
        at += 10;
        expect(await a.acceptedAnywhereSince('j', mark)).toBe(false);
        // B's relay takes a call up: A's own notes know nothing of it, the shared record does
        b.accepted('j');
        expect(a.acceptedSince('j', mark)).toBe(false);
        expect(await a.acceptedAnywhereSince('j', mark)).toBe(true);
        // a call of a turn the runner has left is not told
        b.turn('j', 2);
        b.accepted('j', { turn: 1 });
        expect(accepted.get('B')).toBe(100_010);
        // A's own acceptance counts without the store, and an unreadable store is not "none taken up"
        const quiet = createRefusalNotes(() => at, { shared: forServer('C') });
        reads.down = true;
        expect(await quiet.acceptedAnywhereSince('j', quiet.mark())).toBe(true);
        reads.down = false;
        expect(await quiet.acceptedAnywhereSince('j', { order: quiet.mark().order })).toBe(true);
        // no shared store: this server's own notes
        const alone = createRefusalNotes(() => at);
        const from = alone.mark();
        expect(await alone.acceptedAnywhereSince('j', from)).toBe(false);
        alone.accepted('j');
        expect(await alone.acceptedAnywhereSince('j', from)).toBe(true);
    });

    it('looks at this server’s own notes again after the shared read: a call that reached this server while the read was pending is a call', async () => {
        let at = 100_000;
        const shared = {
            noteCalled: async () => undefined,
            noteUnrecorded: async () => undefined,
            lastCalledByOthers: async () => {
                // a call arrives HERE while the shared store is being read (the read leaves this server's own fields out)
                at += 5;
                notes.called('j');
                return null;
            },
        };
        const notes = createRefusalNotes(() => at, { shared });
        const mark = notes.mark();
        at += 5;
        expect(await notes.calledAnywhereSince('j', mark)).toBe(true);
        // and with no call anywhere it is still false
        const quiet = createRefusalNotes(() => at, { shared: { ...shared, lastCalledByOthers: async () => null } });
        expect(await quiet.calledAnywhereSince('j', quiet.mark())).toBe(false);
    });

    it('is not held up or broken by a shared store that fails or throws', async () => {
        const notes = createRefusalNotes(() => 1000, {
            shared: {
                noteCalled: () => {
                    throw new Error('sync');
                },
                noteUnrecorded: async () => undefined,
                lastCalledByOthers: async () => null,
            },
        });
        expect(() => notes.called('j')).not.toThrow();
        const rejecting = createRefusalNotes(() => 1000, { shared: { noteCalled: async () => Promise.reject(new Error('async')), noteUnrecorded: async () => undefined, lastCalledByOthers: async () => null } });
        expect(() => rejecting.called('j')).not.toThrow();
        await Promise.resolve();
    });

    describe('a call the relay is about to forward (reached)', () => {
        it('records the call for the other servers before it resolves, and a write that fails once is tried again with the same moment', async () => {
            const { a, b, store } = rig();
            store.state.failCalled = 1;
            a.turn('j', 1);
            const mark = a.mark();
            // the call lands on B; B's first write is lost and its retry lands
            expect(await b.reached('j')).toBe(true);
            expect(store.state.told).toEqual(['B:j']);
            expect(await a.calledAnywhereSince('j', mark)).toBe(true);
        });

        it('tells the other servers apart, and the operators once per job, when both writes fail; the call is not held and A concludes nothing', async () => {
            const told: Array<[string, string]> = [];
            const store = sharedStore();
            let at = 100_000;
            const a = createRefusalNotes(() => at, { shared: store.forServer('A') });
            const b = createRefusalNotes(() => at, { shared: store.forServer('B'), report: (what, info) => told.push([what, info.jobId]), runsHere: (jobId) => ['j', 'other'].includes(jobId) });
            const mark = a.mark();
            at += 10;
            store.state.failCalled = 2;
            // the runner of these jobs is working on this server now: the call may go ahead
            expect(await b.reached('j')).toBe(false);
            expect(store.state.unrecorded).toEqual(['B:j']);
            expect(told).toEqual([['called_unrecorded', 'j']]);
            // A reads the other field: a call may have arrived, so no_call is not concluded
            expect(a.calledSince('j', mark)).toBe(false);
            expect(await a.calledAnywhereSince('j', mark)).toBe(true);
            // told once for the job, though another call fails the same way; another job is told too
            store.state.failCalled = 4;
            expect(await b.reached('j')).toBe(false);
            expect(await b.reached('other')).toBe(false);
            expect(told).toEqual([['called_unrecorded', 'j'], ['called_unrecorded', 'other']]);
        });

        it('when even the apart note cannot be written the store is failing: A’s read fails too, and nothing is concluded', async () => {
            const { a, b, store, here } = rig();
            const mark = a.mark();
            store.state.down = true;
            here.add('j');
            expect(await b.reached('j')).toBe(false);
            expect(store.state.unrecorded).toEqual([]);
            expect(await a.calledAnywhereSince('j', mark)).toBe(true);
        });

        it('does not hold the call for a store that does not answer: each try is bounded, and the call goes on', async () => {
            vi.useFakeTimers();
            try {
                const { b, store, here } = rig();
                here.add('j');
                store.state.hold = new Promise<void>(() => undefined);
                let done = false;
                const reached = b.reached('j').then((recorded) => {
                    done = true;
                    return recorded;
                });
                await vi.advanceTimersByTimeAsync(SHARED_WRITE_BOUND_MS - 1);
                expect(done).toBe(false);
                // the second try, then the note apart
                await vi.advanceTimersByTimeAsync(SHARED_WRITE_BOUND_MS * 2 + 10);
                expect(await reached).toBe(false);
                expect(store.state.unrecorded).toEqual(['B:j']);
            } finally {
                vi.useRealTimers();
            }
        });

        it('is unservable when both writes fail and the job’s runner is not on this server: the call cannot be seen by anyone, so it is not forwarded', async () => {
            const told: Array<[string, string]> = [];
            const store = sharedStore();
            const b = createRefusalNotes(() => 1000, { shared: store.forServer('B'), report: (what, info) => told.push([what, info.jobId]), runsHere: (jobId) => jobId === 'here' });
            store.state.failCalled = 2;
            expect(await b.reached('j')).toBe('unservable');
            // nothing was said apart: a runner on another server reads the store, which may be well
            expect(store.state.unrecorded).toEqual([]);
            expect(told).toEqual([['called_unrecorded', 'j']]);
            // a write that lands is all right whoever runs the job
            expect(await b.reached('j')).toBe(true);
            // told once for the job
            store.state.failCalled = 2;
            expect(await b.reached('j')).toBe('unservable');
            expect(told).toHaveLength(1);
            // with the runner working here now it may go ahead
            store.state.failCalled = 2;
            expect(await b.reached('here')).toBe(false);
        });

        it('is unservable when the apart note fails too and the runner stopped the job while it was being written: whoever runs the job now cannot see the call', async () => {
            const store = sharedStore();
            let asked = 0;
            // the runner works the job when the call arrives and has stopped it by the time the apart note failed
            const b = createRefusalNotes(() => 1000, { shared: store.forServer('B'), runsHere: () => asked++ < 2 });
            store.state.failCalled = 2;
            store.state.failUnrecorded = true;
            expect(await b.reached('j')).toBe('unservable');
            // the runner still here when the apart note fails: the call goes ahead as before
            const c = createRefusalNotes(() => 1000, { shared: store.forServer('C'), runsHere: () => true });
            store.state.failCalled = 2;
            expect(await c.reached('k')).toBe(false);
            // the runner stopped the job but the apart note WAS written: whoever runs it now reads that a call may have arrived, so it may go ahead
            let n = 0;
            const d = createRefusalNotes(() => 1000, { shared: store.forServer('D'), runsHere: () => n++ < 2 });
            store.state.failCalled = 2;
            store.state.failUnrecorded = false;
            expect(await d.reached('m')).toBe(false);
        });

        it('does not count a turn the notes remember as a runner that is here: a job taken over by another server, or stopped, is not run here now', async () => {
            const { b, store, here } = rig();
            // this server ran the job a minute ago (its notes hold the turn), then the runner stopped it and another server took it over
            b.turn('j', 3, 'run-old');
            here.add('j');
            here.delete('j');
            store.state.failCalled = 2;
            expect(await b.reached('j')).toBe('unservable');
            // nothing that says whether a runner is here: nothing is run here
            const without = createRefusalNotes(() => 1000, { shared: store.forServer('B') });
            without.turn('j', 1);
            store.state.failCalled = 2;
            expect(await without.reached('j')).toBe('unservable');
            const throwing = createRefusalNotes(() => 1000, {
                shared: store.forServer('B'),
                runsHere: () => {
                    throw new Error('runner gone');
                },
            });
            store.state.failCalled = 2;
            expect(await throwing.reached('j')).toBe('unservable');
            // the runner working it now: forwarded
            here.add('j');
            store.state.failCalled = 2;
            expect(await b.reached('j')).toBe(false);
        });

        it('notes the call for this server as `called` does, leaves a call of a turn the runner has left alone, and is true with no shared store', async () => {
            const { a, store } = rig();
            a.turn('j', 2);
            const mark = a.mark();
            expect(await a.reached('j', { turn: 1 })).toBe(true);
            expect(a.calledSince('j', mark)).toBe(false);
            expect(store.state.told).toEqual([]);
            expect(await a.reached('j', { turn: 2 })).toBe(true);
            expect(a.calledSince('j', mark)).toBe(true);
            expect(store.state.told).toEqual(['A:j']);
            const alone = createRefusalNotes(() => 1000);
            expect(await alone.reached('j')).toBe(true);
            expect(alone.calledSince('j', 0)).toBe(true);
        });
    });

    describe('the moment a call arrived, and which server’s history says a call is of a turn gone by', () => {
        it('writes the moment the call ARRIVED in both tries and in the marker of a call that could not be recorded, never the time the write is made', async () => {
            let at = 100_000;
            const store = sharedStore();
            const b = createRefusalNotes(() => at, { shared: store.forServer('B'), runsHere: () => true });
            store.state.failCalled = 2;
            const arrivedAt = at;
            // the writes are made a good while after the call arrived (the body, the key, the room were being waited for)
            at += 4500;
            expect(await b.reached('j', undefined, arrivedAt)).toBe(false);
            expect(store.state.moments).toEqual([['called', arrivedAt], ['called', arrivedAt], ['unrecorded', arrivedAt]]);
            // a write that goes through the first time says it too
            store.state.moments.length = 0;
            expect(await b.reached('k', undefined, arrivedAt + 1)).toBe(true);
            expect(store.state.moments).toEqual([['called', arrivedAt + 1]]);
            // with no arrival given (a caller that has none), it is the moment of the write as before
            store.state.moments.length = 0;
            expect(await b.reached('m')).toBe(true);
            expect(store.state.moments).toEqual([['called', at]]);
        });

        it('a late write does not read as a later arrival for the runner on another server: a call that arrived before the turn began is not a call of it', async () => {
            let at = 100_000;
            const store = sharedStore();
            const a = createRefusalNotes(() => at, { shared: store.forServer('A'), runsHere: () => true });
            const b = createRefusalNotes(() => at, { shared: store.forServer('B'), runsHere: () => false });
            a.turn('j', 4, 'r');
            const arrivedAt = at;
            at += 10_000;
            a.turn('j', 5, 'r');
            const mark = a.mark();
            // the call of turn 4 is written to the shared record only now, long after it arrived (it carries its arrival)
            expect(await b.reached('j', undefined, arrivedAt)).toBe(true);
            expect(await a.calledAnywhereSince('j', mark)).toBe(false);
            // written with the moment of the write it would have hidden a genuine no_call of turn 5
            await b.reached('j');
            expect(await a.calledAnywhereSince('j', mark)).toBe(true);
        });

        it('does not let a former runner’s history keep a call from the shared record: a server that ran the job before, and no longer does, still writes the arrival of a call that belongs to the runner elsewhere, and is unservable when it cannot', async () => {
            const at = 100_000;
            const store = sharedStore();
            // B ran the job a while ago (its notes hold turn 2 of an old run); A runs it now, in turn 7 of another run
            const b = createRefusalNotes(() => at, { shared: store.forServer('B'), runsHere: () => false });
            b.turn('j', 2, 'old-run');
            expect(await b.reached('j', { turn: 7, run: 'new-run' }, at)).toBe(true);
            expect(store.state.told).toEqual(['B:j']);
            // not recorded: refused, not forwarded
            store.state.failCalled = 2;
            expect(await b.reached('j', { turn: 7, run: 'new-run' }, at)).toBe('unservable');
            // the runner HERE and a turn it has left: still nothing is written for it
            const c = createRefusalNotes(() => at, { shared: store.forServer('C'), runsHere: () => true });
            c.turn('k', 2, 'run');
            store.state.told.length = 0;
            expect(await c.reached('k', { turn: 1, run: 'run' }, at)).toBe(true);
            expect(store.state.told).toEqual([]);
        });
    });

    describe('a call taken up by the pool, as the runner on another server learns of it', () => {
        const rigAccept = () => {
            let at = 100_000;
            const store = sharedStore();
            const a = createRefusalNotes(() => at, { shared: store.forServer('A'), runsHere: () => true });
            const b = createRefusalNotes(() => at, { shared: store.forServer('B'), runsHere: () => false });
            return { a, b, store, advance: (ms: number) => (at += ms), now: () => at };
        };

        it('hands the acceptance over before the call goes on, when the runner is on another server: true when it was written, with the turn and run of the call', async () => {
            const { b, store } = rigAccept();
            const handed = b.accepted('j', { turn: 4, run: 'run-1' });
            expect(handed).toBeInstanceOf(Promise);
            expect(await handed).toBe(true);
            expect(store.state.moments).toEqual([]);
        });

        it('is false when the handoff cannot be made (two bounded tries), and true when the second try works', async () => {
            const { b, store } = rigAccept();
            store.state.failAccepted = 2;
            expect(await b.accepted('j', { turn: 4, run: 'run-1' })).toBe(false);
            store.state.failAccepted = 1;
            expect(await b.accepted('k', { turn: 4, run: 'run-1' })).toBe(true);
            store.state.down = true;
            expect(await b.accepted('m')).toBe(false);
        });

        it('does not wait on a store that does not answer: false after the bound, twice', async () => {
            vi.useFakeTimers();
            try {
                const hang: SharedCalls = {
                    noteCalled: async () => undefined,
                    noteUnrecorded: async () => undefined,
                    lastCalledByOthers: async () => null,
                    noteAccepted: () => new Promise(() => undefined),
                };
                const b = createRefusalNotes(() => 1000, { shared: hang, runsHere: () => false });
                const handed = b.accepted('j', { turn: 1 }) as Promise<boolean>;
                await vi.advanceTimersByTimeAsync(2 * SHARED_WRITE_BOUND_MS + 10);
                expect(await handed).toBe(false);
            } finally {
                vi.useRealTimers();
            }
        });

        it('notes it at once and returns nothing when the runner is here (the synchronous path), and tells the others without waiting', async () => {
            const { a, store } = rigAccept();
            a.turn('j', 5, 'run-1');
            const mark = a.mark();
            expect(a.accepted('j', { turn: 5, run: 'run-1' })).toBeUndefined();
            expect(a.acceptedSince('j', mark)).toBe(true);
            await Promise.resolve();
            expect(await store.forServer('B').lastAcceptedByOthers!('j', { turn: 5, run: 'run-1' })).not.toBeNull();
            // a call of a turn the runner here has left is not noted
            a.turn('j', 6, 'run-1');
            const next = a.mark();
            expect(a.accepted('j', { turn: 5, run: 'run-1' })).toBeUndefined();
            expect(a.acceptedSince('j', next)).toBe(false);
            // and with a store that fails, the call is not held and nothing is thrown
            store.state.down = true;
            expect(() => a.accepted('j', { turn: 6, run: 'run-1' })).not.toThrow();
        });

        it('does not skip the handoff because this server remembers an old turn of the job (a former runner): the call belongs to the runner elsewhere', async () => {
            const { b, store } = rigAccept();
            b.turn('j', 2, 'old-run');
            store.state.failAccepted = 2;
            expect(await b.accepted('j', { turn: 7, run: 'new-run' })).toBe(false);
            expect(await b.accepted('j', { turn: 7, run: 'new-run' })).toBe(true);
            // it is the call of turn 7 that the runner elsewhere reads, not a turn of this server's old history
            expect(await store.forServer('A').lastAcceptedByOthers!('j', { turn: 7, run: 'new-run' })).not.toBeNull();
        });

        it('the runner counts only an acceptance of the turn it is on: a call of turn 4 taken up (late) in turn 5 does not suppress the give-up of turn 5, a genuine turn 5 one does', async () => {
            const { a, b, store, advance } = rigAccept();
            a.turn('j', 4, 'run-1');
            advance(10_000);
            a.turn('j', 5, 'run-1');
            const since = a.mark();
            advance(10);
            // the call of turn 4 is taken up by the pool after turn 5 began
            expect(await b.accepted('j', { turn: 4, run: 'run-1' })).toBe(true);
            expect(await a.acceptedAnywhereSince('j', since)).toBe(false);
            // a call of turn 5 is taken up on the other server
            expect(await b.accepted('j', { turn: 5, run: 'run-1' })).toBe(true);
            expect(await a.acceptedAnywhereSince('j', since)).toBe(true);
            // and one whose turn the relay could not tell counts (the give-up would cancel a call in flight otherwise)
            const { a: a2, b: b2, advance: advance2 } = rigAccept();
            a2.turn('k', 5, 'run-1');
            const since2 = a2.mark();
            advance2(10);
            expect(await b2.accepted('k')).toBe(true);
            expect(await a2.acceptedAnywhereSince('k', since2)).toBe(true);
            // a store that cannot be read: nothing is concluded
            store.state.down = true;
            expect(await a.acceptedAnywhereSince('j', a.mark())).toBe(true);
        });
    });

    describe('the turn of a call that reaches a server other than the one that runs the job’s runner (two notes over one shared store)', () => {
        const fault = (callId: string) => ({ callId, kind: 'fault' as const, reason: 'provider_key_ours' as const, source: 'universe-ai' as const, route: 'r', providerStatus: 401 as number | null });
        const rigTurns = () => {
            let at = 100_000;
            const store = sharedStore();
            const sentByB: CallRow[] = [];
            // A runs the job's runner; B is where the machine's calls land
            const a = createRefusalNotes(() => at, { shared: store.forServer('A'), runsHere: () => true });
            const b = createRefusalNotes(() => at, {
                shared: store.forServer('B'),
                runsHere: () => false,
                retryMs: [0],
                sink: async (_bot, _job, rows) => {
                    sentByB.push(...rows.map((row) => ({ ...row })));
                    return true;
                },
            });
            return { a, b, store, sentByB, advance: (ms: number) => (at += ms), now: () => at };
        };
        /** The runner's promise is renewed while it works the job (every few seconds): the turn said again publishes the list again. */
        const renew = (a: ReturnType<typeof createRefusalNotes>, turn: number, run: string) => a.turn('j', turn, run);
        // What the relay does with a call: where it arrived, who is asked for the turn, then the row at its end
        const callOnB = async (b: ReturnType<typeof createRefusalNotes>, id: string, then?: () => void) => {
            const arrived = b.mark();
            const began = await b.turnOfCall('j', arrived);
            then?.();
            b.record('bot', 'j', { ...fault(id), turn: began.turn, ...(began.run ? { run: began.run } : {}) });
            await b.flush('j');
            return began;
        };

        it('gives the call the turn the runner on the other server had reached when the call arrived, with its run, so Orbit finds the row for that turn', async () => {
            const { a, b, sentByB, advance } = rigTurns();
            a.turn('j', 1, 'run-1');
            advance(10_000);
            a.turn('j', 2, 'run-1');
            advance(1500);
            renew(a, 2, 'run-1');
            await Promise.resolve();
            advance(1500);
            const began = await callOnB(b, 'c1');
            expect(began).toEqual({ turn: 2, run: 'run-1' });
            expect(sentByB.map((row) => [row.callId, row.turn, row.run])).toEqual([['c1', 2, 'run-1']]);
        });

        it('keeps a call that arrived in turn 2 in turn 2 when the runner has moved on to turn 3 by the time the call ends, and a call that arrives after turn 3 began is turn 3', async () => {
            const { a, b, sentByB, advance } = rigTurns();
            a.turn('j', 2, 'run-1');
            advance(3000);
            renew(a, 2, 'run-1');
            const late = await callOnB(b, 'early', () => {
                advance(3000);
                a.turn('j', 3, 'run-1');
            });
            expect(late.turn).toBe(2);
            advance(3000);
            const next = await callOnB(b, 'later');
            expect(next.turn).toBe(3);
            expect(sentByB.map((row) => [row.callId, row.turn])).toEqual([['early', 2], ['later', 3]]);
        });

        it('names the run of the turn: a runner that restarted (turns from 1 again, a new run) is not mixed up with the old one', async () => {
            const { a, b, advance } = rigTurns();
            a.turn('j', 1, 'run-old');
            a.turn('j', 2, 'run-old');
            advance(50_000);
            a.turn('j', 1, 'run-new');
            advance(3000);
            expect(await b.turnOfCall('j', b.mark())).toEqual({ turn: 1, run: 'run-new' });
        });

        it('says the same turn again (a reconnect to it) without making a second turn of it: the moment it began stays', async () => {
            const { a, store, advance } = rigTurns();
            a.turn('j', 3, 'run-1');
            advance(5000);
            a.turn('j', 3, 'run-1');
            await Promise.resolve();
            const lists = await store.forServer('B').turnsByOthers!('j');
            expect(lists).toHaveLength(1);
            expect(lists[0].turns).toEqual([{ turn: 3, run: 'run-1', at: 100_000 }]);
            // the promise was made again, from the later moment
            expect(lists[0].until).toBe(105_000 + SHARED_TURN_LEASE_MS);
        });

        it('sends a row with no turn (and no run) when nothing was said about the job, and when the shared store cannot be read: never a turn that is only a guess', async () => {
            const { a, b, store, sentByB, advance } = rigTurns();
            // the runner has said nothing yet
            expect((await callOnB(b, 'unknown-1')).turn).toBeNull();
            a.turn('j', 4, 'run-1');
            advance(1000);
            store.state.down = true;
            expect(await callOnB(b, 'unknown-2')).toEqual({ turn: null });
            store.state.down = false;
            expect(sentByB.map((row) => [row.callId, row.turn, 'run' in row])).toEqual([['unknown-1', null, false], ['unknown-2', null, false]]);
            // the call arrived before the runner's first turn began: it is no call of that turn either
            const before = b.mark();
            advance(1000);
            a.turn('j', 5, 'run-1');
            advance(3000);
            renew(a, 5, 'run-1');
            expect((await b.turnOfCall('j', before)).turn).toBeNull();
            const never = createRefusalNotes(() => 1, { shared: store.forServer('C'), runsHere: () => false });
            expect(await never.turnOfCall('fresh-job', { order: 1, at: 1 })).toEqual({ turn: null });
        });

        it('does not assign a turn from a list nobody promises is complete: the runner’s write of turn 5 was lost, Redis still answers with turn 4, and a call well inside turn 5 gets no turn', async () => {
            const { a, b, store, advance } = rigTurns();
            a.turn('j', 4, 'run-1');
            advance(2000);
            renew(a, 4, 'run-1');
            await Promise.resolve();
            // turn 5 begins and its write is lost (and so is every renewal after it): the store still answers, with turn 4 and a promise that has run out
            store.state.failTurns = 100;
            advance(1000);
            a.turn('j', 5, 'run-1');
            // while the promise made at the last renewal still stands, a call is covered by it (it arrived before turn 5 could have been begun without publishing: see the next test)
            advance(SHARED_TURN_LEASE_MS);
            const answer = await b.turnOfCall('j', b.mark());
            expect(answer).toEqual({ turn: null });
        });

        it('begins no turn before it is in a published list: with the write lost it waits out the promise of the lists before it, and then the old list covers nothing', async () => {
            vi.useFakeTimers();
            try {
                let clock = 100_000;
                const store = sharedStore();
                const a = createRefusalNotes(() => clock, { shared: store.forServer('A'), runsHere: () => true });
                const b = createRefusalNotes(() => clock, { shared: store.forServer('B'), runsHere: () => false });
                a.turn('j', 4, 'run-1');
                await a.turnPublished!('j');
                // the store loses every write of the turn that follows
                store.state.failTurns = 1000;
                clock += 1000;
                a.turn('j', 5, 'run-1');
                let begun = false;
                const waiting = a.turnPublished!('j').then(() => (begun = true));
                await vi.advanceTimersByTimeAsync(1500);
                // turn 4's promise (6 s from 100_000) still stands at 101_000: turn 5 is not begun yet
                expect(begun).toBe(false);
                // the promise runs out (the runner's clock moves on): then it begins
                clock += SHARED_TURN_LEASE_MS;
                await vi.advanceTimersByTimeAsync(1000);
                await waiting;
                expect(begun).toBe(true);
                // and what the old list said covers nothing by now
                expect(await b.turnOfCall('j', { order: 1, at: clock - SHARED_CALL_SKEW_MS })).toEqual({ turn: null });
            } finally {
                vi.useRealTimers();
            }
        });

        it('begins the turn at once when its write is made, with a store that works and with none', async () => {
            const { a } = rigTurns();
            a.turn('j', 1, 'run-1');
            await a.turnPublished!('j');
            a.turn('j', 2, 'run-1');
            const started = Date.now();
            await a.turnPublished!('j');
            expect(Date.now() - started).toBeLessThan(500);
            const alone = createRefusalNotes(() => 1000);
            alone.turn('j', 1);
            await alone.turnPublished?.('j');
        });

        it('cannot tell when the promise has run out (the runner stopped working the job), and when two runners both promise (a job taken over): no turn', async () => {
            const { a, b, store, advance } = rigTurns();
            a.turn('j', 1, 'run-1');
            advance(1000);
            renew(a, 1, 'run-1');
            advance(2000);
            // a call well inside the promise (4 s from the last renewal, minus the clock skew)
            expect((await b.turnOfCall('j', b.mark())).turn).toBe(1);
            // no renewal for longer than the promise: the runner is gone
            advance(SHARED_TURN_LEASE_MS);
            expect(await b.turnOfCall('j', b.mark())).toEqual({ turn: null });
            // another server's runner takes the job over while the first one's promise still stands
            const c = createRefusalNotes(() => 100_000 + 1000 + 2000 + SHARED_TURN_LEASE_MS, { shared: store.forServer('C'), runsHere: () => true });
            c.turn('j', 1, 'run-2');
            advance(0);
            a.turn('j', 2, 'run-1');
            await Promise.resolve();
            expect((await b.turnOfCall('j', b.mark())).turn).toBeNull();
        });

        it('cannot tell the turn of a call that arrived within the clock skew of any turn’s beginning (the servers’ clocks differ by 1.5 s, either way): turn null and no run, while a call well inside a turn keeps it', async () => {
            let runnerClock = 100_000;
            const store = sharedStore();
            const a = createRefusalNotes(() => runnerClock, { shared: store.forServer('A'), runsHere: () => true });
            // two relay servers: one whose clock runs 1.5 s ahead of the runner server's, one 1.5 s behind
            const ahead = createRefusalNotes(() => runnerClock + 1500, { shared: store.forServer('B'), runsHere: () => false });
            const behind = createRefusalNotes(() => runnerClock - 1500, { shared: store.forServer('C'), runsHere: () => false });
            a.turn('j', 1, 'run-1');
            runnerClock += 30_000;
            a.turn('j', 2, 'run-1');
            await Promise.resolve();
            const turn2 = runnerClock;
            // a call that really arrived 1 s BEFORE turn 2 began, seen by the relay server that runs ahead, is stamped 0.5 s after it: it belongs to turn 1
            expect(await ahead.turnOfCall('j', { order: 1, at: turn2 - 1000 + 1500 })).toEqual({ turn: null });
            // a call that really arrived 1 s AFTER turn 2 began, seen by the server that runs behind, is stamped 0.5 s before it: it belongs to turn 2
            expect(await behind.turnOfCall('j', { order: 1, at: turn2 + 1000 - 1500 })).toEqual({ turn: null });
            // a call within the promise, well inside a turn (more than the skew from every beginning): its turn, with its run
            expect(await ahead.turnOfCall('j', { order: 1, at: turn2 + 3000 + 1500 - 1000 })).toEqual({ turn: 2, run: 'run-1' });
            // exactly at the skew from a beginning still cannot be told; just past it can
            expect((await ahead.turnOfCall('j', { order: 1, at: turn2 + SHARED_CALL_SKEW_MS })).turn).toBeNull();
            expect((await ahead.turnOfCall('j', { order: 1, at: turn2 + SHARED_CALL_SKEW_MS + 1 })).turn).toBe(2);
            // the first turn's beginning counts too (the promise has been renewed by the second turn's list, which holds both)
            expect(await ahead.turnOfCall('j', { order: 1, at: turn2 - 30_000 + 1000 })).toEqual({ turn: null });
        });

        it('does not hold the call for a store that does not answer: unknown turn after the bound', async () => {
            vi.useFakeTimers();
            try {
                const hang: SharedCalls = {
                    noteCalled: async () => undefined,
                    noteUnrecorded: async () => undefined,
                    lastCalledByOthers: async () => null,
                    turnsByOthers: () => new Promise(() => undefined),
                };
                const b = createRefusalNotes(() => 1000, { shared: hang, runsHere: () => false });
                const pending = b.turnOfCall('j', { order: 1, at: 1000 });
                await vi.advanceTimersByTimeAsync(SHARED_WRITE_BOUND_MS + 1);
                expect(await pending).toEqual({ turn: null });
            } finally {
                vi.useRealTimers();
            }
        });

        it('takes the turn from this server’s own notes when the runner is here, and when there is no shared store, and never from the shared record then', async () => {
            const store = sharedStore();
            const here = createRefusalNotes(() => 2000, { shared: store.forServer('A'), runsHere: () => true });
            here.turn('j', 7, 'run-1');
            const arrived = here.mark();
            // another server's runner said something else: the runner is here, its own history is the one to use
            await store.forServer('Z').noteTurn!('j', [{ turn: 99, run: 'run-z', at: 1 }], 10_000_000);
            expect(await here.turnOfCall('j', { order: arrived.order, at: arrived.at })).toEqual({ turn: 7, run: 'run-1' });
            const alone = createRefusalNotes(() => 2000);
            alone.turn('j', 3);
            expect(await alone.turnOfCall('j', alone.mark())).toEqual({ turn: 3 });
            expect(await alone.turnOfCall('other-job')).toEqual({ turn: 0 });
        });

        it('says its own turns to the others only (the latest few, with a promise), never reads its own back, and a failing store never holds the runner', async () => {
            const { a, b, store, now } = rigTurns();
            for (let n = 1; n <= 9; n++) a.turn('j', n, 'run-1');
            await Promise.resolve();
            const said = await store.forServer('B').turnsByOthers!('j');
            expect(said).toHaveLength(1);
            expect(said[0].turns.map((one) => one.turn)).toEqual([4, 5, 6, 7, 8, 9]);
            expect(said[0].until).toBe(now() + SHARED_TURN_LEASE_MS);
            expect(await store.forServer('A').turnsByOthers!('j')).toEqual([]);
            store.state.down = true;
            expect(() => a.turn('j', 10, 'run-1')).not.toThrow();
            await Promise.resolve();
            expect(b.turnOf('j')).toBe(0);
        });

        it('renews its promise while the runner works the job, and stops when it does not', async () => {
            vi.useFakeTimers();
            try {
                const store = sharedStore();
                let here = true;
                const a = createRefusalNotes(() => Date.now(), { shared: store.forServer('A'), runsHere: () => here });
                a.turn('j', 1, 'run-1');
                await vi.advanceTimersByTimeAsync(0);
                const first = (await store.forServer('B').turnsByOthers!('j'))[0].until;
                await vi.advanceTimersByTimeAsync(SHARED_TURN_RENEW_MS + 10);
                const second = (await store.forServer('B').turnsByOthers!('j'))[0].until;
                expect(second).toBeGreaterThanOrEqual(first + SHARED_TURN_RENEW_MS);
                await vi.advanceTimersByTimeAsync(SHARED_TURN_RENEW_MS);
                const third = (await store.forServer('B').turnsByOthers!('j'))[0].until;
                expect(third).toBeGreaterThan(second);
                // the runner stops working the job: no more renewals
                here = false;
                await vi.advanceTimersByTimeAsync(SHARED_TURN_RENEW_MS + 10);
                const stopped = (await store.forServer('B').turnsByOthers!('j'))[0].until;
                await vi.advanceTimersByTimeAsync(SHARED_TURN_RENEW_MS * 5);
                expect((await store.forServer('B').turnsByOthers!('j'))[0].until).toBe(stopped);
            } finally {
                vi.useRealTimers();
            }
        });

        it('never ends a turn the runner is on as a fault of its own for a call made on the other server: a null-turn row leaves the runner’s own notes of the turn alone', async () => {
            const { a, b, advance } = rigTurns();
            a.turn('j', 1, 'run-1');
            const mark = a.mark();
            advance(10);
            b.record('bot', 'j', { ...fault('x'), turn: null });
            expect(a.endedOnFault('j', mark)).toBe(false);
            // and B's own bookkeeping of a null-turn call is not a stale call that is dropped: the row was kept and sent
            expect(await b.flush('j')).toBe(true);
        });
    });

    describe('in Redis', () => {
        const redis = () => {
            const hashes = new Map<string, Record<string, string>>();
            const ttl = new Map<string, number>();
            const client = {
                hSet: async (key: string, field: string, value: string) => void (hashes.set(key, { ...(hashes.get(key) ?? {}), [field]: value })),
                expire: async (key: string, seconds: number) => void ttl.set(key, seconds),
                hGetAll: async (key: string) => ({ ...(hashes.get(key) ?? {}) }),
                // the one script the shared calls run: keep the later moment, and give the hash its life
                eval: async (script: string, options: { keys: string[]; arguments: string[] }) => {
                    if (script === SET_AND_RENEW) {
                        const [field, value, seconds] = options.arguments;
                        hashes.set(options.keys[0], { ...(hashes.get(options.keys[0]) ?? {}), [field]: value });
                        ttl.set(options.keys[0], Number(seconds));
                        return 1;
                    }
                    if (script !== KEEP_LATER) throw new Error('an unknown script');
                    const [field, moment, seconds] = options.arguments;
                    const current = Number(hashes.get(options.keys[0])?.[field]);
                    if (Number.isNaN(current) || current < Number(moment)) hashes.set(options.keys[0], { ...(hashes.get(options.keys[0]) ?? {}), [field]: moment });
                    ttl.set(options.keys[0], Number(seconds));
                    return 1;
                },
            } as unknown as EvidenceRedis;
            return { client, hashes, ttl };
        };

        it('keeps one latest moment per server for an hour, and reads the other servers’ only', async () => {
            const r = redis();
            const a = new RedisSharedCalls(() => r.client, 'A');
            const b = new RedisSharedCalls(() => r.client, 'B');
            await a.noteCalled('j', 5000);
            expect(await a.lastCalledByOthers('j')).toBeNull();
            expect(await b.lastCalledByOthers('j')).toBe(5000);
            await a.noteCalled('j', 7000);
            await b.noteCalled('j', 6000);
            expect(await a.lastCalledByOthers('j')).toBe(6000);
            expect(await b.lastCalledByOthers('j')).toBe(7000);
            expect(await b.lastCalledByOthers('other')).toBeNull();
            expect(r.ttl.get('computer:called:j')).toBe(3600);
            expect(Object.keys(r.hashes.get('computer:called:j') ?? {}).sort()).toEqual(['A', 'B']);
        });

        it('keeps the later of two moments: the same moment twice, or a late write, never takes a later one back', async () => {
            const r = redis();
            const a = new RedisSharedCalls(() => r.client, 'A');
            const b = new RedisSharedCalls(() => r.client, 'B');
            await a.noteCalled('j', 9000);
            await a.noteCalled('j', 9000);
            await a.noteCalled('j', 8000);
            expect(await b.lastCalledByOthers('j')).toBe(9000);
        });

        it('says apart that a call could not be recorded, and the others read it like a call, never their own', async () => {
            const r = redis();
            const a = new RedisSharedCalls(() => r.client, 'A');
            const b = new RedisSharedCalls(() => r.client, 'B');
            await a.noteUnrecorded('j', 12_000);
            expect(Object.keys(r.hashes.get('computer:called:j') ?? {})).toEqual(['unsure:A']);
            expect(await b.lastCalledByOthers('j')).toBe(12_000);
            expect(await a.lastCalledByOthers('j')).toBeNull();
            expect(r.ttl.get('computer:called:j')).toBe(3600);
        });

        it('says apart that a call was taken up: the others read it as such, and it is never read as a call that arrived', async () => {
            const r = redis();
            const a = new RedisSharedCalls(() => r.client, 'A');
            const b = new RedisSharedCalls(() => r.client, 'B');
            await a.noteAccepted('j', 20_000);
            expect(Object.keys(r.hashes.get('computer:called:j') ?? {})).toEqual(['accepted:A']);
            expect(await b.lastAcceptedByOthers('j')).toBe(20_000);
            expect(await a.lastAcceptedByOthers('j')).toBeNull();
            // not an arrival: a turn's "no call reached the relay" is not undone by it
            expect(await b.lastCalledByOthers('j')).toBeNull();
            // and an arrival is not an acceptance
            await b.noteCalled('j', 30_000);
            expect(await a.lastAcceptedByOthers('j')).toBeNull();
            expect(r.ttl.get('computer:called:j')).toBe(3600);
        });

        it('keeps the turns of a runner, with its promise, in its own field for an hour, the others read them (never their own), and they are never read as a call or as an acceptance', async () => {
            const r = redis();
            const a = new RedisSharedCalls(() => r.client, 'A');
            const b = new RedisSharedCalls(() => r.client, 'B');
            await a.noteTurn('j', [{ turn: 1, run: 'run-1', at: 5000 }, { turn: 2, run: 'run-1', at: 6000 }], 12_000);
            await a.noteTurn('j', [{ turn: 2, run: 'run-1', at: 6000 }, { turn: 3, at: 7000 }], 13_000);
            expect(Object.keys(r.hashes.get('computer:called:j') ?? {})).toEqual(['turn:A']);
            expect(r.ttl.get('computer:called:j')).toBe(3600);
            // the later list replaces the earlier one; a turn without a run reads without one
            expect(await b.turnsByOthers('j')).toEqual([{ turns: [{ turn: 2, run: 'run-1', at: 6000 }, { turn: 3, at: 7000 }], until: 13_000 }]);
            expect(await a.turnsByOthers('j')).toEqual([]);
            expect(await b.turnsByOthers('other')).toEqual([]);
            // not an arrival, not an acceptance
            expect(await b.lastCalledByOthers('j')).toBeNull();
            expect(await b.lastAcceptedByOthers('j')).toBeNull();
            // and it does not take an arrival's place when there is one
            await a.noteCalled('j', 9000);
            expect(await b.lastCalledByOthers('j')).toBe(9000);
        });

        it('skips damaged turns and fields (and a list with no promise, as an older server wrote it), and rejects when the store cannot be read or written', async () => {
            const r = redis();
            r.hashes.set('computer:called:j', {
                'turn:X': 'not json',
                'turn:Y': '{"turn":1}',
                'turn:old': JSON.stringify([{ turn: 5, at: 1 }]),
                'turn:nopromise': JSON.stringify({ turns: [{ turn: 5, at: 1 }] }),
                'turn:Z': JSON.stringify({ until: 9000, turns: [{ turn: -1, at: 1 }, { turn: 1.5, at: 1 }, { turn: 2, at: 'x' }, null, 'x', { turn: 3, run: '', at: 3000 }, { turn: 4, run: 'r', at: 4000 }] }),
            });
            expect(await new RedisSharedCalls(() => r.client, 'A').turnsByOthers('j')).toEqual([{ turns: [{ turn: 3, at: 3000 }, { turn: 4, run: 'r', at: 4000 }], until: 9000 }]);
            await expect(new RedisSharedCalls(() => null, 'A').turnsByOthers('j')).rejects.toThrow();
            await expect(new RedisSharedCalls(() => null, 'A').noteTurn('j', [], 1)).rejects.toThrow();
            const silent = { hGetAll: () => new Promise(() => undefined), eval: () => new Promise(() => undefined) } as unknown as EvidenceRedis;
            await expect(new RedisSharedCalls(() => silent, 'A', 20).turnsByOthers('j')).rejects.toThrow(/in time/);
            await expect(new RedisSharedCalls(() => silent, 'A', 20).noteTurn('j', [], 1)).rejects.toThrow(/in time/);
        });

        it('keeps one acceptance per server and turn (and run): a call of turn 4 taken up after one of turn 5 never takes its place, and the reader counts only the turn it asks for', async () => {
            const r = redis();
            const a = new RedisSharedCalls(() => r.client, 'A');
            const b = new RedisSharedCalls(() => r.client, 'B');
            await a.noteAccepted('j', 20_000, { turn: 5, run: 'run-1' });
            // the call of turn 4 is taken up LATER than the one of turn 5
            await a.noteAccepted('j', 21_000, { turn: 4, run: 'run-1' });
            expect(Object.keys(r.hashes.get('computer:called:j') ?? {}).sort()).toEqual(['accepted:A|4|run-1', 'accepted:A|5|run-1']);
            expect(await b.lastAcceptedByOthers('j', { turn: 5, run: 'run-1' })).toBe(20_000);
            expect(await b.lastAcceptedByOthers('j', { turn: 4, run: 'run-1' })).toBe(21_000);
            // another turn, and another run of the same turn number: none
            expect(await b.lastAcceptedByOthers('j', { turn: 6, run: 'run-1' })).toBeNull();
            expect(await b.lastAcceptedByOthers('j', { turn: 5, run: 'run-2' })).toBeNull();
            expect(await b.lastAcceptedByOthers('j', { turn: 5 })).toBeNull();
            // asked for no turn in particular: the latest of all
            expect(await b.lastAcceptedByOthers('j')).toBe(21_000);
            // its own are never read back
            expect(await a.lastAcceptedByOthers('j', { turn: 5, run: 'run-1' })).toBeNull();
            // a call whose turn was not known counts for every turn (never read as none: the runner would give up on a turn with a call in flight)
            await b.noteAccepted('j', 30_000);
            expect(Object.keys(r.hashes.get('computer:called:j') ?? {})).toContain('accepted:B');
            expect(await a.lastAcceptedByOthers('j', { turn: 9, run: 'run-9' })).toBe(30_000);
            // a run with no name is its own
            await b.noteAccepted('j', 31_000, { turn: 2 });
            expect(await a.lastAcceptedByOthers('j', { turn: 2 })).toBe(31_000);
            expect(await a.lastAcceptedByOthers('j', { turn: 2, run: 'run-1' })).toBe(30_000);
        });

        it('ignores a damaged field, and rejects when the store is not connected or does not answer', async () => {
            const r = redis();
            r.hashes.set('computer:called:j', { X: 'not a number', Y: '4000' });
            expect(await new RedisSharedCalls(() => r.client, 'A').lastCalledByOthers('j')).toBe(4000);
            await expect(new RedisSharedCalls(() => null, 'A').lastCalledByOthers('j')).rejects.toThrow();
            await expect(new RedisSharedCalls(() => null, 'A').noteCalled('j', 1)).rejects.toThrow();
            const silent = { hGetAll: () => new Promise(() => undefined), eval: () => new Promise(() => undefined) } as unknown as EvidenceRedis;
            await expect(new RedisSharedCalls(() => silent, 'A', 20).lastCalledByOthers('j')).rejects.toThrow(/in time/);
            await expect(new RedisSharedCalls(() => silent, 'A', 20).noteCalled('j', 1)).rejects.toThrow(/in time/);
        });
    });
});

describe('whether a turn had a confirmed fault that was not recovered', () => {
    const confirmed = (notes: ReturnType<typeof createRefusalNotes>, job: string, id: string) =>
        notes.record('b', job, { callId: id, kind: 'fault', reason: 'provider_key_ours', source: 'universe-ai', route: 'r', providerStatus: 401 });
    const answered = (notes: ReturnType<typeof createRefusalNotes>, job: string) => notes.record('b', job, { callId: 'ok', kind: 'answered', reason: 'provider_5xx', source: 'universe-ai', route: 'r', providerStatus: 200 });

    it('is true for a confirmed fault in the window, and false when a call was answered after it in the same window', () => {
        const notes = createRefusalNotes(() => 1000);
        const before = notes.mark();
        expect(notes.confirmedSince('a', before)).toBe(false);
        confirmed(notes, 'a', 'c1');
        expect(notes.confirmedSince('a', before)).toBe(true);
        // the agent got round it: a call was answered after the fault
        answered(notes, 'a');
        expect(notes.confirmedSince('a', before)).toBe(false);
        // a later confirmed fault counts again, whatever came before it
        confirmed(notes, 'a', 'c2');
        expect(notes.confirmedSince('a', before)).toBe(true);
        // an answer BEFORE the fault is no recovery
        confirmed(notes, 'b', 'c1');
        const second = notes.mark();
        answered(notes, 'b');
        confirmed(notes, 'b', 'c2');
        expect(notes.confirmedSince('b', second)).toBe(true);
        // an unresolved fault after the answer changes nothing about the confirmed one that was recovered
        confirmed(notes, 'c', 'c1');
        answered(notes, 'c');
        notes.record('b', 'c', { callId: 'u', kind: 'uncertain', reason: 'provider_5xx', source: 'universe-ai', route: 'r', providerStatus: 500 });
        expect(notes.confirmedSince('c', before)).toBe(false);
        // a window that began after it does not hold it
        expect(notes.confirmedSince('a', notes.mark())).toBe(false);
    });

    it('agrees with endedOnFault: a confirmed fault that was recovered is neither a turn that ended on a fault nor a confirmed one', () => {
        const notes = createRefusalNotes(() => 1000);
        const before = notes.mark();
        confirmed(notes, 'a', 'c1');
        expect(notes.endedOnFault('a', before)).toBe(true);
        expect(notes.confirmedSince('a', before)).toBe(true);
        answered(notes, 'a');
        expect(notes.endedOnFault('a', before)).toBe(false);
        expect(notes.confirmedSince('a', before)).toBe(false);
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

describe('Orbit saying it has no such job', () => {
    const call = (callId: string) => ({ callId, kind: 'fault' as const, reason: 'relay_down' as const, source: 'universe-ai' as const, route: 'r', providerStatus: 503 as number | null });

    it('clears the rows of that job but is no proof that Orbit takes evidence: a row refused alone afterwards is not set aside as the row’s own fault', async () => {
        const answers: Record<string, boolean | 'rejected' | 'missing'> = { gone: 'missing', other: 'rejected' };
        const sent: string[] = [];
        const told: string[] = [];
        const notes = createRefusalNotes(() => 1000, {
            retryMs: [0],
            laterMs: [],
            sink: async (_bot, jobId, rows) => {
                sent.push(`${jobId}:${rows.map((row) => row.callId).join()}`);
                return answers[jobId] ?? false;
            },
            report: (what, info) => told.push(`${what} ${info.jobId}`),
        });
        notes.record('bot', 'gone', call('g1'));
        expect(await notes.flush('gone')).toBe(true);
        // the rows are gone: nothing is sent for that job again
        expect(await notes.flush('gone')).toBe(true);
        expect(sent).toEqual(['gone:g1']);
        // Orbit has taken NO row so far (it only said the job is not there): a row it refuses alone is a contract that may not fit, kept and sent again
        notes.record('bot', 'other', call('o1'));
        expect(await notes.flush('other')).toBe(false);
        expect(told).toEqual(['all_refused other']);
    });
});

describe('what the operators are told about calls that could not be recorded', () => {
    it('says every kind in words, and does not claim that a refused call went ahead', () => {
        expect(Object.keys(FAULT_EVIDENCE_MESSAGES).sort()).toEqual(['all_refused', 'called_unrecorded', 'dead_letter', 'not_durable', 'unacked']);
        // with the runner elsewhere the relay answers 503 and forwards nothing: the alert must not say the call went ahead as a fact
        expect(FAULT_EVIDENCE_MESSAGES.called_unrecorded).toMatch(/refused/);
        expect(FAULT_EVIDENCE_MESSAGES.called_unrecorded).toMatch(/or have gone ahead/);
        expect(FAULT_EVIDENCE_MESSAGES.called_unrecorded).not.toMatch(/\(it went ahead\)/);
    });
});
