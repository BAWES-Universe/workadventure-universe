/**
 * Runs a watch, a briefing or a goal on a model (game #2002): the part between the runner and the AI service. It builds what the model is
 * told, gives it the two tools a check has (read a web page, and end the check), and reads what it ended with. A run is a system job: it
 * never touches the person's chat or memory, and each model call is its own usage row under the run's id.
 */
import type { AIService } from '../ai/AIService';
import type { BrickTaskModel, DueRun, TaskOutcome } from './BrickRunner';
import { FINISH_CHECK_TOOL, NO_FINISH_REASON, READ_PAGE_TOOL, TASK_MAX_STEPS, readFinish, taskPrompt, taskToolDefinitions, type TaskResult } from './BrickTaskRun';

/** What the model of a Brick is told about the Brick itself. */
export interface TaskBrick {
    name: string;
    /** The Brick's own instructions, as it answers by in chat. */
    instructions: string;
    /** Which model it runs on; none, and it cannot run a check. */
    providerId: string | null;
    deleted: boolean;
}

export interface TaskModelDeps {
    ai: Pick<AIService, 'runBrickTask'>;
    brick(brickId: string): Promise<TaskBrick | null>;
    readPage(brickId: string, url: string): Promise<Record<string, unknown>>;
    now?: () => Date;
}

const KEY_TURNED_DOWN = 'The AI this Brick thinks with would not let it in, so the check could not run';
const ASK_TURNED_DOWN = 'The AI this Brick thinks with turned this check down';

/** What a page gives back to the model at most (it is information for one check, not a file). */
const PAGE_RESULT_MAX = 12_000;

export class ModelTaskRunner implements BrickTaskModel {
    constructor(private readonly deps: TaskModelDeps) {}

    async run(run: DueRun, permit: () => Promise<boolean>): Promise<TaskOutcome> {
        let brick: TaskBrick | null;
        try {
            brick = await this.deps.brick(run.brickId);
        } catch {
            // Could not read the Brick just now: says nothing about the run
            return { kind: 'unsure' };
        }
        if (!brick || brick.deleted) return { kind: 'stopped' };
        if (!brick.providerId) return { kind: 'failed', error: 'This Brick has no AI set up to think with' };

        let result: TaskResult | null = null;
        const runTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
            if (name === READ_PAGE_TOOL) {
                const page = await this.deps.readPage(run.brickId, typeof args.url === 'string' ? args.url : '');
                return JSON.stringify(page).slice(0, PAGE_RESULT_MAX);
            }
            if (name === FINISH_CHECK_TOOL) {
                const read = readFinish(args, run.kind);
                if ('error' in read) return JSON.stringify({ error: read.error });
                result = read.result;
                return JSON.stringify({ ok: true });
            }
            return JSON.stringify({ error: 'That is not something a check can do.' });
        };
        const ended = await this.deps.ai.runBrickTask({
            botId: run.brickId,
            providerId: brick.providerId,
            system: taskPrompt(run, { name: brick.name, instructions: brick.instructions }, (this.deps.now ?? (() => new Date()))()),
            user: 'Do this check now, then end it with finish_check.',
            tools: taskToolDefinitions(),
            maxSteps: TASK_MAX_STEPS,
            permit,
            runTool,
            final: FINISH_CHECK_TOOL,
            usage: { runId: run.runId, attempt: run.attempt, userId: run.userId },
        });
        switch (ended.ended) {
            case 'final':
                return result ? { kind: 'result', result } : { kind: 'failed', error: NO_FINISH_REASON };
            case 'not_permitted':
                return { kind: 'stopped' };
            case 'failed': {
                // A provider that said no for good (the key was turned down, the ask was refused) will say it again: the person is told, not
                // charged with a try on every lease. A blip, a busy provider or no status at all says nothing about the task.
                const status = ended.status ?? 0;
                if (status === 401 || status === 403) return { kind: 'failed', error: KEY_TURNED_DOWN };
                if (status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status)) return { kind: 'failed', error: ASK_TURNED_DOWN };
                return { kind: 'unsure' };
            }
            case 'resting':
                // Its key is resting: says nothing about the task, so it is tried again when its lease is over
                return { kind: 'unsure' };
            default:
                return { kind: 'failed', error: NO_FINISH_REASON };
        }
    }
}
