/**
 * The runner for a Brick's real computer (build handoff v2, section 6). Orbit decides which jobs are running and keeps the machine, the
 * keys, the take-over fence and the meter; this module is the one thing that talks to the agent on the machine, through Orbit's broker:
 *
 *   find a running job -> get its machine ready for a model (a new key) -> send the agent the job as a turn -> read what it says
 *   -> act on how the turn ended (done, failed, needs the person, or carry on) -> repeat
 *
 * What it keeps to:
 *  - It never decides who has the machine. Before it acts on how a turn ended it asks Orbit again: a job the person took over, or one that
 *    is over, is left alone, and the agent's words from before are not acted on.
 *  - The agent is told once, in the first turn, how to say it is done, cannot go on, or needs the person (a line at the end of its reply).
 *    Paying, submitting and the person's own details are never its alone.
 *  - It renews the job's room as often as Orbit says, so a job that goes on is not stopped and one that does not is let go.
 *  - It stops reading when it is stopped (a restart), and the turn goes on on the machine: the next runner reconnects to it.
 *  - What the agent was given never reaches a log, and neither do its tool arguments (Orbit never sends them).
 */

import type { AdminApiService } from './AdminApiService';
import { readRunnerEvents } from './ComputerTurnStream';

export type RunnerEvent =
    | { type: 'created'; id: string; sessionId: string | null }
    | { type: 'text'; text: string }
    | { type: 'tool'; state: 'generating' | 'started' | 'completed' | 'failed'; tool: string; label?: string; durationMs?: number; error?: string }
    | { type: 'completed'; outputText: string; usage: { inputTokens: number | null; outputTokens: number | null } | null }
    | { type: 'failed'; code: string; message: string }
    | { type: 'keepalive' };

export interface RunnableJob {
    jobId: string;
    botId: string;
    title: string;
    brief: string | null;
    writes: boolean;
    hasTurn: boolean;
}

export type TurnOpened = { ok: true; events: AsyncIterable<RunnerEvent> } | { ok: false; reason: string; responseId?: string };

export interface RunnerOrbit {
    running(): Promise<RunnableJob[]>;
    /** The job as Orbit has it, or null when it is gone. */
    job(botId: string, jobId: string): Promise<{ status: string; control: string } | null>;
    action(botId: string, jobId: string, body: Record<string, unknown>): Promise<Record<string, unknown>>;
    prepare(jobId: string, relay: string): Promise<{ ok: true } | { ok: false; reason: string }>;
    turn(jobId: string, input: string, signal: AbortSignal): Promise<TurnOpened>;
    stream(jobId: string, signal: AbortSignal): Promise<TurnOpened>;
    cancel(jobId: string): Promise<void>;
}

export interface RunnerTiming {
    /** How long to wait before looking at a job again while the person has it. */
    waitMs: number;
    /** The least time between two progress reports of one job. */
    progressMs: number;
    /** How long to wait before each try to reconnect to a turn whose stream broke. */
    reconnectMs: number[];
    /** How long to wait before each try to get a machine ready. */
    prepareMs: number[];
}

export const RUNNER_TIMING: RunnerTiming = { waitMs: 5000, progressMs: 4000, reconnectMs: [1000, 3000, 8000, 20_000], prepareMs: [2000, 6000] };

export const RUNNER_GUARDS = {
    /** Jobs the runner works on at once. */
    maxJobs: 20,
    /** Turns one job may take before it is ended as failed (a job that never says it is done must not run for ever). */
    maxTurns: 60,
    /** Turns in a row that ended badly before the job is ended as failed. */
    maxBadTurns: 3,
    /** The most of the agent's words kept to read the ending from. */
    maxWords: 20_000,
};

export type Ending =
    | { kind: 'done' }
    | { kind: 'failed' }
    | { kind: 'handover'; waitingFor: 'details' | 'signin' | 'upload' | 'pay' | 'submit' | 'answer'; what: string | null; where: string | null }
    | { kind: 'none' };

