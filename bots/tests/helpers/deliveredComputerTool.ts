import { ConfirmationQueue, runComputerTool, type ComputerToolContext } from '../../ai/ComputerTools';

/**
 * `runComputerTool` as a reply that WAS delivered to the person's chat: what the tool queued for confirmation is sent after the call returns, as the bridge does once its send went
 * through. Tests of a reply that fails, is replaced or is never sent use `runComputerTool` with their own `ConfirmationQueue` and never deliver it.
 */
export async function runDelivered(args: Record<string, unknown>, context: ComputerToolContext): Promise<Record<string, unknown>> {
    const queue = context.confirmations ?? new ConfirmationQueue();
    const answer = await runComputerTool(args, { ...context, confirmations: queue });
    await queue.deliver();
    return answer;
}
