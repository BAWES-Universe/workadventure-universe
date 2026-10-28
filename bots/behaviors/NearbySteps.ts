/**
 * The steps line of a nearby-chat reply (#1545): the same one line a direct message shows while the bot uses its tools,
 * instead of a "🔍 tool_name..." bubble per call. It wraps the reply's stream, keeps the steps, and sends the line as a
 * stream message of its own that each change replaces. The plain text is the body, so a game that doesn't know the
 * line still reads it.
 */
import type { AIStreamChunk } from '../ai/types';
import { ReplySteps, type StepsField } from '../ai/ToolSteps';

export interface NearbyStepsLine {
    /** Whether this bot shows its tool calls, its own "Show tool calls" switch (#742). Asked once per reply. */
    shouldShow: () => Promise<boolean>;
    /** Send the line: its own response id, the plain text, whether it is final, and the field the game draws. */
    send: (responseId: string, text: string, isFinal: boolean, field: StepsField) => void;
    /** A fresh response id for the line. */
    newResponseId: () => string;
    /** The reply was cut off, e.g. the person walked away or spoke again. */
    aborted?: () => boolean;
}

export async function* withNearbySteps(stream: AsyncIterable<AIStreamChunk>, line: NearbyStepsLine): AsyncGenerator<AIStreamChunk> {
    let steps: ReplySteps | undefined;
    let shown: boolean | undefined;
    let responseId: string | undefined;
    let failed = false;
    const show = () => {
        if (!steps) return;
        responseId ??= line.newResponseId();
        const field = steps.field();
        line.send(responseId, steps.text(), field.state !== 'working', field);
    };
    try {
        for await (const chunk of stream) {
            if (chunk.toolSteps?.length) {
                shown ??= await line.shouldShow();
                // A reply cut off while the switch was read shows nothing
                if (shown && !line.aborted?.()) {
                    steps ??= new ReplySteps();
                    steps.start(chunk.toolSteps);
                    show();
                }
            }
            if (chunk.toolStepResults) {
                if (steps?.finish(chunk.toolStepResults)) show();
                // Only the line needs it: the reply goes on without it
                continue;
            }
            yield chunk;
        }
    } catch (error) {
        failed = true;
        throw error;
    } finally {
        // Also runs when the reply's loop stops early: after its last chunk, or when it was cut off
        if (steps) {
            if (failed || line.aborted?.()) steps.stop();
            else steps.end();
            show();
        }
    }
}