const KINDS = ['details', 'signin', 'upload', 'pay', 'submit', 'answer'] as const;
const clean = (value: string | undefined) => (value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);

/** How the agent said its turn ended: the LAST marker in its words counts. `[[done]]`, `[[failed]]` or `[[handover kind | what | where]]`. */
export function endingOf(words: string): Ending {
    let last: Ending = { kind: 'none' };
    const pattern = /\[\[\s*(done|failed|handover)\s*([^\]]*)\]\]/gi;
    for (let match = pattern.exec(words); match; match = pattern.exec(words)) {
        const word = match[1].toLowerCase();
        if (word === 'done') last = { kind: 'done' };
        else if (word === 'failed') last = { kind: 'failed' };
        else {
            const parts = match[2].replace(/^\s*[|:]?/, '').split('|');
            const asked = (parts[0] ?? '').trim().toLowerCase();
            const kind = (KINDS as readonly string[]).includes(asked) ? (asked as (typeof KINDS)[number]) : null;
            const what = clean(parts[1]) || null;
            const where = clean(parts[2]) || null;
            // "details" is only ever asked with what and where named, so the person's one tap fills in exactly that; otherwise it is a question
            if (kind === 'details' && (!what || !where)) last = { kind: 'handover', waitingFor: 'answer', what: null, where: null };
            else last = { kind: 'handover', waitingFor: kind ?? 'answer', what: kind === 'details' ? what : null, where: kind === 'details' ? where : null };
        }
    }
    return last;
}

/** The first turn of a job: the job in the person's words, and how to say how it ended. */
export function jobPrompt(job: { title: string; brief: string | null; writes: boolean }): string {
    return [
        'You are working on a computer that belongs to a person. Do this job for them, in the browser and on this computer:',
        '',
        `Job: ${job.title}`,
        ...(job.brief ? ['', 'In their words:', job.brief] : []),
        '',
        ...(job.writes ? [] : ['This job is only to look: do not fill in, send, buy or change anything anywhere.', '']),
        'Rules:',
        '- Paying, submitting a form for good, and the person\'s own details (names, numbers, documents, passwords, card numbers) are never yours alone. Stop and ask for them.',
        '- When you need the person (their details, to sign in, to upload a file, to pay, to submit, or an answer), stop and end your reply with one line: [[handover KIND | what | where]]. KIND is one of details, signin, upload, pay, submit, answer. For details, say exactly what you are ready to put in and the site it goes on; for the rest `what` and `where` can be left out.',
        '- When the job is finished, end your reply with [[done]].',
        '- If you cannot go on, say why in one plain sentence and end your reply with [[failed]].',
        '- Keep your replies short. Do not repeat what you did. Never write a password, key or number the person gave you in your reply.',
    ].join('\n');
}

export const RESUME_PROMPT =
    'The person used this computer and has handed it back. Look at the current page first, since it may have changed, then carry on with the job from where it stands. Remember how to end your reply: [[done]], [[failed]] or [[handover KIND | what | where]].';

export const CONTINUE_PROMPT = 'Carry on with the job. If it is finished, end your reply with [[done]]. If you need the person, end with [[handover KIND | what | where]]. If you cannot go on, end with [[failed]].';

const over = (status: string) => status === 'done' || status === 'stopped' || status === 'failed';

export interface RunnerDeps {
    orbit: RunnerOrbit;
    /** Where the model relay is (an https address ending where /v1 begins). Without it no job can run, and each is ended as failed. */
    relayUrl: string | null;
    timing?: RunnerTiming;
    /** Waits; stops waiting when the signal ends. */
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    now?: () => number;
    log?: Pick<Console, 'warn' | 'error' | 'info'>;
}

