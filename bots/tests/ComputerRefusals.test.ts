import { describe, expect, it, vi } from 'vitest';
import { createRefusalNotes, FAULT_ROWS_PER_CALL, REFUSAL_NOTE_KEEP_MS, type CallRow } from '../server/ComputerRefusals';

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
        const started = Date.now();
        expect(await notes.flush('j')).toBe(false);
        expect(Date.now() - started).toBeLessThan(150);
        // the flush did not stop the sender: it tries again and the row arrives
        await vi.waitFor(() => expect(sent).toEqual(['c1']), { timeout: 2000 });
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
});
