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
