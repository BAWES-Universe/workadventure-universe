/**
 * An error to report to Sentry without the words of the original: a new error with the given summary that keeps the
 * original's stack frames (file and line, never its message). The message of a failed tool call can quote what the
 * tool was given or answered with (an email, a file), so it must not be reported, but where it failed is still needed.
 */
export function sanitizedError(original: unknown, summary: string): Error {
    const safe = new Error(summary);
    const stack = original instanceof Error ? original.stack : undefined;
    const firstFrame = stack ? stack.search(/\n\s+at /) : -1;
    if (stack && firstFrame >= 0) safe.stack = `Error: ${summary}${stack.slice(firstFrame)}`;
    return safe;
}

/**
 * The line a failed provider call leaves on its Sentry span: what kind of failure and the provider's status, never the
 * provider's words, which can quote the conversation (a message it refused, a tool argument it could not parse). Our
 * own timeout line has no outside words in it and is kept.
 */
export function providerFailureLine(error: unknown): string {
    const message = error instanceof Error ? error.message : '';
    if (/^\w+ request timeout after \d+ms$/.test(message)) return message;
    const status = /^\w+ API error: (\d{3})\b/.exec(message)?.[1];
    if (status) return `provider failed (${status})`;
    const name = error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(error.name) ? error.name : 'Error';
    return `provider failed (${name})`;
}
