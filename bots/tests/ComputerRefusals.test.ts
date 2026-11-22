import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CLOSE_TURN, FENCE_LIFE_MS, KEEP_LATER, NOTE_ACCEPTED_UNLESS_CLOSED, RETRACT_FENCE, RedisSharedCalls, SET_AND_RENEW, type EvidenceRedis } from '../server/ComputerEvidenceStore';
import { createRefusalNotes, DEAD_LETTER_AGED_MS, DEAD_LETTER_KEEP_MS, EVIDENCE_AGED_EVERY_MS, EVIDENCE_AGED_MS, startAgedEvidence, EVIDENCE_KEEP_MS, FAULT_EVIDENCE_MESSAGES, EVIDENCE_UNACKED_MS, FAULT_ROWS_PER_CALL, REFUSAL_NOTE_KEEP_MS, ORBIT_TAKING_ROWS_MS, SHARED_WRITE_BOUND_MS, SHARED_CALL_SKEW_MS, SHARED_TURN_LEASE_MS, SHARED_TURN_RENEW_MS, type CallRow, type FaultReportKind, type SinkAnswer, type EvidenceStore, type SharedCalls, type SharedTurn, type SharedTurnList, type CallTurn, type CloseAttempt } from '../server/ComputerRefusals';

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
    const ledger = (store: EvidenceStore, sinkAnswers: () => boolean, extra: { storeLaterMs?: number; report?: (what: FaultReportKind, info: { jobId: string; callId: string }) => void } = {}) => {
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

    describe('the arrival of a call at the relay (GPT round 3, finding 5): one neutral row per job, run and turn, to Orbit only', () => {
        it('queues ONE row for the first call of a turn and none for the next calls of it, a new row for the next turn or run, and names an unknown turn with a bare id', async () => {
            const { notes, sent } = ledger(memoryStore().store, () => true);
            notes.arrived('b', 'j', { turn: 3, run: 'run-a' });
            notes.arrived('b', 'j', { turn: 3, run: 'run-a' });
            notes.arrived('b', 'j', { turn: 4, run: 'run-a' });
            notes.arrived('b', 'j', { turn: 3, run: 'run-b' });
            notes.arrived('b', 'j', { turn: null, run: 'run-a' });
            notes.arrived('b', 'j', { turn: null, run: 'run-a' });
            notes.arrived('b', 'j', { turn: 0 });
            notes.arrived('b', 'other-job', { turn: 3, run: 'run-a' });
            await notes.flush('j');
            await notes.flush('other-job');
            const rows = sent.filter((one) => one.jobId === 'j').flatMap((one) => one.rows);
            expect(rows.map((row) => row.callId).sort()).toEqual(['arrival_run-a_', 'arrival_run-a_3', 'arrival_run-a_4', 'arrival_run-b_3', 'arrival__0'].sort());
            expect(sent.filter((one) => one.jobId === 'other-job').flatMap((one) => one.rows.map((row) => row.callId))).toEqual(['arrival_run-a_3']);
            expect(rows.find((row) => row.callId === 'arrival_run-a_3')).toEqual({ turn: 3, run: 'run-a', callId: 'arrival_run-a_3', kind: 'answered', reason: 'relay_reached', source: 'universe-ai', route: null, providerStatus: null, at: expect.any(String) });
            expect(rows.find((row) => row.callId === 'arrival_run-a_')).toMatchObject({ turn: null, run: 'run-a' });
            // no run known: the key is left out, not sent empty
            expect(rows.find((row) => row.callId === 'arrival__0')).not.toHaveProperty('run');
        });

        it('changes nothing the runner reads: no answer clears a fault, no fault, no refusal, no call noted, no acceptance', async () => {
            const { notes } = ledger(memoryStore().store, () => true);
            notes.turn('j', 2, 'run-a');
            const since = notes.mark();
            notes.record('b', 'j', call('c-fault', { turn: 2, run: 'run-a' }));
            expect(notes.endedOnFault('j', since)).toBe(true);
            expect(notes.confirmedSince('j', since)).toBe(true);
            notes.arrived('b', 'j', { turn: 2, run: 'run-a' });
            notes.arrived('b', 'j', { turn: null, run: 'run-a' });
            // an answer would have cleared the fault: an arrival is not one
            expect(notes.endedOnFault('j', since)).toBe(true);
            expect(notes.confirmedSince('j', since)).toBe(true);
            // and on a job that had nothing: an arrival makes none of these
            const fresh = notes.mark();
            notes.arrived('b', 'quiet', { turn: 1, run: 'run-a' });
            expect(notes.endedOnFault('quiet', fresh)).toBe(false);
            expect(notes.confirmedSince('quiet', fresh)).toBe(false);
            expect(notes.sawSince('quiet', fresh)).toBe(false);
            expect(notes.calledSince('quiet', fresh)).toBe(false);
            expect(notes.acceptedSince('quiet', fresh)).toBe(false);
            expect(notes.onlyPoolBusySince('quiet', fresh)).toBe(false);
            expect(await notes.calledAnywhereSince('quiet', fresh)).toBe(false);
        });

        it('is kept where a restart does not lose it and delivered when Orbit is back, once; the same row after a restart is the same row (the id is the turn)', async () => {
            const mem = memoryStore();
            const first = ledger(mem.store, () => false);
            first.notes.arrived('bot-9', 'j', { turn: 2, run: 'run-z' });
            first.notes.arrived('bot-9', 'j', { turn: 2, run: 'run-z' });
            await vi.waitFor(() => expect(mem.held.size).toBe(1));
            expect(mem.held.get('j|arrival_run-z_2')?.row).toMatchObject({ kind: 'answered', reason: 'relay_reached', route: null, providerStatus: null, turn: 2, run: 'run-z' });
            // the process is gone, a new one starts, Orbit is up
            const second = ledger(mem.store, () => true);
            expect(await second.notes.resume()).toBe(true);
            await vi.waitFor(() => expect(second.sent.flatMap((one) => one.rows.map((row) => row.callId))).toEqual(['arrival_run-z_2']));
            await vi.waitFor(() => expect(mem.held.size).toBe(0));
            // and an arrival of that turn that this new process sees queues the one row again under the same id (Orbit keeps one row per job and call id)
            second.notes.arrived('bot-9', 'j', { turn: 2, run: 'run-z' });
            await second.notes.flush('j');
            expect(second.sent.flatMap((one) => one.rows.map((row) => row.callId))).toEqual(['arrival_run-z_2', 'arrival_run-z_2']);
        });

        it('is no row at all with neither Orbit nor a store to give it to, and never throws', () => {
            const none = createRefusalNotes(() => 1000);
            expect(() => none.arrived('b', 'j', { turn: 1, run: 'r' })).not.toThrow();
            const broken = createRefusalNotes(() => 1000, { sink: async () => { throw new Error('down'); }, retryMs: [] });
            expect(() => broken.arrived('b', 'j', { turn: 1, run: 'r' })).not.toThrow();
        });

        it('is forgotten with the job after its keep: a later arrival of a turn it remembers no more queues the row again', async () => {
            let at = 1000;
            const sent: string[] = [];
            const notes = createRefusalNotes(() => at, { retryMs: [0], laterMs: [], sink: async (_b, _j, rows) => (sent.push(...rows.map((row) => row.callId)), true) });
            notes.arrived('b', 'j', { turn: 1, run: 'r' });
            await notes.flush('j');
            at += REFUSAL_NOTE_KEEP_MS + 10;
            notes.arrived('b', 'j', { turn: 1, run: 'r' });
            await notes.flush('j');
            expect(sent).toEqual(['arrival_r_1', 'arrival_r_1']);
        });
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

    describe('rows close to the end of the time they are kept are told to the operators (Opus ruling on GPT round 3, R3): 6 days of 7 pending, 29 days of 30 dead', () => {
        const aged = () => {
            const told: Array<[FaultReportKind, string, string]> = [];
            return { told, report: (what: FaultReportKind, info: { jobId: string; callId: string }) => void (what === 'pending_aging' || what === 'dead_aging' ? told.push([what, info.jobId, info.callId]) : undefined) };
        };
        const deadRow = (callId: string, at: number): CallRow => ({ ...call(callId), at: new Date(at).toISOString() }) as CallRow;

        it('tells once of a row Orbit still has not taken after 6 days, by the time of the row itself, with the job and the call', async () => {
            expect(EVIDENCE_AGED_MS).toBe(6 * 24 * 60 * 60 * 1000);
            expect(EVIDENCE_KEEP_MS - EVIDENCE_AGED_MS).toBe(24 * 60 * 60 * 1000);
            const mem = memoryStore();
            const one = aged();
            const { notes, sent, advance } = ledger(mem.store, () => false, { report: one.report });
            notes.record('b', 'j', call('c1'));
            await notes.flush('j');
            advance(EVIDENCE_AGED_MS - 1);
            expect(await notes.tellAged()).toBe(true);
            expect(one.told).toEqual([]);
            advance(1);
            expect(await notes.tellAged()).toBe(true);
            expect(one.told).toEqual([['pending_aging', 'j', 'c1']]);
            // not again for that row, however often it is looked at
            advance(60 * 60 * 1000);
            await notes.tellAged();
            await notes.tellAged();
            expect(one.told).toHaveLength(1);
            // nothing is changed: the row is still kept, still waiting, and goes to Orbit when it is back
            expect(mem.held.has('j|c1')).toBe(true);
            expect(sent).toEqual([]);
        });

        it('does not tell of a row that is young, one that Orbit has taken, or a row that has just been made', async () => {
            const mem = memoryStore();
            const one = aged();
            let up = false;
            const { notes, advance } = ledger(mem.store, () => up, { report: one.report });
            notes.record('b', 'j', call('c1'));
            await notes.flush('j');
            advance(EVIDENCE_AGED_MS - 5000);
            up = true;
            await notes.flush('j');
            notes.record('b', 'j', call('c2'));
            advance(10_000);
            await notes.tellAged();
            expect(one.told).toEqual([]);
        });

        it('tells of a row only the store holds (the rows of another server, or of a process that has stopped), and that server is not told of what it could read in memory twice', async () => {
            const mem = memoryStore();
            const first = ledger(mem.store, () => false);
            first.notes.record('b', 'j', call('c1'));
            await vi.waitFor(() => expect(mem.held.size).toBe(1));
            const one = aged();
            const other = ledger(mem.store, () => false, { report: one.report });
            other.advance(EVIDENCE_AGED_MS);
            expect(await other.notes.tellAged()).toBe(true);
            // it never resumed: the row is not in its memory, and it was told from the store, once
            expect(one.told).toEqual([['pending_aging', 'j', 'c1']]);
            // a store that cannot be read for a moment does not make it forget: the row is not told again when the store is back
            mem.state.failLoad = true;
            expect(await other.notes.tellAged()).toBe(false);
            mem.state.failLoad = false;
            expect(await other.notes.tellAged()).toBe(true);
            expect(one.told).toHaveLength(1);
            await other.notes.resume();
            await other.notes.tellAged();
            expect(one.told).toHaveLength(1);
        });

        it('tells of a row only this process holds (the store could not keep it) at the same 6 days, from memory', async () => {
            const mem = memoryStore();
            mem.state.down = true;
            const one = aged();
            const { notes, advance } = ledger(mem.store, () => false, { report: one.report });
            notes.record('b', 'j', call('only-here'));
            await notes.flush('j');
            expect(mem.held.size).toBe(0);
            advance(EVIDENCE_AGED_MS - 1);
            await notes.tellAged();
            expect(one.told).toEqual([]);
            advance(1);
            await notes.tellAged();
            expect(one.told).toEqual([['pending_aging', 'j', 'only-here']]);
        });

        it('keeps a row waiting for Orbit and a dead letter of the same job and call apart: each is told, as what it is', async () => {
            const mem = memoryStore();
            const one = aged();
            const { notes, advance } = ledger(mem.store, () => false, { report: one.report });
            notes.record('b', 'j', call('same'));
            await notes.flush('j');
            mem.dead.set('j|same', { botId: 'b', jobId: 'j', row: deadRow('same', 1000) });
            advance(DEAD_LETTER_AGED_MS);
            await notes.tellAged();
            expect(one.told.map(([what]) => what).sort()).toEqual(['dead_aging', 'pending_aging']);
        });

        it('after a restart the aged row is delivered under the SAME call id and unchanged (the receipt and the wallet at Orbit rest on that), and is told only while it waits', async () => {
            const mem = memoryStore();
            const first = ledger(mem.store, () => false);
            first.notes.turn('j', 4, 'run-z');
            first.notes.record('bot-9', 'j', call('c1', { kind: 'uncertain', reason: 'stream_cut', providerStatus: null }));
            await vi.waitFor(() => expect(mem.held.size).toBe(1));
            const original = [...mem.held.values()][0].row;
            const one = aged();
            let up = false;
            const second = ledger(mem.store, () => up, { report: one.report });
            second.advance(EVIDENCE_AGED_MS);
            expect(await second.notes.resume()).toBe(true);
            await second.notes.tellAged();
            expect(one.told).toEqual([['pending_aging', 'j', 'c1']]);
            up = true;
            expect(await second.notes.flush('j')).toBe(true);
            expect(second.sent).toEqual([{ botId: 'bot-9', jobId: 'j', rows: [original] }]);
            expect(second.sent[0].rows[0].callId).toBe('c1');
            await vi.waitFor(() => expect(mem.held.size).toBe(0));
            await second.notes.tellAged();
            expect(one.told).toHaveLength(1);
        });

        it('tells once of a dead letter of 29 days, a day before it expires, and by the time of the row, with its job and call', async () => {
            expect(DEAD_LETTER_AGED_MS).toBe(29 * 24 * 60 * 60 * 1000);
            expect(DEAD_LETTER_KEEP_MS - DEAD_LETTER_AGED_MS).toBe(24 * 60 * 60 * 1000);
            const mem = memoryStore();
            const one = aged();
            const { notes, advance } = ledger(mem.store, () => true, { report: one.report });
            mem.dead.set('j|bad', { botId: 'b', jobId: 'j', row: deadRow('bad', 1000) });
            advance(DEAD_LETTER_AGED_MS - 1);
            expect(await notes.tellAged()).toBe(true);
            expect(one.told).toEqual([]);
            advance(1);
            await notes.tellAged();
            await notes.tellAged();
            expect(one.told).toEqual([['dead_aging', 'j', 'bad']]);
            // the dead letter is only read: it stays where it is, to be replayed
            expect(mem.dead.size).toBe(1);
        });

        it('a dead letter is told as a dead letter, never also as a row waiting for Orbit, once it is put back for a replay', async () => {
            const mem = memoryStore();
            const one = aged();
            const { notes, advance } = ledger(mem.store, () => false, { report: one.report });
            mem.dead.set('j|bad', { botId: 'b', jobId: 'j', row: deadRow('bad', 1000) });
            advance(DEAD_LETTER_AGED_MS);
            expect(await notes.replayDeadLetters()).toBe(1);
            await notes.tellAged();
            expect(one.told).toEqual([['dead_aging', 'j', 'bad']]);
        });

        it('tells of a dead letter kept only in memory (no store) too', async () => {
            const one = aged();
            const kinds: string[] = [];
            let now = 1000;
            const notes = createRefusalNotes(() => now, {
                retryMs: [0],
                laterMs: [],
                report: (what, info) => {
                    kinds.push(what);
                    one.report(what, info);
                },
                sink: async (_botId, _jobId, rows) => (rows.some((row) => row.callId === 'bad') ? 'rejected' : true),
            });
            notes.record('b', 'j', call('ok'));
            await notes.flush('j');
            notes.record('b', 'j', call('bad'));
            await notes.flush('j');
            expect(kinds).toContain('dead_letter');
            now += DEAD_LETTER_AGED_MS;
            await notes.tellAged();
            expect(one.told).toEqual([['dead_aging', 'j', 'bad']]);
        });

        it('forgets a row that has gone (replayed, taken, expired): the same call id kept again later is told again', async () => {
            const mem = memoryStore();
            const one = aged();
            const { notes, advance } = ledger(mem.store, () => true, { report: one.report });
            mem.dead.set('j|bad', { botId: 'b', jobId: 'j', row: deadRow('bad', 1000) });
            advance(DEAD_LETTER_AGED_MS);
            await notes.tellAged();
            mem.dead.clear();
            await notes.tellAged();
            mem.dead.set('j|bad', { botId: 'b', jobId: 'j', row: deadRow('bad', 1000) });
            await notes.tellAged();
            expect(one.told.map(([what]) => what)).toEqual(['dead_aging', 'dead_aging']);
        });

        it('keeps what it has told while the store cannot be read (a row is not told twice for a store that blinked), and says it could not read, never throwing', async () => {
            const mem = memoryStore();
            const one = aged();
            const { notes, advance } = ledger(mem.store, () => false, { report: one.report });
            mem.dead.set('j|bad', { botId: 'b', jobId: 'j', row: deadRow('bad', 1000) });
            advance(DEAD_LETTER_AGED_MS);
            expect(await notes.tellAged()).toBe(true);
            mem.state.failLoad = true;
            expect(await notes.tellAged()).toBe(false);
            mem.state.failLoad = false;
            expect(await notes.tellAged()).toBe(true);
            expect(one.told).toEqual([['dead_aging', 'j', 'bad']]);
            const noDead = memoryStore();
            noDead.store.loadDead = async () => {
                throw new Error('down');
            };
            expect(await ledger(noDead.store, () => true).notes.tellAged()).toBe(false);
        });

        it('is a yes with no store and nothing to tell, and a report that throws never stops it', async () => {
            const bare = createRefusalNotes(() => 1000, { sink: async () => true });
            expect(await bare.tellAged()).toBe(true);
            const mem = memoryStore();
            const { notes, advance } = ledger(mem.store, () => false, { report: () => { throw new Error('Sentry down'); } });
            mem.dead.set('j|bad', { botId: 'b', jobId: 'j', row: deadRow('bad', 1000) });
            notes.record('b', 'j', call('c1'));
            advance(DEAD_LETTER_AGED_MS);
            await expect(notes.tellAged()).resolves.toBe(true);
        });

        describe('the hourly look (startAgedEvidence)', () => {
            const stub = (over: () => Promise<boolean> = async () => true) => ({ tellAged: vi.fn(over) });

            it('looks now, then once an hour, and never more often', async () => {
                vi.useFakeTimers();
                try {
                    expect(EVIDENCE_AGED_EVERY_MS).toBe(60 * 60 * 1000);
                    const notes = stub();
                    const timer = startAgedEvidence(notes);
                    expect(notes.tellAged).toHaveBeenCalledTimes(1);
                    await vi.advanceTimersByTimeAsync(EVIDENCE_AGED_EVERY_MS - 1);
                    expect(notes.tellAged).toHaveBeenCalledTimes(1);
                    await vi.advanceTimersByTimeAsync(1);
                    expect(notes.tellAged).toHaveBeenCalledTimes(2);
                    await vi.advanceTimersByTimeAsync(3 * EVIDENCE_AGED_EVERY_MS);
                    expect(notes.tellAged).toHaveBeenCalledTimes(5);
                    clearInterval(timer);
                    await vi.advanceTimersByTimeAsync(EVIDENCE_AGED_EVERY_MS);
                    expect(notes.tellAged).toHaveBeenCalledTimes(5);
                } finally {
                    vi.useRealTimers();
                }
            });

            it('goes on after a look that failed, throwing or rejecting, and does not hold the process open', async () => {
                const unhandled: unknown[] = [];
                const seen = (reason: unknown) => void unhandled.push(reason);
                process.on('unhandledRejection', seen);
                vi.useFakeTimers();
                try {
                    let n = 0;
                    // a plain function, not a mock: a mock keeps the promise it returned and so counts a rejection as seen
                    const notes = {
                        tellAged: () => {
                            n += 1;
                            if (n === 1) throw new Error('sync');
                            if (n === 2) return Promise.reject(new Error('async'));
                            return Promise.resolve(true);
                        },
                    };
                    const timer = startAgedEvidence(notes, 1000);
                    await vi.advanceTimersByTimeAsync(3000);
                    expect(n).toBe(4);
                    expect(timer.hasRef()).toBe(false);
                    clearInterval(timer);
                } finally {
                    vi.useRealTimers();
                }
                // the rejected look was handled: nothing is left unhandled for the process to see
                await new Promise((resolve) => setTimeout(resolve, 20));
                expect(unhandled).toEqual([]);
                process.off('unhandledRejection', seen);
            });

            it('is started by the server at start-up with its own refusal notes (the server cannot be started in a test, so its source is read: an empty timer would silently never tell)', () => {
                const source = readFileSync(join(__dirname, '..', 'server', 'index.ts'), 'utf8');
                expect(source).toMatch(/import \{[^}]*\bstartAgedEvidence\b[^}]*\} from '\.\/ComputerRefusals';/);
                expect(source).toMatch(/^\s*startAgedEvidence\(computerRefusals\);$/m);
                expect(source).not.toMatch(/setInterval\([^)]*tellAged/);
            });
        });

        it('says in words what it is and what to do, and carries ids only', () => {
            expect(FAULT_EVIDENCE_MESSAGES.pending_aging).toMatch(/6 days/);
            expect(FAULT_EVIDENCE_MESSAGES.pending_aging).toMatch(/dropped at 7/);
            expect(FAULT_EVIDENCE_MESSAGES.dead_aging).toMatch(/29 days/);
            expect(FAULT_EVIDENCE_MESSAGES.dead_aging).toMatch(/dropped at 30/);
            expect(FAULT_EVIDENCE_MESSAGES.dead_aging).toMatch(/replay/);
        });
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

        describe('an Orbit that reads each row on its own and names the rows it could not read (rejected: [{ callId }]): exactly those rows are refused alone', () => {
            /** A sink that takes the batch and names the rows in `bad`. */
            const naming = (bad: Set<string>) => {
                const calls: string[][] = [];
                const taken: string[] = [];
                // The first row goes at once on its own: every answer is held until `open()`, so the rows recorded meanwhile are sent together in one batch
                let open!: () => void;
                const gate = new Promise<void>((resolve) => (open = resolve));
                const sink = async (_botId: string, _jobId: string, rows: CallRow[]): Promise<SinkAnswer> => {
                    await gate;
                    calls.push(rows.map((row) => row.callId));
                    const named = rows.filter((row) => bad.has(row.callId)).map((row) => row.callId);
                    taken.push(...rows.filter((row) => !bad.has(row.callId)).map((row) => row.callId));
                    return named.length > 0 ? { rejected: named } : true;
                };
                return { sink, calls, taken, open };
            };

            it('moves exactly the named rows to the dead letters (same 30-day keep, told once with its ids) and takes the rest of the batch as delivered, in ONE call (no splitting)', async () => {
                const mem = memoryStore();
                const o = naming(new Set(['bad1', 'bad2']));
                const told: Array<[string, { jobId: string; callId: string }]> = [];
                const notes = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], store: mem.store, sink: o.sink, report: (what, info) => told.push([what, info]) });
                for (const id of ['a', 'bad1', 'b', 'bad2', 'c']) notes.record('bot', 'job', call(id));
                await vi.waitFor(() => expect(mem.held.size).toBe(5));
                o.open();
                expect(await notes.flush('job')).toBe(true);
                expect(o.calls.filter((ids) => ids.length > 1)).toHaveLength(1);
                expect(o.taken.sort()).toEqual(['a', 'b', 'c']);
                expect(told.filter(([what]) => what === 'dead_letter').map(([, info]) => info.callId).sort()).toEqual(['bad1', 'bad2']);
                await vi.waitFor(() => expect(mem.held.size).toBe(0));
                expect([...mem.dead.keys()].sort()).toEqual(['job|bad1', 'job|bad2']);
                // the rows that were named are the rows as they were made, under their own ids
                expect(mem.dead.get('job|bad1')?.row).toMatchObject({ callId: 'bad1', kind: 'fault' });
                // not sent again, not told again
                const before = o.calls.length;
                expect(await notes.flush('job')).toBe(true);
                expect(o.calls.length).toBe(before);
                expect(told.filter(([what]) => what === 'dead_letter')).toHaveLength(2);
                // and they can be replayed under the same ids once Orbit reads them
                const replay = naming(new Set());
                replay.open();
                const again = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], store: mem.store, sink: replay.sink });
                expect(await again.replayDeadLetters()).toBe(2);
                await again.flush('job');
                expect(replay.taken.sort()).toEqual(['bad1', 'bad2']);
                await vi.waitFor(() => expect(mem.dead.size).toBe(0));
            });

            it('names ids that are not in the batch: they refuse nothing; and a batch that names every row has taken none, so it is the same as Orbit being away (kept, sent again, told once)', async () => {
                const first = naming(new Set(['ghost']));
                first.open();
                const ids = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], sink: async (b, j, rows) => (await first.sink(b, j, rows)) && { rejected: ['ghost', 'not-sent'] } });
                ids.record('bot', 'job', call('a'));
                expect(await ids.flush('job')).toBe(true);
                expect(first.taken).toEqual(['a']);

                const told: string[] = [];
                const all = naming(new Set(['x', 'y']));
                all.open();
                const notes = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], sink: all.sink, report: (what) => told.push(what) });
                notes.record('bot', 'other', call('x'));
                notes.record('bot', 'other', call('y'));
                expect(await notes.flush('other')).toBe(false);
                expect(told).toEqual(['all_refused']);
                expect(all.taken).toEqual([]);
            });

            it('a row put back from the dead letters that Orbit now takes leaves them, while one it names again stays there without a second alert', async () => {
                const mem = memoryStore();
                const told: string[] = [];
                const o = naming(new Set(['d2']));
                o.open();
                const notes = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], store: mem.store, sink: o.sink, report: (what, info) => told.push(`${what} ${info.callId}`) });
                mem.dead.set('job|d1', { botId: 'bot', jobId: 'job', row: call('d1') as CallRow });
                mem.dead.set('job|d2', { botId: 'bot', jobId: 'job', row: call('d2') as CallRow });
                expect(await notes.replayDeadLetters()).toBe(2);
                await notes.flush('job');
                expect(o.taken).toEqual(['d1']);
                await vi.waitFor(() => expect([...mem.dead.keys()]).toEqual(['job|d2']));
                expect(told).toEqual([]);
            });

            it('a replayed dead letter that Orbit refuses again goes back to the dead letters even when Orbit has taken no row lately (a quiet server or a restart): it is not sent again for days, and no "all refused" is raised for it (Sentry on #2114)', async () => {
                const mem = memoryStore();
                const told: string[] = [];
                const all = naming(new Set(['d1', 'd2']));
                all.open();
                const notes = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], store: mem.store, sink: all.sink, report: (what, info) => told.push(`${what} ${info.callId}`) });
                mem.dead.set('job|d1', { botId: 'bot', jobId: 'job', row: call('d1') as CallRow });
                mem.dead.set('job|d2', { botId: 'bot', jobId: 'job', row: call('d2') as CallRow });
                expect(await notes.replayDeadLetters()).toBe(2);
                expect(await notes.flush('job')).toBe(true);
                expect(told).toEqual([]);
                expect(all.taken).toEqual([]);
                expect([...mem.dead.keys()].sort()).toEqual(['job|d1', 'job|d2']);
                // not sent again
                const before = all.calls.length;
                expect(await notes.flush('job')).toBe(true);
                expect(all.calls.length).toBe(before);
            });

            it('beside a fresh row on a quiet server, a replayed dead letter refused again goes back to the dead letters, and the "all refused" alert names the FRESH row, which is kept and sent again', async () => {
                const mem = memoryStore();
                const told: string[] = [];
                const all = naming(new Set(['d1', 'fresh']));
                all.open();
                const notes = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], store: mem.store, sink: all.sink, report: (what, info) => told.push(`${what} ${info.callId}`) });
                mem.dead.set('job|d1', { botId: 'bot', jobId: 'job', row: call('d1') as CallRow });
                expect(await notes.replayDeadLetters()).toBe(1);
                notes.record('bot', 'job', call('fresh'));
                expect(await notes.flush('job')).toBe(false);
                expect(told).toEqual(['all_refused fresh']);
                // the replayed row is back among the dead letters and is not sent again; the fresh row stays waiting for Orbit
                expect([...mem.dead.keys()]).toEqual(['job|d1']);
                await vi.waitFor(() => expect([...mem.held.keys()]).toEqual(['job|fresh']));
                const sentAgain = all.calls.slice(1).flat();
                expect(sentAgain).not.toContain('d1');
            });

            it('a row taken in the same pass as a named one does not leave Orbit "away": the named row is set aside as a dead letter even when it is alone in a later batch', async () => {
                const o = naming(new Set(['bad']));
                o.open();
                const told: string[] = [];
                const notes = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], sink: o.sink, report: (what, info) => told.push(`${what} ${info.callId}`) });
                notes.record('bot', 'job', call('ok'));
                expect(await notes.flush('job')).toBe(true);
                notes.record('bot', 'job', call('bad'));
                expect(await notes.flush('job')).toBe(true);
                expect(told).toEqual(['dead_letter bad']);
            });

            it('the same, when the accepted row and the named refusal come in ONE pass (nothing was taken before): the mixed batch takes the good row and sets the named one aside, and a refused row that comes alone after it becomes a dead letter too, never "pending"', async () => {
                const o = naming(new Set(['bad1', 'bad2']));
                o.open();
                const told: string[] = [];
                const notes = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], sink: o.sink, report: (what, info) => told.push(`${what} ${info.callId}`) });
                // no row has been taken before this pass: Orbit has not been seen to take anything lately
                notes.record('bot', 'job', call('ok'));
                notes.record('bot', 'job', call('bad1'));
                expect(await notes.flush('job')).toBe(true);
                expect(o.taken).toEqual(['ok']);
                expect(told).toEqual(['dead_letter bad1']);
                // a refused row alone in the next pass: Orbit named it, so it is a dead letter, not a row waiting for an Orbit that is "away"
                notes.record('bot', 'job', call('bad2'));
                expect(await notes.flush('job')).toBe(true);
                expect(told).toEqual(['dead_letter bad1', 'dead_letter bad2']);
                expect(told.some((one) => one.startsWith('all_refused'))).toBe(false);
                // and nothing is left waiting: no row is sent again
                const before = o.calls.length;
                expect(await notes.flush('job')).toBe(true);
                expect(o.calls.length).toBe(before);
            });
        });

        describe('an Orbit that says it refused rows without saying which (Sentry on #2114): no row is taken as delivered unseen, the refused ones are found, nothing is dropped in silence', () => {
            /**
             * A sink that takes every row it reads and says, for a batch that holds rows of `bad`, how many it refused: `unnamed` of them without naming (`namedToo` of them by name).
             * `alwaysRefuses` makes it refuse something of every batch, even a batch of one row.
             */
            const counting = (bad: Set<string>, opts: { named?: Set<string>; alwaysRefuses?: boolean } = {}) => {
                const calls: string[][] = [];
                const taken: string[] = [];
                let open!: () => void;
                const gate = new Promise<void>((resolve) => (open = resolve));
                const sink = async (_botId: string, _jobId: string, rows: CallRow[]): Promise<SinkAnswer> => {
                    await gate;
                    const ids = rows.map((row) => row.callId);
                    calls.push(ids);
                    const refused = ids.filter((id) => bad.has(id));
                    const named = refused.filter((id) => opts.named?.has(id));
                    const unnamed = opts.alwaysRefuses ? Math.max(1, refused.length - named.length) : refused.length - named.length;
                    if (!opts.alwaysRefuses) taken.push(...ids.filter((id) => !bad.has(id)));
                    if (unnamed <= 0 && named.length === 0) return true;
                    return { rejected: named, ...(unnamed > 0 ? { unnamed } : {}) };
                };
                return { sink, calls, taken, open };
            };
            const record = (notes: ReturnType<typeof createRefusalNotes>, ids: string[], jobId = 'job') => {
                for (const id of ids) notes.record('bot', jobId, call(id));
            };

            it('a count with no names: the rows are split until the refused one is alone, it is set aside as a dead letter (kept 30 days, told once with its ids), and the others are taken', async () => {
                const mem = memoryStore();
                const o = counting(new Set(['bad']));
                const told: Array<[string, { jobId: string; callId: string }]> = [];
                const notes = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], store: mem.store, sink: o.sink, report: (what, info) => told.push([what, info]) });
                record(notes, ['a', 'b', 'bad', 'c', 'd']);
                await vi.waitFor(() => expect(mem.held.size).toBe(5));
                o.open();
                expect(await notes.flush('job')).toBe(true);
                expect([...new Set(o.taken)].sort()).toEqual(['a', 'b', 'c', 'd']);
                expect(told.filter(([what]) => what === 'dead_letter').map(([, info]) => info.callId)).toEqual(['bad']);
                await vi.waitFor(() => expect(mem.held.size).toBe(0));
                expect([...mem.dead.keys()]).toEqual(['job|bad']);
                // and the row that is set aside is the row as it was made, under its own id
                expect(mem.dead.get('job|bad')?.row).toMatchObject({ callId: 'bad', kind: 'fault' });
            });

            it('the operators are told through the report hook, ONCE for the job, with ids only (no call id), however many times the batch is split; another job is told on its own', async () => {
                const o = counting(new Set(['bad1', 'bad2', 'bad3', 'bad4']));
                const told: Array<[string, { jobId: string; callId: string }]> = [];
                const notes = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], sink: o.sink, report: (what, info) => told.push([what, info]) });
                record(notes, ['a', 'bad1', 'b', 'bad2', 'c']);
                o.open();
                await notes.flush('job');
                expect(told.filter(([what]) => what === 'unnamed_rejection')).toEqual([['unnamed_rejection', { jobId: 'job', callId: '' }]]);
                expect(told.filter(([what]) => what === 'dead_letter').map(([, info]) => info.callId).sort()).toEqual(['bad1', 'bad2']);
                // a later batch of the same job that is refused the same way is not told again
                record(notes, ['x', 'bad3']);
                await notes.flush('job');
                expect(told.filter(([what]) => what === 'unnamed_rejection')).toHaveLength(1);
                expect(told.filter(([what]) => what === 'dead_letter')).toHaveLength(3);
                // another job is told on its own
                record(notes, ['y', 'bad4'], 'job2');
                await notes.flush('job2');
                expect(told.filter(([what]) => what === 'unnamed_rejection').map(([, info]) => info.jobId)).toEqual(['job', 'job2']);
            });

            it('names some rows and only counts the rest: the named are set aside at once, the rest is split to find the others', async () => {
                const mem = memoryStore();
                const o = counting(new Set(['named', 'quiet']), { named: new Set(['named']) });
                const told: string[] = [];
                const notes = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], store: mem.store, sink: o.sink, report: (what, info) => told.push(`${what} ${info.callId}`) });
                record(notes, ['a', 'named', 'b', 'quiet', 'c']);
                await vi.waitFor(() => expect(mem.held.size).toBe(5));
                o.open();
                expect(await notes.flush('job')).toBe(true);
                expect([...new Set(o.taken)].sort()).toEqual(['a', 'b', 'c']);
                expect(told.filter((one) => one.startsWith('dead_letter')).sort()).toEqual(['dead_letter named', 'dead_letter quiet']);
                expect(told.filter((one) => one.startsWith('unnamed_rejection'))).toEqual(['unnamed_rejection ']);
                await vi.waitFor(() => expect(mem.held.size).toBe(0));
                expect([...mem.dead.keys()].sort()).toEqual(['job|named', 'job|quiet']);
            });

            it('a count of zero is nothing: the rows Orbit did not name are taken as delivered in ONE call, as before', async () => {
                const taken: string[] = [];
                const calls: string[][] = [];
                const told: string[] = [];
                const notes = createRefusalNotes(() => 1000, {
                    retryMs: [0],
                    laterMs: [],
                    sink: async (_b, _j, rows) => {
                        calls.push(rows.map((row) => row.callId));
                        taken.push(...rows.filter((row) => row.callId !== 'bad').map((row) => row.callId));
                        return { rejected: ['bad'], unnamed: 0 };
                    },
                    report: (what) => told.push(what),
                });
                record(notes, ['a', 'bad', 'b']);
                expect(await notes.flush('job')).toBe(true);
                expect(told).not.toContain('unnamed_rejection');
                expect(calls.flat().filter((id) => id === 'a')).toHaveLength(1);
                expect(told).toEqual(['dead_letter']);
            });

            it('a row Orbit named is set aside at once: it is sent only the once, not again with the rest', async () => {
                const mem = memoryStore();
                const o = counting(new Set(['named', 'quiet']), { named: new Set(['named']) });
                const notes = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], store: mem.store, sink: o.sink });
                record(notes, ['a', 'named', 'b', 'quiet', 'c']);
                await vi.waitFor(() => expect(mem.held.size).toBe(5));
                o.open();
                await notes.flush('job');
                expect(o.calls.flat().filter((id) => id === 'named')).toHaveLength(1);
            });

            it('names every row of the batch and counts one more it does not name: the named rows are set aside, the batch still counts as dealt with', async () => {
                const mem = memoryStore();
                const told: string[] = [];
                let step = 0;
                const notes = createRefusalNotes(() => 1000, {
                    retryMs: [0],
                    laterMs: [],
                    store: mem.store,
                    sink: async (_b, _j, rows) => (++step === 1 ? true : { rejected: rows.map((row) => row.callId), unnamed: 1 }),
                    report: (what, info) => told.push(`${what} ${info.callId}`),
                });
                record(notes, ['ok']);
                expect(await notes.flush('job')).toBe(true);
                record(notes, ['bad']);
                expect(await notes.flush('job')).toBe(true);
                expect(told).toEqual(['unnamed_rejection ', 'dead_letter bad']);
                await vi.waitFor(() => expect([...mem.dead.keys()]).toEqual(['job|bad']));
            });

            it('tells again for the same job once the notes have forgotten it (an hour), never twice inside the hour', async () => {
                let clock = 1000;
                const o = counting(new Set(['bad1', 'bad2']));
                o.open();
                const told: string[] = [];
                const notes = createRefusalNotes(() => clock, { retryMs: [0], laterMs: [], sink: o.sink, report: (what) => told.push(what) });
                record(notes, ['a', 'bad1']);
                await notes.flush('job');
                expect(told.filter((what) => what === 'unnamed_rejection')).toHaveLength(1);
                clock += REFUSAL_NOTE_KEEP_MS + 1000;
                record(notes, ['b', 'bad2']);
                await notes.flush('job');
                expect(told.filter((what) => what === 'unnamed_rejection')).toHaveLength(2);
            });

            it('a batch of one row that Orbit says it refused is that row: set aside, never dropped', async () => {
                const mem = memoryStore();
                const o = counting(new Set(['bad']));
                const told: string[] = [];
                const notes = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], store: mem.store, sink: o.sink, report: (what, info) => told.push(`${what} ${info.callId}`) });
                o.open();
                // Orbit has taken a row lately, so the contract works and the refused row is its own fault
                record(notes, ['ok']);
                expect(await notes.flush('job')).toBe(true);
                record(notes, ['bad']);
                expect(await notes.flush('job')).toBe(true);
                expect(told).toEqual(['unnamed_rejection ', 'dead_letter bad']);
                await vi.waitFor(() => expect([...mem.dead.keys()]).toEqual(['job|bad']));
                expect(mem.held.size).toBe(0);
            });

            it('an Orbit that refuses something of every batch, even one row, and has taken none: every row is KEPT and sent again (like Orbit being away), the operators are told, nothing is taken or dropped', async () => {
                const mem = memoryStore();
                const o = counting(new Set(['a', 'b', 'c']), { alwaysRefuses: true });
                const told: string[] = [];
                const notes = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], store: mem.store, sink: o.sink, report: (what) => told.push(what) });
                record(notes, ['a', 'b', 'c']);
                await vi.waitFor(() => expect(mem.held.size).toBe(3));
                o.open();
                expect(await notes.flush('job')).toBe(false);
                expect(o.taken).toEqual([]);
                expect(mem.held.size).toBe(3);
                expect(mem.dead.size).toBe(0);
                expect(told.filter((what) => what === 'unnamed_rejection')).toHaveLength(1);
                expect(told.filter((what) => what === 'all_refused')).toHaveLength(1);
            });

            it('a row put back from the dead letters that Orbit refuses again without a name stays there, without a second dead-letter alert', async () => {
                const mem = memoryStore();
                const o = counting(new Set(['d2']));
                o.open();
                const told: string[] = [];
                const notes = createRefusalNotes(() => 1000, { retryMs: [0], laterMs: [], store: mem.store, sink: o.sink, report: (what, info) => told.push(`${what} ${info.callId}`) });
                mem.dead.set('job|d1', { botId: 'bot', jobId: 'job', row: call('d1') as CallRow });
                mem.dead.set('job|d2', { botId: 'bot', jobId: 'job', row: call('d2') as CallRow });
                expect(await notes.replayDeadLetters()).toBe(2);
                await notes.flush('job');
                expect([...new Set(o.taken)]).toEqual(['d1']);
                await vi.waitFor(() => expect([...mem.dead.keys()]).toEqual(['job|d2']));
                expect(told.filter((one) => one.startsWith('dead_letter'))).toEqual([]);
            });

            it('says in words what it is, and that nothing is dropped', () => {
                expect(FAULT_EVIDENCE_MESSAGES.unnamed_rejection).toMatch(/without saying which/);
                expect(FAULT_EVIDENCE_MESSAGES.unnamed_rejection).toMatch(/nothing is dropped/);
            });
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
    const state = { moments: [] as Array<[string, number]>, down: false, failCalled: 0, failTurns: 0, failAccepted: 0, failClose: 0, lostAfterClose: 0, failRetract: 0, retracted: 0, failCommit: 0, commitAsked: 0, commitFrom: [] as number[], commitLostAfter: 0, released: 0, failRelease: 0, holdClose: undefined as Promise<void> | undefined, betweenTries: undefined as (() => Promise<unknown>) | undefined, holdRetract: undefined as Promise<void> | undefined, retractWaiting: 0, failUnrecorded: false, told: [] as string[], unrecorded: [] as string[], hold: undefined as Promise<void> | undefined };
    /** The turns each server's runner said, per job: the field `turn:<server>` of the shared record. */
    const turns = new Map<string, Map<string, SharedTurnList>>();
    /** The acceptances each server noted, per job: its moment and the turn (and run) the call began in (`undefined`: not known). */
    const accepted: Array<{ server: string; jobId: string; at: number; turn?: CallTurn }> = [];
    /** The turns the runner gave up (fenced), per job. */
    const fences = new Map<string, Array<{ key: string; at: number; committed?: boolean }>>();
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
            // as the store does it, in one step: a turn that was given up takes no acceptance (a turn that is not known: none lately given up)
            const shut = fences.get(jobId) ?? [];
            // a fence counts for FENCE_LIFE_MS from its moment, a known turn or not
            // (a fence COMMITTED for the call's own turn and run refuses it whenever it arrives)
            if (shut.some((one) => (!turn || one.key === '' || one.key === `${turn.turn}|${turn.run ?? ''}`) && (one.at >= at - FENCE_LIFE_MS || (one.committed && turn !== undefined && one.key === `${turn.turn}|${turn.run ?? ''}`)))) return false;
            accepted.push({ server: id, jobId, at, ...(turn ? { turn } : {}) });
            return true;
        },
        closeTurn: async (jobId, turn, from, at) => {
            if (state.holdClose) await state.holdClose;
            if (state.down || state.failClose > 0) {
                if (state.failClose > 0) state.failClose -= 1;
                // a try that did not run, and something happens before the next one (another server takes a call up)
                const between = state.betweenTries;
                state.betweenTries = undefined;
                if (between) await between();
                throw new Error('shared store down');
            }
            // as the store does it, in one step: an acceptance by ANOTHER server that counts for the turn since `from` minus the skew stops it; otherwise the turn is fenced
            for (const one of accepted) {
                if (one.server === id || one.jobId !== jobId || one.at < from - SHARED_CALL_SKEW_MS) continue;
                if (turn && one.turn && (one.turn.turn !== turn.turn || (one.turn.run ?? '') !== (turn.run ?? ''))) continue;
                return false;
            }
            fences.set(jobId, [...(fences.get(jobId) ?? []), { key: turn ? `${turn.turn}|${turn.run ?? ''}` : '', at }]);
            // the script RAN and the fence is written, but its answer never comes back (a timeout, a connection that broke after it ran)
            if (state.lostAfterClose > 0) {
                state.lostAfterClose -= 1;
                throw new Error('the answer was lost after the script ran');
            }
            return true;
        },
        retractFence: async (jobId, turn, at, committedToo = false) => {
            state.retractWaiting += 1;
            if (state.holdRetract) await state.holdRetract;
            if (state.down || state.failRetract > 0) {
                if (state.failRetract > 0) state.failRetract -= 1;
                throw new Error('shared store down');
            }
            state.retracted += 1;
            // as the store does it, in one step: only the fence of that very moment goes (a committed one only when asked, for a commit that was never confirmed)
            const key = turn ? `${turn.turn}|${turn.run ?? ''}` : '';
            fences.set(jobId, (fences.get(jobId) ?? []).filter((one) => !(one.key === key && one.at === at && (!one.committed || committedToo))));
        },
        commitFence: async (jobId, turn, at, from) => {
            state.commitAsked += 1;
            state.commitFrom.push(from);
            if (state.down || state.failCommit > 0) {
                if (state.failCommit > 0) state.failCommit -= 1;
                throw new Error('shared store down');
            }
            // as the store does it, in one step: only the fence that holds exactly that moment becomes committed
            const key = `${turn.turn}|${turn.run ?? ''}`;
            const standing = (fences.get(jobId) ?? []).find((one) => one.key === key && one.at === at);
            if (!standing) return false;
            // a fence that is not committed yet is committed only while no OTHER server has taken up a call of the turn since the moment the close counted from
            if (!standing.committed) {
                for (const one of accepted) {
                    if (one.server === id || one.jobId !== jobId || one.at < from - SHARED_CALL_SKEW_MS) continue;
                    if (one.turn && (one.turn.turn !== turn.turn || (one.turn.run ?? '') !== (turn.run ?? ''))) continue;
                    return false;
                }
            }
            standing.committed = true;
            // the script RAN and the fence is committed, but its answer never comes back
            if (state.commitLostAfter > 0) {
                state.commitLostAfter -= 1;
                throw new Error('the answer was lost after the script ran');
            }
            return true;
        },
        releaseFence: async (jobId, turn, at) => {
            if (state.down || state.failRelease > 0) {
                if (state.failRelease > 0) state.failRelease -= 1;
                throw new Error('shared store down');
            }
            state.released += 1;
            // as the store does it: only the COMMITTED fence of that very moment goes
            const key = `${turn.turn}|${turn.run ?? ''}`;
            fences.set(jobId, (fences.get(jobId) ?? []).filter((one) => !(one.key === key && one.at === at && one.committed)));
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
        /** The runner notes a turn and goes on to work it (what `work` does): the others are told that it began. */
        const begin = async (notes: ReturnType<typeof createRefusalNotes>, job: string, turn: number, run?: string) => {
            notes.turn(job, turn, run);
            await notes.turnPublished!(job);
        };
        /** The runner's promise is renewed while it works the job (every few seconds): the turn said again publishes the list again. */
        const renew = (a: ReturnType<typeof createRefusalNotes>, turn: number, run: string) => a.turn('j', turn, run);
        // What the relay does with a call: where it arrived, who is asked for the turn, then the row at its end
        const callOnB = async (b: ReturnType<typeof createRefusalNotes>, id: string, then?: () => void | Promise<void>) => {
            const arrived = b.mark();
            const began = await b.turnOfCall('j', arrived);
            await then?.();
            b.record('bot', 'j', { ...fault(id), turn: began.turn, ...(began.run ? { run: began.run } : {}) });
            await b.flush('j');
            return began;
        };

        it('gives the call the turn the runner on the other server had reached when the call arrived, with its run, so Orbit finds the row for that turn', async () => {
            const { a, b, sentByB, advance } = rigTurns();
            await begin(a, 'j', 1, 'run-1');
            advance(10_000);
            await begin(a, 'j', 2, 'run-1');
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
            await begin(a, 'j', 2, 'run-1');
            advance(3000);
            renew(a, 2, 'run-1');
            const late = await callOnB(b, 'early', async () => {
                advance(3000);
                await begin(a, 'j', 3, 'run-1');
            });
            expect(late.turn).toBe(2);
            advance(3000);
            const next = await callOnB(b, 'later');
            expect(next.turn).toBe(3);
            expect(sentByB.map((row) => [row.callId, row.turn])).toEqual([['early', 2], ['later', 3]]);
        });

        it('names the run of the turn: a runner that restarted (turns from 1 again, a new run) is not mixed up with the old one', async () => {
            const { a, b, advance } = rigTurns();
            await begin(a, 'j', 1, 'run-old');
            await begin(a, 'j', 2, 'run-old');
            advance(50_000);
            await begin(a, 'j', 1, 'run-new');
            advance(3000);
            expect(await b.turnOfCall('j', b.mark())).toEqual({ turn: 1, run: 'run-new' });
        });

        it('says the same turn again (a reconnect to it) without making a second turn of it: the moment it began stays', async () => {
            const { a, store, advance } = rigTurns();
            await begin(a, 'j', 3, 'run-1');
            advance(5000);
            await begin(a, 'j', 3, 'run-1');
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
            await begin(a, 'j', 4, 'run-1');
            advance(1000);
            store.state.down = true;
            expect(await callOnB(b, 'unknown-2')).toEqual({ turn: null });
            store.state.down = false;
            expect(sentByB.map((row) => [row.callId, row.turn, 'run' in row])).toEqual([['unknown-1', null, false], ['unknown-2', null, false]]);
            // the call arrived before the runner's first turn began: it is no call of that turn either
            const before = b.mark();
            advance(1000);
            await begin(a, 'j', 5, 'run-1');
            advance(3000);
            renew(a, 5, 'run-1');
            expect((await b.turnOfCall('j', before)).turn).toBeNull();
            const never = createRefusalNotes(() => 1, { shared: store.forServer('C'), runsHere: () => false });
            expect(await never.turnOfCall('fresh-job', { order: 1, at: 1 })).toEqual({ turn: null });
        });

        it('does not assign a turn from a list nobody promises is complete: the runner’s write of turn 5 was lost, Redis still answers with turn 4, and a call well inside turn 5 gets no turn', async () => {
            const { a, b, store, advance } = rigTurns();
            await begin(a, 'j', 4, 'run-1');
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
                await begin(a, 'j', 4, 'run-1');
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

        it('begins the turn at once when its write is made, with a store that works and with none: no retry timer is waited for', async () => {
            // The clock and the timers are the test's: nothing is advanced, so a publication that waited for a retry timer would never be done
            vi.useFakeTimers();
            try {
                const settle = async () => {
                    for (let turns = 0; turns < 20; turns++) await Promise.resolve();
                };
                const { a } = rigTurns();
                await begin(a, 'j', 1, 'run-1');
                let first = false;
                void a.turnPublished!('j').then(() => (first = true));
                await settle();
                expect(first).toBe(true);
                // the turn after it, the same way
                await begin(a, 'j', 2, 'run-1');
                let second = false;
                void a.turnPublished!('j').then(() => (second = true));
                await settle();
                expect(second).toBe(true);
                // with no store at all
                const alone = createRefusalNotes(() => 1000);
                alone.turn('j', 1);
                let third = false;
                void Promise.resolve(alone.turnPublished?.('j')).then(() => (third = true));
                await settle();
                expect(third).toBe(true);
            } finally {
                vi.useRealTimers();
            }
        });

        it('cannot tell when the promise has run out (the runner stopped working the job), and when two runners both promise (a job taken over): no turn', async () => {
            const { a, b, store, advance } = rigTurns();
            await begin(a, 'j', 1, 'run-1');
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
            await begin(c, 'j', 1, 'run-2');
            advance(0);
            await begin(a, 'j', 2, 'run-1');
            await Promise.resolve();
            expect((await b.turnOfCall('j', b.mark())).turn).toBeNull();
        });

        it('cannot tell the turn when TWO runners’ promises both cover the arrival (a job taken over while the first one’s promise still stands), though the call is well away from every turn’s beginning: no turn, no run', async () => {
            const clock = 100_000;
            const store = sharedStore();
            const first = createRefusalNotes(() => clock, { shared: store.forServer('A'), runsHere: () => true });
            const relay = createRefusalNotes(() => clock, { shared: store.forServer('B'), runsHere: () => false });
            await begin(first, 'j', 1, 'run-1');
            await Promise.resolve();
            // the arrival is 3 s after the turn began (more than the clock skew from its beginning), inside the promise by more than the skew (until 106 000)
            const arrival = { order: 1, at: clock + 3000 };
            expect(await relay.turnOfCall('j', arrival)).toEqual({ turn: 1, run: 'run-1' });
            // another server's runner takes the job over and promises its own turns, with its own beginnings well away from the arrival too
            const second = createRefusalNotes(() => clock, { shared: store.forServer('C'), runsHere: () => true });
            await begin(second, 'j', 1, 'run-2');
            await Promise.resolve();
            const lists = await store.forServer('B').turnsByOthers!('j');
            expect(lists).toHaveLength(2);
            expect(lists.every((one) => arrival.at < one.until - SHARED_CALL_SKEW_MS && Math.abs(arrival.at - one.turns[0].at) > SHARED_CALL_SKEW_MS)).toBe(true);
            // both cover it and neither is nearer: it is not told
            expect(await relay.turnOfCall('j', arrival)).toEqual({ turn: null });
        });

        it('cannot tell the turn of a call that arrived within the clock skew of any turn’s beginning (the servers’ clocks differ by 1.5 s, either way): turn null and no run, while a call well inside a turn keeps it', async () => {
            let runnerClock = 100_000;
            const store = sharedStore();
            const a = createRefusalNotes(() => runnerClock, { shared: store.forServer('A'), runsHere: () => true });
            // two relay servers: one whose clock runs 1.5 s ahead of the runner server's, one 1.5 s behind
            const ahead = createRefusalNotes(() => runnerClock + 1500, { shared: store.forServer('B'), runsHere: () => false });
            const behind = createRefusalNotes(() => runnerClock - 1500, { shared: store.forServer('C'), runsHere: () => false });
            await begin(a, 'j', 1, 'run-1');
            runnerClock += 30_000;
            await begin(a, 'j', 2, 'run-1');
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
            // the runner goes on to work the turn (a call that arrives before that is in the transition between turns: unattributed, see below)
            await here.turnPublished!('j');
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
            for (let n = 1; n <= 9; n++) await begin(a, 'j', n, 'run-1');
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
                await begin(a, 'j', 1, 'run-1');
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

        it('does not keep what it told of a job’s turns for ever: after the promise has lapsed (and the notes are cleaned) the bookkeeping of many jobs is gone, not one entry per job', async () => {
            let clock = 100_000;
            const store = sharedStore();
            const a = createRefusalNotes(() => clock, { shared: store.forServer('A'), runsHere: () => false });
            for (let n = 0; n < 300; n++) await begin(a, `job-${n}`, 1, 'run');
            await Promise.resolve();
            expect(a.trackedPublications()).toEqual({ attempted: 300, publishing: 300 });
            // the promises lapse, and the notes are kept an hour: then a later turn of another job cleans them out
            clock += SHARED_TURN_LEASE_MS + REFUSAL_NOTE_KEEP_MS + 1;
            await begin(a, 'latest', 1, 'run');
            await Promise.resolve();
            expect(a.trackedPublications()).toEqual({ attempted: 1, publishing: 1 });
            // the same for jobs that went on after: only the ones still going are held
            for (let n = 0; n < 50; n++) await begin(a, `next-${n}`, 1, 'run');
            clock += SHARED_TURN_LEASE_MS + 1;
            // their writes have settled
            await new Promise((resolve) => setTimeout(resolve, 5));
            await begin(a, 'after', 1, 'run');
            await Promise.resolve();
            expect(a.trackedPublications()).toEqual({ attempted: 1, publishing: 1 });
        });

        it('drops a lapsed promise and a settled publication as soon as notes are cleaned, even when the job’s turn history is still kept', async () => {
            let clock = 100_000;
            const store = sharedStore();
            const a = createRefusalNotes(() => clock, { shared: store.forServer('A'), runsHere: () => false });
            await begin(a, 'j', 1, 'run');
            await new Promise((resolve) => setTimeout(resolve, 5));
            expect(a.trackedPublications()).toEqual({ attempted: 1, publishing: 1 });
            // inside its promise nothing is dropped (another job's turn cleans the notes)
            clock += SHARED_TURN_LEASE_MS - 1;
            await begin(a, 'other', 1, 'run');
            await Promise.resolve();
            expect(a.trackedPublications().attempted).toBe(2);
            // the promise has lapsed: j's entries go, the history of the job stays (the turn is still known here)
            clock += 2;
            await begin(a, 'third', 1, 'run');
            await Promise.resolve();
            expect(a.turnOf('j')).toBe(1);
            expect(a.trackedPublications()).toEqual({ attempted: 2, publishing: 2 });
        });

        it('keeps a publication that a turnPublished wait could still read: the write is lost and the promise of the lists before it still stands', async () => {
            vi.useFakeTimers();
            try {
                let clock = 100_000;
                const store = sharedStore();
                const a = createRefusalNotes(() => clock, { shared: store.forServer('A'), runsHere: () => true });
                await begin(a, 'j', 4, 'run-1');
                await a.turnPublished!('j');
                store.state.failTurns = 1000;
                clock += 1000;
                a.turn('j', 5, 'run-1');
                // notes are cleaned by other jobs' turns while the wait goes on (the promise of turn 4's list stands until 106 000)
                let begun = false;
                const waiting = a.turnPublished!('j').then(() => (begun = true));
                await vi.advanceTimersByTimeAsync(1500);
                clock += 1000;
                a.turn('other', 1, 'run');
                await vi.advanceTimersByTimeAsync(300);
                expect(a.trackedPublications().publishing).toBe(2);
                expect(begun).toBe(false);
                // the promise runs out: the wait ends and the entry may go at the next cleaning
                clock += SHARED_TURN_LEASE_MS;
                await vi.advanceTimersByTimeAsync(1000);
                await waiting;
                expect(begun).toBe(true);
                a.turn('later', 1, 'run');
                await vi.advanceTimersByTimeAsync(10);
                // j's lapsed one and the other job's settled one are gone: only the newest may still be there
                expect(a.trackedPublications().publishing).toBeLessThanOrEqual(1);
            } finally {
                vi.useRealTimers();
            }
        });

        describe('giving a turn up (closing it) against a call another server takes up', () => {
            it('closes the turn so that a call another server tries to take up afterwards is refused (that call and any call whose turn is not known), while other turns and other jobs are untouched', async () => {
                const { a, b, advance, now } = rigTurns();
                await begin(a, 'k', 1, 'run-1');
                const since = a.mark();
                advance(10);
                expect(await a.closeTurn('k', since)).toBe(true);
                const fencedAt = now();
                // another server: refused for the turn that was closed, and for a call whose turn is not known (it may be of that turn)
                expect(await b.accepted('k', { turn: 1, run: 'run-1' })).toBe(false);
                expect(await b.accepted('k')).toBe(false);
                // the server of the runner: refused too, and nothing is marked as taken up
                expect(a.accepted('k', { turn: 1, run: 'run-1' })).toBe(false);
                expect(a.accepted('k')).toBe(false);
                expect(a.acceptedSince('k', since)).toBe(false);
                // a turn before it (still making its last calls) and a turn of another run are other turns; another job is another job
                expect(await b.accepted('k', { turn: 0, run: 'run-1' })).toBe(true);
                expect(await b.accepted('k', { turn: 1, run: 'run-other' })).toBe(true);
                await begin(a, 'other-job', 1, 'run-1');
                expect(await b.accepted('other-job', { turn: 1, run: 'run-1' })).toBe(true);
                // the turn after it is a turn of its own
                advance(10);
                await begin(a, 'k', 2, 'run-1');
                expect(await b.accepted('k', { turn: 2, run: 'run-1' })).toBe(true);
                expect(a.accepted('k', { turn: 2, run: 'run-1' })).toBeUndefined();
                // and a fence no longer counts once it is long past (FENCE_LIFE_MS), a call whose turn is known or not
                expect(await b.accepted('k')).toBe(false);
                expect(await b.accepted('k', { turn: 1, run: 'run-1' })).toBe(false);
                advance(fencedAt + FENCE_LIFE_MS - now());
                expect(await b.accepted('k', { turn: 1, run: 'run-1' })).toBe(false);
                advance(1);
                expect(await b.accepted('k', { turn: 1, run: 'run-1' })).toBe(true);
                expect(await b.accepted('k')).toBe(true);
            });

            it('does not close a turn that has a call taken up on another server (of that turn, or one whose turn was not known), and takes calls as before', async () => {
                const { a, b, advance } = rigTurns();
                for (const [job, turn] of [['j1', { turn: 1, run: 'run-1' }], ['j2', undefined]] as const) {
                    await begin(a, job, 1, 'run-1');
                    const since = a.mark();
                    advance(10);
                    expect(await b.accepted(job, turn), job).toBe(true);
                    expect(await a.closeTurn(job, since), job).toBe(false);
                    // nothing was fenced: the turn goes on taking calls, here and on the other server
                    expect(await b.accepted(job, { turn: 1, run: 'run-1' }), job).toBe(true);
                    expect(a.accepted(job, { turn: 1, run: 'run-1' }), job).not.toBe(false);
                }
                // a call of ANOTHER turn taken up is no call of this one
                await begin(a, 'j3', 2, 'run-1');
                const since = a.mark();
                expect(await b.accepted('j3', { turn: 1, run: 'run-1' })).toBe(true);
                expect(await a.closeTurn('j3', since)).toBe(true);
            });

            it('is either closed or taken up, never both, in whichever order the two reach the store', async () => {
                for (const closeFirst of [true, false]) {
                    const { a, b, advance } = rigTurns();
                    await begin(a, 'race', 1, 'run-1');
                    const since = a.mark();
                    advance(10);
                    const asked = [() => a.closeTurn('race', since), () => b.accepted('race', { turn: 1, run: 'run-1' })];
                    if (!closeFirst) asked.reverse();
                    const answers = await Promise.all(asked.map((ask) => ask()));
                    const [closed, taken] = closeFirst ? answers : [...answers].reverse();
                    expect(closed !== taken, `closeFirst ${closeFirst}`).toBe(true);
                    // and the later of the two is the one refused
                    expect(closeFirst ? taken : closed).toBe(false);
                }
            });

            it('takes a call up here again when the close is refused (a call was taken up elsewhere): the server of the runner is not left refusing', async () => {
                const { a, b, advance } = rigTurns();
                await begin(a, 'j', 1, 'run-1');
                const since = a.mark();
                advance(10);
                await b.accepted('j', { turn: 1, run: 'run-1' });
                expect(await a.closeTurn('j', since)).toBe(false);
                expect(a.accepted('j', { turn: 1, run: 'run-1' })).not.toBe(false);
                expect(a.acceptedSince('j', since)).toBe(true);
            });

            describe('a close whose answer is lost', () => {
                it('asks again when the answer is lost: lost then confirmed gives the turn up once (one fence, no retraction)', async () => {
                    const { a, b, store, advance } = rigTurns();
                    await begin(a, 'lost-then-1', 1, 'run-1');
                    const since = a.mark();
                    advance(10);
                    // the script ran and its answer was lost; the second try (the script is idempotent) says it is done
                    store.state.lostAfterClose = 1;
                    expect(await a.closeTurn('lost-then-1', since)).toBe(true);
                    expect(store.state.retracted).toBe(0);
                    expect(await b.accepted('lost-then-1', { turn: 1, run: 'run-1' })).toBe(false);
                    // up to two more tries: a third that answers is still the give-up
                    await begin(a, 'third', 1, 'run-1');
                    store.state.lostAfterClose = 2;
                    expect(await a.closeTurn('third', a.mark())).toBe(true);
                    expect(store.state.retracted).toBe(0);
                });

                it('lost, then the store answers 0 (a call was taken up meanwhile): the fence of the lost try is retracted and the turn goes on', async () => {
                    const { a, b, store, advance } = rigTurns();
                    await begin(a, 'lost-then-0', 1, 'run-1');
                    const since = a.mark();
                    advance(10);
                    store.state.failClose = 1;
                    // between the tries another server takes a call of the turn up
                    store.state.betweenTries = async () => b.accepted('lost-then-0', { turn: 1, run: 'run-1' });
                    expect(await a.closeTurn('lost-then-0', since)).toBe(false);
                    expect(store.state.retracted).toBe(1);
                    // the turn goes on: this server takes calls again, and the other server's are taken
                    expect(a.accepted('lost-then-0', { turn: 1, run: 'run-1' })).not.toBe(false);
                    expect(await b.accepted('lost-then-0', { turn: 1, run: 'run-1' })).toBe(true);
                });

                it('no try answers (three lost): the fence is retracted, and a later acceptance from another server is taken, not refused', async () => {
                    const { a, b, store, advance } = rigTurns();
                    await begin(a, 'lost', 1, 'run-1');
                    const since = a.mark();
                    advance(10);
                    store.state.lostAfterClose = 3;
                    expect(await a.closeTurn('lost', since)).toBe(false);
                    expect(store.state.retracted).toBe(1);
                    expect(await b.accepted('lost', { turn: 1, run: 'run-1' })).toBe(true);
                    expect(await b.accepted('lost')).toBe(true);
                    expect(a.accepted('lost', { turn: 1, run: 'run-1' })).not.toBe(false);
                });

                it('does not retract what it did not write: the store refusing the close (a call was taken up) leaves nothing to retract', async () => {
                    const { a, b, store, advance } = rigTurns();
                    await begin(a, 'taken', 1, 'run-1');
                    const since = a.mark();
                    advance(10);
                    await b.accepted('taken', { turn: 1, run: 'run-1' });
                    expect(await a.closeTurn('taken', since)).toBe(false);
                    expect(store.state.retracted).toBe(0);
                });

                it('tries the retraction again when it does not answer, and the fence is gone once one answer comes', async () => {
                    const { a, b, store, advance } = rigTurns();
                    await begin(a, 'again', 1, 'run-1');
                    const since = a.mark();
                    advance(10);
                    store.state.lostAfterClose = 3;
                    store.state.failRetract = 2;
                    expect(await a.closeTurn('again', since)).toBe(false);
                    expect(store.state.retracted).toBe(1);
                    expect(await b.accepted('again', { turn: 1, run: 'run-1' })).toBe(true);
                });

                it('the local close is rolled back only after the retraction is settled: a call here while the fence is being taken back is still refused, and is taken again after', async () => {
                    const { a, store, advance } = rigTurns();
                    await begin(a, 'order', 1, 'run-1');
                    const since = a.mark();
                    advance(10);
                    store.state.lostAfterClose = 3;
                    let release!: () => void;
                    store.state.holdRetract = new Promise<void>((resolve) => (release = resolve));
                    const closing = a.closeTurn('order', since);
                    // the retraction is being asked: the turn is still closed here
                    await vi.waitFor(() => expect(store.state.retractWaiting).toBe(1));
                    expect(a.accepted('order', { turn: 1, run: 'run-1' })).toBe(false);
                    release();
                    expect(await closing).toBe(false);
                    expect(a.accepted('order', { turn: 1, run: 'run-1' })).not.toBe(false);
                });

                it('a late reopen of an OLDER close never lifts a NEWER close on this server or in the store: the guard of reopenTurn names the very close (turn and moment)', async () => {
                    // (a) the same turn closed again at a new moment: the newer fence still refuses calls here and on another server
                    {
                        const { a, b, advance } = rigTurns();
                        await begin(a, 'same', 1, 'run-1');
                        advance(10);
                        const first: CloseAttempt = {};
                        expect(await a.closeTurn('same', a.mark(), first)).toBe(true);
                        advance(10);
                        const newer: CloseAttempt = {};
                        expect(await a.closeTurn('same', a.mark(), newer)).toBe(true);
                        expect(newer.at).not.toBe(first.at);
                        await a.reopenTurn('same', first);
                        expect(a.accepted('same', { turn: 1, run: 'run-1' })).toBe(false);
                        expect(await b.accepted('same', { turn: 1, run: 'run-1' })).toBe(false);
                        // and the newer close is taken back by its own attempt: then both take calls
                        await a.reopenTurn('same', newer);
                        expect(a.accepted('same', { turn: 1, run: 'run-1' })).not.toBe(false);
                        expect(await b.accepted('same', { turn: 1, run: 'run-1' })).toBe(true);
                    }
                    // (b) a later turn closed: the older turn's attempt leaves the newer turn's close alone
                    {
                        const { a, b, advance } = rigTurns();
                        await begin(a, 'later', 1, 'run-1');
                        advance(10);
                        const first: CloseAttempt = {};
                        expect(await a.closeTurn('later', a.mark(), first)).toBe(true);
                        advance(10);
                        await begin(a, 'later', 2, 'run-1');
                        advance(10);
                        const newer: CloseAttempt = {};
                        expect(await a.closeTurn('later', a.mark(), newer)).toBe(true);
                        await a.reopenTurn('later', first);
                        expect(a.accepted('later', { turn: 2, run: 'run-1' })).toBe(false);
                        expect(await b.accepted('later', { turn: 2, run: 'run-1' })).toBe(false);
                        // the older turn's fence is the one that went
                        expect(await b.accepted('later', { turn: 1, run: 'run-1' })).toBe(true);
                    }
                    // (c) two closes of two turns in the SAME millisecond: the moment alone does not name a close, the turn does too
                    {
                        const { a, b, advance } = rigTurns();
                        await begin(a, 'tie', 1, 'run-1');
                        advance(10);
                        const first: CloseAttempt = {};
                        expect(await a.closeTurn('tie', a.mark(), first)).toBe(true);
                        await begin(a, 'tie', 2, 'run-1');
                        const newer: CloseAttempt = {};
                        expect(await a.closeTurn('tie', a.mark(), newer)).toBe(true);
                        expect(newer.at).toBe(first.at);
                        await a.reopenTurn('tie', first);
                        expect(a.accepted('tie', { turn: 2, run: 'run-1' })).toBe(false);
                        expect(await b.accepted('tie', { turn: 2, run: 'run-1' })).toBe(false);
                    }
                });

                const row = (id: string, over: Partial<Parameters<ReturnType<typeof createRefusalNotes>['record']>[2]> = {}) => ({ callId: id, kind: 'fault' as const, reason: 'relay_down' as const, source: 'universe-ai' as const, route: 'unknown', providerStatus: 503 as number | null, ...over });

                it('a call refused by the close itself leaves no provisional fault behind: when the close is taken back and the turn then fails, the person’s allowance refusal that came in during the close decides, not a fault of ours', async () => {
                    const { a, advance } = rigTurns();
                    await begin(a, 'cr', 1, 'run-1');
                    const since = a.mark();
                    advance(10);
                    const attempt: CloseAttempt = {};
                    expect(await a.closeTurn('cr', since, attempt)).toBe(true);
                    // during the close: a call is refused BECAUSE of it (its row is still written), and the person's allowance refuses another
                    expect(a.accepted('cr', { turn: 1, run: 'run-1' }, 'refused-by-close')).toBe(false);
                    a.record('bot', 'cr', row('refused-by-close', { turn: 1, run: 'run-1' }));
                    a.record('bot', 'cr', row('allowance-1', { kind: 'not_ours', reason: 'allowance', providerStatus: 429, turn: 1, run: 'run-1' }));
                    // the runner takes the close back and the turn then fails with no answer
                    await a.reopenTurn('cr', attempt);
                    expect(a.confirmedSince('cr', since)).toBe(false);
                    expect(a.endedOnFault('cr', since)).toBe(false);
                    expect(a.sawSince('cr', since)).toBe(true);
                });

                it('a fault of ours that is not the close’s own doing still counts, in the same turn', async () => {
                    const { a, advance } = rigTurns();
                    await begin(a, 'cr2', 1, 'run-1');
                    const since = a.mark();
                    advance(10);
                    const attempt: CloseAttempt = {};
                    expect(await a.closeTurn('cr2', since, attempt)).toBe(true);
                    expect(a.accepted('cr2', { turn: 1, run: 'run-1' }, 'refused-by-close')).toBe(false);
                    a.record('bot', 'cr2', row('refused-by-close', { turn: 1, run: 'run-1' }));
                    a.record('bot', 'cr2', row('route-gone', { reason: 'route_unknown', turn: 1, run: 'run-1' }));
                    await a.reopenTurn('cr2', attempt);
                    expect(a.confirmedSince('cr2', since)).toBe(true);
                    expect(a.endedOnFault('cr2', since)).toBe(true);
                });

                describe('a give-up that is gone on with is COMMITTED (GPT round 3, finding 4)', () => {
                    const closeFor = async (job: string, advanceMs = 10) => {
                        const rig = rigTurns();
                        await begin(rig.a, job, 1, 'run-1');
                        const since = rig.a.mark();
                        rig.advance(advanceMs);
                        const attempt: CloseAttempt = {};
                        expect(await rig.a.closeTurn(job, since, attempt)).toBe(true);
                        return { ...rig, since, attempt };
                    };

                    it('commits the fence of the close, so a call of the turn that another server takes up refuses for as long as the job lives: not only FENCE_LIFE_MS, and not after the turn after it is over either', async () => {
                        const { a, b, store, attempt, advance } = await closeFor('cm');
                        expect(await a.commitTurn!('cm', attempt)).toBe(true);
                        expect(attempt.committed).toBe(true);
                        // delayed finalization: the cancel and the finish take well over a fence's life
                        advance(FENCE_LIFE_MS * 4);
                        expect(await b.accepted('cm', { turn: 1, run: 'run-1' })).toBe(false);
                        expect(a.accepted('cm', { turn: 1, run: 'run-1' })).toBe(false);
                        // an unrelated new turn (the next of the run) and another run are not touched
                        expect(await b.accepted('cm', { turn: 2, run: 'run-1' })).toBe(true);
                        expect(await b.accepted('cm', { turn: 1, run: 'run-2' })).toBe(true);
                        expect(store.state.commitAsked).toBe(1);
                    });

                    it('keeps the short life when it is not committed: an abandoned close (the runner took it back and the retraction did not answer) clears itself', async () => {
                        const { b, store, attempt, a, advance } = await closeFor('ab');
                        store.state.failRetract = 3;
                        await a.reopenTurn('ab', attempt);
                        expect(attempt.committed).toBeUndefined();
                        expect(await b.accepted('ab', { turn: 1, run: 'run-1' })).toBe(false);
                        advance(FENCE_LIFE_MS + 5);
                        expect(await b.accepted('ab', { turn: 1, run: 'run-1' })).toBe(true);
                    });

                    it('never takes a committed close back with reopenTurn: not here and not in the store', async () => {
                        const { a, b, store, attempt, advance } = await closeFor('nr');
                        expect(await a.commitTurn!('nr', attempt)).toBe(true);
                        await a.reopenTurn('nr', attempt);
                        expect(store.state.retracted).toBe(0);
                        advance(FENCE_LIFE_MS * 2);
                        expect(a.accepted('nr', { turn: 1, run: 'run-1' })).toBe(false);
                        expect(await b.accepted('nr', { turn: 1, run: 'run-1' })).toBe(false);
                    });

                    it('says no, and commits nothing, for a close that no longer stands (another close of the turn took its place, or the fence is gone from the store): the turn is not given up on it', async () => {
                        const first = await closeFor('gone');
                        // the fence of that close leaves the store (taken back by someone, or it expired)
                        first.attempt.at = (first.attempt.at ?? 0) + 1;
                        expect(await first.a.commitTurn!('gone', first.attempt)).toBe(false);
                        expect(first.attempt.committed).toBeUndefined();
                        const gone = await closeFor('gone2');
                        await gone.a.reopenTurn('gone2', gone.attempt);
                        expect(await gone.a.commitTurn!('gone2', gone.attempt)).toBe(false);
                        // a close taken back HERE (its retraction in the store did not answer: the tentative fence is still there) is no close to commit: the turn goes on, and the
                        // store is not asked to commit a fence the runner no longer stands behind
                        const taken = await closeFor('gone-local');
                        taken.store.state.failRetract = 3;
                        await taken.a.reopenTurn('gone-local', taken.attempt);
                        const asked = taken.store.state.commitAsked;
                        expect(await taken.a.commitTurn!('gone-local', taken.attempt)).toBe(false);
                        expect(taken.store.state.commitAsked).toBe(asked);
                        expect(taken.attempt.committed).toBeUndefined();
                        // the store has no fence of that moment either: the close stands here no more, so it is false at once
                        const store = await closeFor('gone3');
                        store.store.state.failRetract = 0;
                        const shared = (store.store.forServer('A')) as { retractFence: (job: string, turn: unknown, at: number) => Promise<void> };
                        await shared.retractFence('gone3', store.attempt.turn, store.attempt.at as number);
                        expect(await store.a.commitTurn!('gone3', store.attempt)).toBe(false);
                    });

                    it('does NOT go on with the give-up when the store never says whether the fence is committed (every try fails): the commit is unconfirmed, the turn is not given up, and reopening takes the fence back whichever way it stands', async () => {
                        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
                        const down = await closeFor('lost');
                        down.store.state.failCommit = 3;
                        expect(await down.a.commitTurn!('lost', down.attempt)).toBe(false);
                        expect(down.store.state.commitAsked).toBe(3);
                        expect(down.attempt.committed).toBeUndefined();
                        expect(down.attempt.unconfirmed).toBe(true);
                        // the store is back: the runner takes the close back and the turn goes on; the fence leaves the store, and the turn takes calls again at once
                        await down.a.reopenTurn('lost', down.attempt);
                        expect(await down.b.accepted('lost', { turn: 1, run: 'run-1' })).toBe(true);
                        // the same when the script RAN each time and only its answers were lost: the fence IS committed in the store, and it is taken back all the same (the turn is alive)
                        const ran = await closeFor('lost-ran');
                        ran.store.state.commitLostAfter = 3;
                        expect(await ran.a.commitTurn!('lost-ran', ran.attempt)).toBe(false);
                        expect(ran.attempt.unconfirmed).toBe(true);
                        expect(ran.attempt.committed).toBeUndefined();
                        ran.advance(FENCE_LIFE_MS * 4);
                        // (a committed fence refuses at any time while it stands)
                        expect(await ran.b.accepted('lost-ran', { turn: 1, run: 'run-1' })).toBe(false);
                        await ran.a.reopenTurn('lost-ran', ran.attempt);
                        expect(await ran.b.accepted('lost-ran', { turn: 1, run: 'run-1' })).toBe(true);
                        expect(ran.a.accepted('lost-ran', { turn: 1, run: 'run-1' })).not.toBe(false);
                        warn.mockRestore();
                        // an answer lost after the script ran, once: the second try finds the fence committed (the same answer to say twice), and the give-up goes on
                        const late = await closeFor('lost-after');
                        late.store.state.commitLostAfter = 1;
                        expect(await late.a.commitTurn!('lost-after', late.attempt)).toBe(true);
                        expect(late.store.state.commitAsked).toBe(2);
                        expect(late.attempt.committed).toBe(true);
                        expect(late.attempt.unconfirmed).toBeUndefined();
                    });

                    it('does not retract a COMMITTED fence on a plain reopen (only an unconfirmed commit takes it back): a fence the store said is committed stays', async () => {
                        const done = await closeFor('plain');
                        expect(await done.a.commitTurn!('plain', done.attempt)).toBe(true);
                        await done.a.reopenTurn('plain', done.attempt);
                        done.advance(FENCE_LIFE_MS * 2);
                        expect(await done.b.accepted('plain', { turn: 1, run: 'run-1' })).toBe(false);
                    });

                    it('asks the store to commit from the moment the close counted from, and refuses to commit over a call another server took up after the fence had cleared itself: the turn is not given up, and the close is taken back', async () => {
                        const rig = await closeFor('late-call', 10);
                        // the store is asked from the turn's start (the same moment the close counted from)
                        const slow = await closeFor('late-call-2', 10);
                        slow.advance(FENCE_LIFE_MS + 5);
                        // the fence has cleared itself: the relay of another server takes a call of the turn up
                        expect(await slow.b.accepted('late-call-2', { turn: 1, run: 'run-1' })).toBe(true);
                        expect(await slow.a.commitTurn!('late-call-2', slow.attempt)).toBe(false);
                        expect(slow.attempt.committed).toBeUndefined();
                        expect(slow.attempt.unconfirmed).toBeUndefined();
                        expect(slow.store.state.commitFrom).toEqual([slow.attempt.from]);
                        expect(typeof slow.attempt.from).toBe('number');
                        // reopening takes the (uncommitted) fence away, and the turn goes on
                        await slow.a.reopenTurn('late-call-2', slow.attempt);
                        expect(await slow.b.accepted('late-call-2', { turn: 1, run: 'run-1' })).toBe(true);
                        // without such a call the commit goes through, even this long after the close
                        rig.advance(FENCE_LIFE_MS + 5);
                        expect(await rig.a.commitTurn!('late-call', rig.attempt)).toBe(true);
                        expect(rig.attempt.committed).toBe(true);
                    });

                    it('does not commit a close of a turn whose number is not known (its fence keeps FENCE_LIFE_MS), and without a shared store the close stands here alone', async () => {
                        const noTurn = rigTurns();
                        const attempt: CloseAttempt = {};
                        expect(await noTurn.a.closeTurn('unk', noTurn.a.mark(), attempt)).toBe(true);
                        expect(attempt.turn).toBeUndefined();
                        expect(await noTurn.a.commitTurn!('unk', attempt)).toBe(true);
                        expect(noTurn.store.state.commitAsked).toBe(0);
                        const alone = createRefusalNotes(() => 1000);
                        const own: CloseAttempt = {};
                        alone.turn('solo', 1, 'run-1');
                        expect(await alone.closeTurn('solo', alone.mark(), own)).toBe(true);
                        expect(await alone.commitTurn!('solo', own)).toBe(true);
                        expect(own.committed).toBe(true);
                    });

                    it('takes the committed fence back once the finish is accepted (the turn takes calls again, here and in the store), tolerates a store that fails, and a stale or later close of another moment stays', async () => {
                        const done = await closeFor('rel');
                        expect(await done.a.commitTurn!('rel', done.attempt)).toBe(true);
                        done.store.state.failRelease = 1;
                        await done.a.releaseTurn!('rel', done.attempt);
                        expect(done.store.state.released).toBe(1);
                        done.advance(FENCE_LIFE_MS * 2);
                        expect(await done.b.accepted('rel', { turn: 1, run: 'run-1' })).toBe(true);
                        // and here: the turn takes calls again on the runner's own server
                        expect(done.a.accepted('rel', { turn: 1, run: 'run-1' })).not.toBe(false);
                        // a store that does not answer: never throws, the fence ends with the job's evidence
                        const stuck = await closeFor('rel2');
                        expect(await stuck.a.commitTurn!('rel2', stuck.attempt)).toBe(true);
                        stuck.store.state.down = true;
                        await expect(stuck.a.releaseTurn!('rel2', stuck.attempt)).resolves.toBeUndefined();
                        // a release with nothing named does nothing
                        await expect(stuck.a.releaseTurn!('rel2', {})).resolves.toBeUndefined();
                    });
                });

                it('a call that arrived in a turn change (its turn could not be told) is sent with no turn and changes none of the active turn’s notes: no confirmed fault, no answer, no refusal for the runner to read', async () => {
                    let at = 100_000;
                    const store = sharedStore();
                    const sent: CallRow[] = [];
                    const a = createRefusalNotes(() => at, { shared: store.forServer('A'), runsHere: () => true, retryMs: [0], sink: async (_bot, _job, rows) => (sent.push(...rows.map((one) => ({ ...one }))), true) });
                    await begin(a, 'nt', 1, 'run-1');
                    const since = a.mark();
                    at += 10;
                    a.record('bot', 'nt', row('c-fault', { turn: null }));
                    a.record('bot', 'nt', row('c-allowance', { kind: 'not_ours', reason: 'allowance', providerStatus: 429, turn: null }));
                    a.record('bot', 'nt', row('c-answered', { kind: 'answered' as never, reason: 'provider_5xx', providerStatus: 200, turn: null }));
                    expect(a.confirmedSince('nt', since)).toBe(false);
                    expect(a.endedOnFault('nt', since)).toBe(false);
                    expect(a.sawSince('nt', since)).toBe(false);
                    // the durable rows are written, with no turn (Orbit reads them against every turn it judges)
                    await a.flush('nt');
                    // (the complete output: the answer is never sent, it is no row)
                    expect(sent.map((one) => [one.callId, one.turn])).toEqual([['c-fault', null], ['c-allowance', null]]);
                    // a call of the active turn and run still counts
                    a.record('bot', 'nt', row('c-here', { turn: 1, run: 'run-1' }));
                    expect(a.confirmedSince('nt', since)).toBe(true);
                });

                it('an answer of a call with no turn does not clear a fault of the active turn, and an answer of the active turn does', async () => {
                    const { a, advance } = rigTurns();
                    await begin(a, 'nt2', 1, 'run-1');
                    const since = a.mark();
                    advance(10);
                    a.record('bot', 'nt2', row('active-fault', { turn: 1, run: 'run-1' }));
                    expect(a.confirmedSince('nt2', since)).toBe(true);
                    expect(a.endedOnFault('nt2', since)).toBe(true);
                    // an answer that arrived in a turn change is no answer of this turn: the fault stands
                    advance(10);
                    a.record('bot', 'nt2', row('unplaced-answer', { kind: 'answered' as never, reason: 'provider_5xx', providerStatus: 200, turn: null }));
                    expect(a.confirmedSince('nt2', since)).toBe(true);
                    expect(a.endedOnFault('nt2', since)).toBe(true);
                    // an answer of the active turn and run recovers it
                    advance(10);
                    a.record('bot', 'nt2', row('active-answer', { kind: 'answered' as never, reason: 'provider_5xx', providerStatus: 200, turn: 1, run: 'run-1' }));
                    expect(a.confirmedSince('nt2', since)).toBe(false);
                    expect(a.endedOnFault('nt2', since)).toBe(false);
                });

                it('when the fence cannot be taken back either, it clears itself after FENCE_LIFE_MS: the other server’s call is refused until then (a fault of ours, the machine tries again), and taken after', async () => {
                    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
                    try {
                        const { a, b, store, advance } = rigTurns();
                        await begin(a, 'stuck', 1, 'run-1');
                        const since = a.mark();
                        advance(10);
                        store.state.lostAfterClose = 3;
                        store.state.failRetract = 3;
                        const closedAt = Date.now();
                        expect(await a.closeTurn('stuck', since)).toBe(false);
                        expect(warned).toHaveBeenCalled();
                        // the runner's own server takes calls again
                        expect(a.accepted('stuck', { turn: 1, run: 'run-1' })).not.toBe(false);
                        // the fence is in the store: the other server's call of that turn is refused (and one whose turn is not known)
                        expect(await b.accepted('stuck', { turn: 1, run: 'run-1' })).toBe(false);
                        expect(await b.accepted('stuck')).toBe(false);
                        // a long while later the fence no longer counts
                        advance(FENCE_LIFE_MS + 5);
                        expect(await b.accepted('stuck', { turn: 1, run: 'run-1' })).toBe(true);
                        void closedAt;
                    } finally {
                        warned.mockRestore();
                    }
                });

                it('never takes back the fence of a LATER close of the same turn: only the very moment it wrote goes', async () => {
                    const { a, b, store, advance } = rigTurns();
                    await begin(a, 'later', 1, 'run-1');
                    const since = a.mark();
                    advance(10);
                    // a first close that did not commit and could not be retracted, then a second that did
                    store.state.lostAfterClose = 3;
                    store.state.failRetract = 3;
                    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
                    try {
                        expect(await a.closeTurn('later', since)).toBe(false);
                    } finally {
                        warned.mockRestore();
                    }
                    advance(10);
                    expect(await a.closeTurn('later', since)).toBe(true);
                    expect(await b.accepted('later', { turn: 1, run: 'run-1' })).toBe(false);
                });
            });

            it('does not close a turn it took a call up for here before, and not when the store cannot do the step (it fails, or has no such step): nothing is fenced and nothing is refused', async () => {
                const { a, store, b, advance } = rigTurns();
                await begin(a, 'j', 1, 'run-1');
                const since = a.mark();
                advance(10);
                a.accepted('j', { turn: 1, run: 'run-1' });
                expect(await a.closeTurn('j', since)).toBe(false);
                // the store failing all three tries
                await begin(a, 'down', 1, 'run-1');
                const s2 = a.mark();
                store.state.failClose = 3;
                expect(await a.closeTurn('down', s2)).toBe(false);
                expect(a.accepted('down', { turn: 1, run: 'run-1' })).not.toBe(false);
                expect(await b.accepted('down', { turn: 1, run: 'run-1' })).toBe(true);
                // one try failing is tried again
                await begin(a, 'again', 1, 'run-1');
                store.state.failClose = 1;
                expect(await a.closeTurn('again', a.mark())).toBe(true);
                // a store with acceptances but no way to close as one step gives nothing to rest a give-up on
                const plain = store.forServer('P');
                const noStep = createRefusalNotes(() => 1000, { shared: { ...plain, closeTurn: undefined }, runsHere: () => true });
                noStep.turn('j', 1, 'run-1');
                expect(await noStep.closeTurn('j', noStep.mark())).toBe(false);
                // and with no shared store at all (one server) it is the server's own notes alone
                const alone = createRefusalNotes(() => 1000, { runsHere: () => true });
                alone.turn('j', 1);
                expect(await alone.closeTurn('j', alone.mark())).toBe(true);
                expect(alone.accepted('j', { turn: 1 })).toBe(false);
            });
        });

        it('ties a call that arrives between the moment a turn was noted and the moment the runner went on to work it to no later turn: a straggler of the turn before is never given the new turn', async () => {
            const { a, b, advance } = rigTurns();
            await begin(a, 'j', 4, 'run-1');
            advance(10_000);
            // turn 5 is noted at 110 000 (and told as pending); the runner goes on to work it at 114 500
            a.turn('j', 5, 'run-1');
            await Promise.resolve();
            // a call of turn 4 that arrives at 112 000: the turn is not begun, so it is no call of it
            expect((await b.turnOfCall('j', { order: 1, at: 112_000 })).turn).toBeNull();
            advance(4500);
            await a.turnPublished!('j');
            // now told from the moment the runner went on: the straggler is turn 4's, and a call well after it is turn 5's
            expect(await b.turnOfCall('j', { order: 1, at: 112_000 })).toEqual({ turn: 4, run: 'run-1' });
            expect(await b.turnOfCall('j', { order: 1, at: 117_000 })).toEqual({ turn: 5, run: 'run-1' });
            // near the moment it went on, the clocks cannot tell
            expect((await b.turnOfCall('j', { order: 1, at: 115_000 })).turn).toBeNull();
        });

        it('leaves a turn pending when the message that it went on cannot be written: calls after it are given no turn until the next list says it, and never the turn before', async () => {
            const { a, b, store, advance } = rigTurns();
            await begin(a, 'j', 4, 'run-1');
            advance(10_000);
            a.turn('j', 5, 'run-1');
            await Promise.resolve();
            store.state.failTurns = 100;
            advance(1000);
            await a.turnPublished!('j');
            await Promise.resolve();
            expect((await b.turnOfCall('j', { order: 1, at: 113_000 })).turn).toBeNull();
            // the store is back: the next renewal tells that the turn began
            store.state.failTurns = 0;
            advance(1500);
            a.turn('j', 5, 'run-1');
            await Promise.resolve();
            expect(await b.turnOfCall('j', { order: 1, at: 114_000 })).toEqual({ turn: 5, run: 'run-1' });
        });

        it('does not begin a job taken over while the promise of the runner it was taken over from still stands, when the lists of its own cannot be written: it waits that promise out, and with a store that works it begins at once', async () => {
            vi.useFakeTimers();
            try {
                let clock = 100_000;
                const store = sharedStore();
                // the runner on server A, then the job moves to the runner on server B, and a third server C is where the machine's calls land
                const a = createRefusalNotes(() => clock, { shared: store.forServer('A'), runsHere: () => true });
                const b = createRefusalNotes(() => clock, { shared: store.forServer('B'), runsHere: () => true });
                const c = createRefusalNotes(() => clock, { shared: store.forServer('C'), runsHere: () => false });
                a.turn('j', 4, 'run-1');
                await a.turnPublished!('j');
                // B's first turn of the job: its writes are lost
                store.state.failTurns = 1000;
                clock += 1000;
                b.turn('j', 1, 'run-2');
                let begun = false;
                const waiting = b.turnPublished!('j').then(() => (begun = true));
                await vi.advanceTimersByTimeAsync(1500);
                // A's promise (until 106 000) can still be read by C as covering: B does not begin
                expect(begun).toBe(false);
                expect((await c.turnOfCall('j', { order: 1, at: 103_000 })).turn).toBe(4);
                clock += SHARED_TURN_LEASE_MS;
                await vi.advanceTimersByTimeAsync(1000);
                await waiting;
                expect(begun).toBe(true);
                // and A's promise has run out: nothing covers a call, and C does not give it A's run
                expect(await c.turnOfCall('j', { order: 1, at: clock - SHARED_CALL_SKEW_MS })).toEqual({ turn: null });
                // with a store that works the job begins at once: two promises cover the arrival for a while, and the call gets no turn rather than A's
                store.state.failTurns = 0;
                clock += 1000;
                const d = createRefusalNotes(() => clock, { shared: store.forServer('D'), runsHere: () => true });
                a.turn('j', 5, 'run-1');
                await a.turnPublished!('j');
                clock += 500;
                let began = false;
                d.turn('j', 1, 'run-3');
                void d.turnPublished!('j').then(() => (began = true));
                for (let turns = 0; turns < 20; turns++) await Promise.resolve();
                expect(began).toBe(true);
                expect((await c.turnOfCall('j', { order: 1, at: clock + 3000 })).turn).toBeNull();
            } finally {
                vi.useRealTimers();
            }
        });

        describe('which turn a call is of when it reaches the runner’s own server while the runner changes turns', () => {
            it('does not give a call the turn that was merely noted: a call that arrived after turn 5 was noted and before the runner went on to work it is of no clear turn, while calls before and after keep theirs', async () => {
                const { a, advance } = rigTurns();
                await begin(a, 'j', 4, 'run-1');
                advance(10);
                const duringFour = a.mark();
                advance(10);
                // turn 5 is noted (its list is being published) but the runner has not gone on to work it
                a.turn('j', 5, 'run-1');
                const inTransition = a.mark();
                advance(10);
                const stillInTransition = a.mark();
                // before the turn was noted: turn 4; between the two events: neither, by either way of asking
                expect(a.turnAt('j', duringFour)).toEqual({ turn: 4, run: 'run-1' });
                expect(a.turnAt('j', inTransition)).toEqual({ turn: null });
                expect(await a.turnOfCall('j', { ...inTransition })).toEqual({ turn: null });
                expect(await a.turnOfCall('j', { ...stillInTransition })).toEqual({ turn: null });
                // the runner goes on to work turn 5: a call that arrived BEFORE that stays unattributed (it is not read as turn 5 once turn 5 has begun), one after is turn 5
                await a.turnPublished!('j');
                advance(10);
                const after = a.mark();
                expect(a.turnAt('j', inTransition)).toEqual({ turn: null });
                expect(await a.turnOfCall('j', { ...stillInTransition })).toEqual({ turn: null });
                expect(a.turnAt('j', duringFour)).toEqual({ turn: 4, run: 'run-1' });
                expect(a.turnAt('j', after)).toEqual({ turn: 5, run: 'run-1' });
                expect(await a.turnOfCall('j', { ...after })).toEqual({ turn: 5, run: 'run-1' });
            });

            it('a call that arrives while the very first turn of a job is being published is unattributed too, and a reconnect to the turn going (the same turn said again) changes nothing', async () => {
                const { a, advance } = rigTurns();
                a.turn('first', 1, 'run-1');
                const during = a.mark();
                expect(a.turnAt('first', during)).toEqual({ turn: null });
                await a.turnPublished!('first');
                advance(10);
                const after = a.mark();
                expect(a.turnAt('first', after)).toEqual({ turn: 1, run: 'run-1' });
                // the same turn said again is the same turn: it keeps the moment it began
                a.turn('first', 1, 'run-1');
                expect(a.turnAt('first', a.mark())).toEqual({ turn: 1, run: 'run-1' });
                expect(a.turnAt('first', during)).toEqual({ turn: null });
            });

            it('with no shared store there is nothing to wait for: the turn that was noted is the turn begun, as before', async () => {
                const alone = createRefusalNotes(() => 1000, { runsHere: () => true });
                alone.turn('j', 4, 'run-1');
                alone.turn('j', 5, 'run-1');
                expect(alone.turnAt('j', alone.mark())).toEqual({ turn: 5, run: 'run-1' });
                expect(await alone.turnOfCall('j', alone.mark())).toEqual({ turn: 5, run: 'run-1' });
            });

            it('writes the row of such a call with no turn (Orbit reads it with every turn it judges), and leaves the row of a call that is clearly in turn 5 with turn 5', async () => {
                const rows: CallRow[] = [];
                const keeper = createRefusalNotes(() => 100_000, { shared: sharedStore().forServer('K'), runsHere: () => true, sink: async (_bot, _job, sent) => (rows.push(...sent), true) });
                await begin(keeper, 'j', 4, 'run-1');
                keeper.turn('j', 5, 'run-1');
                const arrived = keeper.mark();
                const there = await keeper.turnOfCall('j', arrived);
                keeper.record('bot', 'j', { ...fault('x'), turn: there.turn, ...(there.run ? { run: there.run } : {}) });
                await keeper.flush('j');
                expect(rows.map((row) => row.turn)).toEqual([null]);
            });
        });

        it('never ends a turn the runner is on as a fault of its own for a call made on the other server: a null-turn row leaves the runner’s own notes of the turn alone', async () => {
            const { a, b, advance } = rigTurns();
            await begin(a, 'j', 1, 'run-1');
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
                    // The two scripts of the fence, in JavaScript (the Lua of both is run against a real Redis in `ComputerEvidenceStore.redis.test.ts`)
                    if (script === CLOSE_TURN) {
                        const [instance, turn, run, earliest, fenceField, fenceAt, seconds] = options.arguments;
                        const hash = hashes.get(options.keys[0]) ?? {};
                        for (const [field, value] of Object.entries(hash)) {
                            if (!field.startsWith('accepted:')) continue;
                            const rest = field.slice('accepted:'.length);
                            const bar = rest.indexOf('|');
                            const who = bar < 0 ? rest : rest.slice(0, bar);
                            const counts = bar < 0 || turn === '' || rest.slice(bar + 1) === `${turn}|${run}`;
                            const at = Number(value);
                            if (who !== instance && counts && !Number.isNaN(at) && at >= Number(earliest)) return 0;
                        }
                        hashes.set(options.keys[0], { ...hash, [fenceField]: fenceAt });
                        ttl.set(options.keys[0], Number(seconds));
                        return 1;
                    }
                    if (script === RETRACT_FENCE) {
                        const [fenceField, fenceAt] = options.arguments;
                        const hash = hashes.get(options.keys[0]) ?? {};
                        if (hash[fenceField] !== fenceAt) return 0;
                        const { [fenceField]: _gone, ...rest } = hash;
                        hashes.set(options.keys[0], rest);
                        return 1;
                    }
                    if (script === NOTE_ACCEPTED_UNLESS_CLOSED) {
                        const [field, moment, seconds, fenceField, earliestFence] = options.arguments;
                        const hash = hashes.get(options.keys[0]) ?? {};
                        if (fenceField !== '') {
                            // a fence counts for FENCE_LIFE_MS from its moment (one whose moment cannot be read counts)
                            // (the fence of its own turn, and the one of a close made when the turn was not known)
                            for (const field of [fenceField, 'fence:|']) if (field in hash && !(Number(hash[field]) < Number(earliestFence))) return 0;
                        } else {
                            for (const [name, value] of Object.entries(hash)) if (name.startsWith('fence:') && !(Number(value) < Number(earliestFence))) return 0;
                        }
                        const current = Number(hash[field]);
                        if (Number.isNaN(current) || current < Number(moment)) hashes.set(options.keys[0], { ...hash, [field]: moment });
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

        it('refuses a call of a known turn by the fence of a close made when no turn was known (`fence:|`), for FENCE_LIFE_MS, while a fence of another known turn leaves it eligible', async () => {
            const r = redis();
            const a = new RedisSharedCalls(() => r.client, 'A');
            const c = new RedisSharedCalls(() => r.client, 'C');
            expect(await a.closeTurn('u', undefined, 0, 4000)).toBe(true);
            expect(Object.keys(r.hashes.get('computer:called:u') ?? {})).toEqual(['fence:|']);
            expect(await c.noteAccepted('u', 4100, { turn: 2, run: 'r' })).toBe(false);
            expect(await c.noteAccepted('u', 4000 + FENCE_LIFE_MS, { turn: 2, run: 'r' })).toBe(false);
            expect(await c.noteAccepted('u', 4000 + FENCE_LIFE_MS + 1, { turn: 2, run: 'r' })).toBe(true);
            expect(await a.closeTurn('o', { turn: 1, run: 'r' }, 0, 4000)).toBe(true);
            expect(await c.noteAccepted('o', 4100, { turn: 2, run: 'r' })).toBe(true);
            expect(await c.noteAccepted('o', 4100, { turn: 1, run: 'r' })).toBe(false);
            // a fence whose moment cannot be read counts for a call whose turn is not known, as for a known one
            r.hashes.set('computer:called:g', { 'fence:3|r': 'not-a-number' });
            expect(await c.noteAccepted('g', 10 ** 9)).toBe(false);
            expect(await c.noteAccepted('g', 10 ** 9, { turn: 3, run: 'r' })).toBe(false);
        });

        it('lets an orphan fence clear itself in about one give-up period: long enough for the calls of a turn that is being given up, short enough that a live turn is blocked for no more than a minute', () => {
            expect(FENCE_LIFE_MS).toBeGreaterThanOrEqual(10_000);
            expect(FENCE_LIFE_MS).toBeLessThanOrEqual(60_000);
        });

        it('takes a fence back only while the field still holds the moment it wrote, and says it twice without harm', async () => {
            const r = redis();
            const a = new RedisSharedCalls(() => r.client, 'A');
            const c = new RedisSharedCalls(() => r.client, 'C');
            // a first close, and a LATER close of the same turn that writes its own moment over it; then the first close's retraction arrives (late)
            expect(await a.closeTurn('j', { turn: 6, run: 'r' }, 9000, 11_000)).toBe(true);
            expect(await a.closeTurn('j', { turn: 6, run: 'r' }, 9000, 12_000)).toBe(true);
            await a.retractFence('j', { turn: 6, run: 'r' }, 11_000);
            // the second fence is still there and still refuses a call of the turn
            expect(r.hashes.get('computer:called:j')?.['fence:6|r']).toBe('12000');
            expect(await c.noteAccepted('j', 12_100, { turn: 6, run: 'r' })).toBe(false);
            // another turn or run stays too
            await a.retractFence('j', { turn: 6, run: 'other' }, 12_000);
            await a.retractFence('j', { turn: 7, run: 'r' }, 12_000);
            expect(Object.keys(r.hashes.get('computer:called:j') ?? {})).toEqual(['fence:6|r']);
            expect(await c.noteAccepted('j', 12_100, { turn: 6, run: 'r' })).toBe(false);
            // its own moment goes, and then a call of the turn is taken up; again is no harm
            await a.retractFence('j', { turn: 6, run: 'r' }, 12_000);
            await a.retractFence('j', { turn: 6, run: 'r' }, 12_000);
            expect(Object.keys(r.hashes.get('computer:called:j') ?? {})).toEqual([]);
            expect(await c.noteAccepted('j', 12_100, { turn: 6, run: 'r' })).toBe(true);
            // the store failing is the caller's to read: it rejects
            await expect(new RedisSharedCalls(() => null, 'A').retractFence('j', undefined, 1)).rejects.toThrow();
        });

        it('skips damaged turns and fields (and a list with no promise, as an older server wrote it), and rejects when the store cannot be read or written', async () => {
            const r = redis();
            r.hashes.set('computer:called:j', {
                'turn:X': 'not json',
                'turn:Y': '{"turn":1}',
                'turn:old': JSON.stringify([{ turn: 5, at: 1 }]),
                'turn:nopromise': JSON.stringify({ turns: [{ turn: 5, at: 1 }] }),
                // an intact list (a turn without a run reads without one, an empty run too) is read as it is
                'turn:Z': JSON.stringify({ until: 9000, turns: [{ turn: 3, run: '', at: 3000 }, { turn: 4, run: 'r', at: 4000 }] }),
            });
            expect(await new RedisSharedCalls(() => r.client, 'A').turnsByOthers('j')).toEqual([{ turns: [{ turn: 3, at: 3000 }, { turn: 4, run: 'r', at: 4000 }], until: 9000 }]);
            await expect(new RedisSharedCalls(() => null, 'A').turnsByOthers('j')).rejects.toThrow();
            await expect(new RedisSharedCalls(() => null, 'A').noteTurn('j', [], 1)).rejects.toThrow();
            const silent = { hGetAll: () => new Promise(() => undefined), eval: () => new Promise(() => undefined) } as unknown as EvidenceRedis;
            await expect(new RedisSharedCalls(() => silent, 'A', 20).turnsByOthers('j')).rejects.toThrow(/in time/);
            await expect(new RedisSharedCalls(() => silent, 'A', 20).noteTurn('j', [], 1)).rejects.toThrow(/in time/);
        });

        it('writes the fence of a turn in the same step that looks at what the other servers took up, and refuses a call for a turn that was closed (each in its own field, never read as a call that arrived)', async () => {
            const r = redis();
            const a = new RedisSharedCalls(() => r.client, 'A');
            const b = new RedisSharedCalls(() => r.client, 'B');
            const c = new RedisSharedCalls(() => r.client, 'C');
            // B took a call of turn 5 up at 10 000, and a call whose turn was not known at 4 000
            expect(await b.noteAccepted('j', 10_000, { turn: 5, run: 'r' })).toBe(true);
            expect(await b.noteAccepted('j2', 4000)).toBe(true);
            // turn 5 has a call taken up: not closed, and nothing written; turn 6 has none: closed
            expect(await a.closeTurn('j', { turn: 5, run: 'r' }, 9000, 12_000)).toBe(false);
            expect(Object.keys(r.hashes.get('computer:called:j') ?? {})).toEqual(['accepted:B|5|r']);
            expect(await a.closeTurn('j', { turn: 6, run: 'r' }, 9000, 12_000)).toBe(true);
            expect(Object.keys(r.hashes.get('computer:called:j') ?? {}).sort()).toEqual(['accepted:B|5|r', 'fence:6|r']);
            expect(r.ttl.get('computer:called:j')).toBe(3600);
            // a call before the window (more than the skew before it) does not count, and one with no turn counts for every turn
            expect(await a.closeTurn('j2', { turn: 1, run: 'r' }, 9000, 12_000)).toBe(true);
            expect(await a.closeTurn('j3', { turn: 1 }, 0, 1)).toBe(true);
            await b.noteAccepted('j4', 11_000);
            expect(await a.closeTurn('j4', { turn: 9, run: 'x' }, 9000, 12_000)).toBe(false);
            // a call for the closed turn is refused by the store, and so is one whose turn is not known right after; another turn or run is not
            expect(await c.noteAccepted('j', 12_100, { turn: 6, run: 'r' })).toBe(false);
            expect(await c.noteAccepted('j', 12_100)).toBe(false);
            expect(await c.noteAccepted('j', 12_100, { turn: 7, run: 'r' })).toBe(true);
            expect(await c.noteAccepted('j', 12_100, { turn: 6, run: 'other' })).toBe(true);
            // a fence counts for FENCE_LIFE_MS from its moment, a turn that is known or not: an orphan clears itself
            expect(await c.noteAccepted('j', 12_000 + FENCE_LIFE_MS, { turn: 6, run: 'r' })).toBe(false);
            expect(await c.noteAccepted('j', 12_000 + FENCE_LIFE_MS)).toBe(false);
            expect(await c.noteAccepted('j', 12_000 + FENCE_LIFE_MS + 1, { turn: 6, run: 'r' })).toBe(true);
            expect(await c.noteAccepted('j', 12_000 + FENCE_LIFE_MS + 1)).toBe(true);
            // the fence is not a call that arrived, and not a turn list
            expect(await c.lastCalledByOthers('j')).toBeNull();
            expect(await c.turnsByOthers('j')).toEqual([]);
            // the store failing is the caller's to read: it rejects
            await expect(new RedisSharedCalls(() => null, 'A').closeTurn('j', undefined, 0, 1)).rejects.toThrow();
            await expect(new RedisSharedCalls(() => null, 'A').noteAccepted('j', 1)).rejects.toThrow();
        });

        it('rejects a WHOLE list when any of its turns cannot be read (never the turns that were readable under its promise): the call it covers is given no turn', async () => {
            const turnsOf = (list: unknown[]) => JSON.stringify({ until: 9000, turns: list });
            for (const damaged of [{ turn: -1, at: 1 }, { turn: 1.5, at: 1 }, { turn: 2, at: 'x' }, { turn: 2 }, null, 'x', 7]) {
                const r = redis();
                // turn 5 (the newest) is the damaged one: without it, the call below would be given turn 4
                r.hashes.set('computer:called:j', { 'turn:R': turnsOf([{ turn: 3, run: 'r', at: 1000 }, { turn: 4, run: 'r', at: 2000 }, damaged]) });
                const lists = await new RedisSharedCalls(() => r.client, 'B').turnsByOthers('j');
                // no turn of it is read, and its promise still stands: it is a runner that covers calls, and attributes none
                expect(lists, JSON.stringify(damaged)).toEqual([{ turns: [], until: 9000 }]);
                const notes = createRefusalNotes(() => 6000, { shared: new RedisSharedCalls(() => r.client, 'B'), runsHere: () => false });
                expect(await notes.turnOfCall('j', { order: 1, at: 6000 }), JSON.stringify(damaged)).toEqual({ turn: null });
            }
            // an intact list of the same runner gives the call its turn
            const r = redis();
            r.hashes.set('computer:called:j', { 'turn:R': turnsOf([{ turn: 3, run: 'r', at: 1000 }, { turn: 4, run: 'r', at: 2000 }]) });
            const notes = createRefusalNotes(() => 6000, { shared: new RedisSharedCalls(() => r.client, 'B'), runsHere: () => false });
            expect(await notes.turnOfCall('j', { order: 1, at: 6000 })).toEqual({ turn: 4, run: 'r' });
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
        expect(Object.keys(FAULT_EVIDENCE_MESSAGES).sort()).toEqual(['all_refused', 'called_unrecorded', 'dead_aging', 'dead_letter', 'not_durable', 'pending_aging', 'unacked', 'unnamed_rejection']);
        // with the runner elsewhere the relay answers 503 and forwards nothing: the alert must not say the call went ahead as a fact
        expect(FAULT_EVIDENCE_MESSAGES.called_unrecorded).toMatch(/refused/);
        expect(FAULT_EVIDENCE_MESSAGES.called_unrecorded).toMatch(/or have gone ahead/);
        expect(FAULT_EVIDENCE_MESSAGES.called_unrecorded).not.toMatch(/\(it went ahead\)/);
    });
});
