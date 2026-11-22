import { ConfirmationQueue, runComputerTool, type ComputerToolContext } from '../../ai/ComputerTools';

/** What the reply service and the bridge do once Matrix took the event that carries the words of the reply: the lines of the queued jobs are in it (`tell`), and its id confirms them. */
export async function deliverTold(queue: ConfirmationQueue, eventId = '$event:test'): Promise<void> {
    queue.tell();
    await queue.deliver(eventId);
}

/**
 * `runComputerTool` as a reply that WAS delivered to the person's chat: what the tool queued for confirmation is sent after the call returns, as the bridge does once its send went
 * through. Tests of a reply that fails, is replaced or is never sent use `runComputerTool` with their own `ConfirmationQueue` and never deliver it.
 */
export async function runDelivered(args: Record<string, unknown>, context: ComputerToolContext): Promise<Record<string, unknown>> {
    const queue = context.confirmations ?? new ConfirmationQueue();
    const answer = await runComputerTool(args, { ...context, confirmations: queue });
    await deliverTold(queue);
    return answer;
}