const realSleep = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        const timer = setTimeout(done, ms);
        function done() {
            clearTimeout(timer);
            signal.removeEventListener('abort', done);
            resolve();
        }
        signal.addEventListener('abort', done, { once: true });
    });

type TurnResult =
    /** The turn ended and what the agent said is here (it may be empty). */
    | { kind: 'ended'; words: string; failed: boolean; fenced: boolean }
    /** Orbit or the job changed under it: look at the job again. */
    | { kind: 'look' }
    /** Stopped (a restart): nothing more is done, and the turn goes on on the machine. */
    | { kind: 'stopped' };

export interface ComputerRunner {
    /** Looks for running jobs and starts a worker on each new one. Never throws. */
    tick(): Promise<void>;
    start(everyMs: number): void;
    /** Stops reading every job. Turns on machines go on; the next runner reconnects to them. */
    stop(): void;
    /** Job ids worked on now. */
    active(): string[];
    /** Resolves when no worker is left (for tests and for a clean stop). */
    idle(): Promise<void>;
}

export function createComputerRunner(deps: RunnerDeps): ComputerRunner {
    const { orbit } = deps;
    const timing = deps.timing ?? RUNNER_TIMING;
    const sleep = deps.sleep ?? realSleep;
    const now = deps.now ?? Date.now;
    const log = deps.log ?? console;
    const workers = new Map<string, { controller: AbortController; done: Promise<void> }>();
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopped = false;

    const say = (message: string, error?: unknown) => log.warn(`[ComputerRunner] ${message}`, error instanceof Error ? error.message : '');

    async function finish(job: RunnableJob, outcome: 'done' | 'failed') {
        await orbit.action(job.botId, job.jobId, { action: 'finish', outcome }).catch((error) => say('Could not end a job:', error));
    }

    /** Waits while the person has the machine or the job waits for them. 'back' when it is Brick's again, 'over' when it is not coming back. */
    async function waitForBrick(job: RunnableJob, signal: AbortSignal): Promise<'back' | 'over' | 'stopped'> {
        for (;;) {
            if (signal.aborted) return 'stopped';
            const state = await orbit.job(job.botId, job.jobId).catch(() => undefined);
            // undefined: Orbit could not be asked; null: the job is gone
            if (state === null || (state && over(state.status))) return 'over';
            if (state && state.status === 'running' && state.control === 'brick') return 'back';
            await sleep(timing.waitMs, signal);
        }
    }

    async function prepared(job: RunnableJob, relay: string, signal: AbortSignal): Promise<'ready' | 'look' | 'failed' | 'stopped'> {
        for (let attempt = 0; ; attempt++) {
            if (signal.aborted) return 'stopped';
            const answer = await orbit.prepare(job.jobId, relay).catch(() => ({ ok: false as const, reason: 'failed' }));
            if (!('reason' in answer)) return 'ready';
            // The job is not Brick's to work on now (taken over, over, no machine awake): look at it again, do not retry
            if (answer.reason !== 'failed') return 'look';
            if (attempt >= timing.prepareMs.length) return 'failed';
            await sleep(timing.prepareMs[attempt], signal);
        }
    }

    /** When a job's room is next asked to be renewed. Each renewal holds more room, so it is by the clock across turns, never once per turn. */
    interface Renewing {
        nextAt: number;
    }

    /** Sends one turn (or reconnects to the one going) and reads it to its end, renewing the job's room as Orbit says while it does. */
    async function oneTurn(job: RunnableJob, input: string | null, signal: AbortSignal, renewing: Renewing): Promise<TurnResult> {
        const turnController = new AbortController();
        const onStop = () => turnController.abort();
        signal.addEventListener('abort', onStop, { once: true });
        let renewTimer: ReturnType<typeof setTimeout> | undefined;
        let lost = false;
        const renew = async () => {
            if (turnController.signal.aborted) return;
            try {
                const answer = await orbit.action(job.botId, job.jobId, { action: 'renew' });
                if (answer.ok === false) {
                    // Its room is gone and Orbit has stopped it: the agent stops too
                    lost = true;
                    turnController.abort();
                    await orbit.cancel(job.jobId).catch(() => undefined);
                    return;
                }
                const next = typeof answer.renewInSeconds === 'number' && answer.renewInSeconds >= 5 ? answer.renewInSeconds : 120;
                renewing.nextAt = now() + next * 1000;
                renewTimer = setTimeout(() => void renew(), next * 1000);
            } catch (error) {
                // Orbit could not be reached: try again soon, the room is held for a while yet
                say('Could not renew a job:', error);
                renewing.nextAt = now() + 15_000;
                renewTimer = setTimeout(() => void renew(), 15_000);
            }
        };
        try {
            if (now() >= renewing.nextAt) await renew();
            else renewTimer = setTimeout(() => void renew(), Math.max(1000, renewing.nextAt - now()));
            if (lost) return { kind: 'look' };

            let words = '';
            let stepDone = 0;
            let label: string | null = null;
            let lastReport = 0;
            let reported = -1;
            const report = async (force = false) => {
                const at = Date.now();
                if (!force && at - lastReport < timing.progressMs) return;
                if (stepDone === reported && !label) return;
                lastReport = at;
                reported = stepDone;
                await orbit.action(job.botId, job.jobId, { action: 'progress', stepDone, label }).catch(() => undefined);
            };

            let opened: TurnOpened = input === null ? await orbit.stream(job.jobId, turnController.signal) : await orbit.turn(job.jobId, input, turnController.signal);
            // The agent is still on a turn of its own (we lost it, or Orbit restarted): read that one instead of starting another
            if ('reason' in opened && opened.reason === 'busy') opened = await orbit.stream(job.jobId, turnController.signal);
            if ('reason' in opened) {
                if (opened.reason === 'no_turn') return { kind: 'ended', words: '', failed: false, fenced: false };
                return opened.reason === 'failed' ? { kind: 'ended', words: '', failed: true, fenced: false } : { kind: 'look' };
            }

            let reconnects = 0;
            for (;;) {
                let terminal: { failed: boolean; fenced: boolean; code: string } | null = null;
                try {
                    for await (const event of opened.events) {
                        if (event.type === 'text') words = (words + event.text).slice(-RUNNER_GUARDS.maxWords);
                        else if (event.type === 'tool') {
                            if (event.state === 'started' && event.label) label = event.label;
                            if (event.state === 'completed') {
                                stepDone += 1;
                                await report();
                            }
                        } else if (event.type === 'completed') {
                            words = event.outputText ? event.outputText.slice(-RUNNER_GUARDS.maxWords) : words;
                            terminal = { failed: false, fenced: false, code: '' };
                        } else if (event.type === 'failed') {
                            terminal = { failed: true, fenced: event.code === 'fenced', code: event.code };
                        }
                    }
                } catch (error) {
                    if (!turnController.signal.aborted) say('A turn stream broke:', error);
                    terminal = terminal ?? { failed: true, fenced: false, code: 'stream_broke' };
                }
                if (signal.aborted) return { kind: 'stopped' };
                if (lost) return { kind: 'look' };
                await report(true);
                if (terminal && terminal.code !== 'stream_broke' && terminal.code !== 'stream_ended') return { kind: 'ended', words, failed: terminal.failed, fenced: terminal.fenced };
                // The connection ended before the turn did: reconnect to it, a few times, then let the next look decide
                if (reconnects >= timing.reconnectMs.length) return { kind: 'ended', words, failed: true, fenced: false };
                await sleep(timing.reconnectMs[reconnects], turnController.signal);
                reconnects += 1;
                const again = await orbit.stream(job.jobId, turnController.signal);
                if ('reason' in again) return again.reason === 'no_turn' ? { kind: 'ended', words, failed: false, fenced: false } : { kind: 'look' };
                opened = again;
            }
        } finally {
            if (renewTimer) clearTimeout(renewTimer);
            signal.removeEventListener('abort', onStop);
            turnController.abort();
        }
    }

    async function work(job: RunnableJob, signal: AbortSignal): Promise<void> {
        if (!deps.relayUrl) {
            log.error('[ComputerRunner] A job cannot run: no address is set for the model relay (COMPUTER_RELAY_URL or BOT_SERVER_URL).');
            await finish(job, 'failed');
            return;
        }
        let input: string | null = job.hasTurn ? null : jobPrompt(job);
        const renewing: Renewing = { nextAt: 0 };
        let turns = 0;
        let bad = 0;
        for (;;) {
            if (signal.aborted) return;
            const state = await orbit.job(job.botId, job.jobId).catch(() => undefined);
            if (state === null || (state && over(state.status))) return;
            if (state === undefined) {
                // Orbit could not be asked: wait a moment and ask again
                await sleep(timing.waitMs, signal);
                continue;
            }
            if (state.status !== 'running' || state.control !== 'brick') {
                const back = await waitForBrick(job, signal);
                if (back !== 'back') return;
                input = RESUME_PROMPT;
                continue;
            }
            if (++turns > RUNNER_GUARDS.maxTurns) {
                say('A job took more turns than allowed and was ended.');
                await finish(job, 'failed');
                return;
            }
            const ready = await prepared(job, deps.relayUrl, signal);
            if (ready === 'stopped') return;
            if (ready === 'look') {
                // Waiting for the machine is not a turn: it must not use up the turns a job is allowed
                turns--;
                await sleep(timing.waitMs, signal);
                continue;
            }
            if (ready === 'failed') {
                await finish(job, 'failed');
                return;
            }

            const result = await oneTurn(job, input, signal, renewing);
            if (result.kind === 'stopped') return;
            if (result.kind === 'look') {
                await sleep(timing.waitMs, signal);
                continue;
            }

            // Only what Orbit still says is Brick's is acted on: if the person took over meanwhile, their hands win and the words are dropped
            const after = await orbit.job(job.botId, job.jobId).catch(() => undefined);
            if (after === null || (after && over(after.status))) return;
            if (after && (after.status !== 'running' || after.control !== 'brick')) {
                const back = await waitForBrick(job, signal);
                if (back !== 'back') return;
                input = RESUME_PROMPT;
                bad = 0;
                continue;
            }
            if (result.fenced) {
                input = RESUME_PROMPT;
                continue;
            }

            const ending = endingOf(result.words);
            if (ending.kind === 'done') return void (await finish(job, 'done'));
            if (ending.kind === 'failed') return void (await finish(job, 'failed'));
            if (ending.kind === 'handover') {
                bad = 0;
                await orbit
                    .action(job.botId, job.jobId, {
                        action: 'handover',
                        waitingFor: ending.waitingFor,
                        ...(ending.waitingFor === 'details' && ending.what && ending.where ? { ready: { what: ending.what, where: ending.where } } : {}),
                    })
                    .catch((error) => say('Could not hand over:', error));
                const back = await waitForBrick(job, signal);
                if (back !== 'back') return;
                input = RESUME_PROMPT;
                continue;
            }
            // No ending said: carry on, but not for ever when turns keep going wrong
            bad = result.failed || result.words.trim() === '' ? bad + 1 : 0;
            if (bad >= RUNNER_GUARDS.maxBadTurns) {
                say('A job kept failing to answer and was ended.');
                await finish(job, 'failed');
                return;
            }
            input = CONTINUE_PROMPT;
        }
    }

    async function tick(): Promise<void> {
        if (stopped) return;
        let jobs: RunnableJob[];
        try {
            jobs = await orbit.running();
        } catch (error) {
            say('Could not read the running jobs:', error);
            return;
        }
        for (const job of jobs) {
            if (workers.has(job.jobId) || workers.size >= RUNNER_GUARDS.maxJobs) continue;
            const controller = new AbortController();
            const done = work(job, controller.signal)
                .catch((error) => say('A job stopped on an error:', error))
                .finally(() => workers.delete(job.jobId));
            workers.set(job.jobId, { controller, done });
        }
    }

    return {
        tick,
        start(everyMs) {
            stopped = false;
            if (timer) clearInterval(timer);
            timer = setInterval(() => void tick(), everyMs);
            timer.unref?.();
            void tick();
        },
        stop() {
            stopped = true;
            if (timer) clearInterval(timer);
            timer = undefined;
            for (const { controller } of workers.values()) controller.abort();
        },
        active: () => [...workers.keys()],
        idle: async () => {
            while (workers.size > 0) await Promise.all([...workers.values()].map((worker) => worker.done));
        },
    };
}

