export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(what: string, condition: () => boolean, timeoutMs = 10000): Promise<void> {
    const started = Date.now();
    while (!condition()) {
        if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
        await sleep(20);
    }
}
