/**
 * Link an external AbortSignal to an internal controller so cancel/update
 * closes the upstream stream immediately, instead of waiting for the next
 * chunk to be pulled (which may never come if the provider stalls).
 *
 * Shared by all providers (LMStudioProvider, OpenAIProvider) so the
 * missing-signal, already-aborted, and one-time-listener handling stays
 * consistent in one place.
 */
export function linkExternalAbort(externalSignal: AbortSignal | undefined, controller: AbortController): void {
    if (!externalSignal) return;
    if (externalSignal.aborted) {
        controller.abort();
        return;
    }
    externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
}