/** The runner's view of Orbit, over the bot server's own calls to it. */
export function runnerOrbitFor(admin: Pick<AdminApiService, 'computerRunningJobs' | 'getComputerJob' | 'computerJobAction' | 'computerBroker' | 'computerOpenTurn'>): RunnerOrbit {
    const opened = async (jobId: string, step: 'turn' | 'stream', input: string | null, signal: AbortSignal): Promise<TurnOpened> => {
        const answer = await admin.computerOpenTurn(jobId, step, input, signal);
        if ('body' in answer) return { ok: true, events: readRunnerEvents(answer.body) };
        return { ok: false, reason: answer.status >= 500 ? 'failed' : answer.reason, ...(answer.responseId ? { responseId: answer.responseId } : {}) };
    };
    return {
        running: () => admin.computerRunningJobs(),
        job: async (botId, jobId) => {
            const job = await admin.getComputerJob(botId, jobId);
            return job ? { status: job.status, control: job.control } : null;
        },
        action: (botId, jobId, body) => admin.computerJobAction(botId, jobId, body),
        prepare: async (jobId, relay) => {
            const answer = await admin.computerBroker(jobId, 'prepare', { relay });
            if (answer.status === 200 && answer.data.ok === true) return { ok: true };
            return { ok: false, reason: answer.status >= 500 || typeof answer.data.reason !== 'string' ? 'failed' : answer.data.reason };
        },
        turn: (jobId, input, signal) => opened(jobId, 'turn', input, signal),
        stream: (jobId, signal) => opened(jobId, 'stream', null, signal),
        cancel: async (jobId) => {
            await admin.computerBroker(jobId, 'cancel', {});
        },
    };
}

