/**
 * A pretend runner for the DEVELOPMENT server (game #2000). Orbit's computer is a pretend machine there (COMPUTER_PROVIDER=fake), so
 * nothing really does the job: this walks a job through a few steps so the bar, Watch, Stop, Take over and the allowance can be tried.
 * It does the same calls the real runner will: steps, renewing its room, and finishing. It waits while the person has taken over,
 * stops when Orbit says its room is gone, and it does nothing at all unless COMPUTER_PRETEND_RUNNER=yes. It never touches anything outside.
 */
import type { AdminApiService } from '../server/AdminApiService';

type Calls = Pick<AdminApiService, 'getComputerJob' | 'computerJobAction'>;

export const PRETEND_STEPS = ['Opening the site', 'Reading the page', 'Getting the form ready'] as const;

export function pretendRunnerOn(): boolean {
    return process.env.COMPUTER_PRETEND_RUNNER === 'yes';
}

export function runPretendJob(admin: Calls, botId: string, jobId: string, stepMs = Number(process.env.COMPUTER_PRETEND_STEP_MS) || 4000): () => void {
    let stopped = false;
    let done = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
        stopped = true;
        if (timer) clearTimeout(timer);
    };
    const tick = async () => {
        if (stopped) return;
        try {
            const job = await admin.getComputerJob(botId, jobId);
            // Over (stopped by the person, the allowance, a delete) or gone: nothing more to do
            if (!job || (job.status !== 'running' && job.status !== 'waiting')) return stop();
            // The person has the mouse: nothing moves until they hand it back
            if (job.status === 'waiting') {
                timer = setTimeout(() => void tick(), stepMs);
                return;
            }
            const renewed = await admin.computerJobAction(botId, jobId, { action: 'renew' });
            if (renewed && (renewed as { ok?: boolean }).ok === false) return stop();
            if (done >= PRETEND_STEPS.length) {
                await admin.computerJobAction(botId, jobId, { action: 'finish', outcome: 'done' });
                return stop();
            }
            await admin.computerJobAction(botId, jobId, { action: 'progress', stepDone: done, stepTotal: PRETEND_STEPS.length, label: PRETEND_STEPS[done] });
            done += 1;
            timer = setTimeout(() => void tick(), stepMs);
        } catch (error) {
            console.warn('[ComputerPretend] Stopped:', error instanceof Error ? error.message : error);
            stop();
        }
    };
    timer = setTimeout(() => void tick(), 0);
    return stop;
}