/**
 * Where the model relay is, for the machine to call, in this order: the address chosen for it (COMPUTER_RELAY_URL), the bot server's public
 * address (BOT_SERVER_URL), else the one the play server's public address implies (its first name replaced by `bot-server`, the same rule
 * the game's own front uses). The last is only used when it is an https address; an internal one (http, or a bare host) is no door a machine
 * outside could use. Null when none fits, and the job then ends with a clear line rather than hand the machine an address it cannot reach.
 */
export function relayUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
    const clean = (text: string) => text.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
    const chosen = clean(env.COMPUTER_RELAY_URL || env.BOT_SERVER_URL || '');
    if (chosen) {
        // A bare host or a path is no address a machine can call: it is refused here rather than handed to the machine
        try {
            return /^https?:$/.test(new URL(chosen).protocol) ? chosen : null;
        } catch {
            return null;
        }
    }
    try {
        const pusher = new URL((env.PUSHER_URL || env.WORKADVENTURE_URL || '').trim());
        const labels = pusher.hostname.split('.');
        if (pusher.protocol !== 'https:' || labels.length < 3 || /^[0-9.]+$/.test(pusher.hostname)) return null;
        labels[0] = 'bot-server';
        return `https://${labels.join('.')}${pusher.port ? `:${pusher.port}` : ''}`;
    } catch {
        return null;
    }
}
