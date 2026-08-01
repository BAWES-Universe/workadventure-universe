/**
 * Link an external AbortSignal to an internal controller so cancel/update
 * closes the upstream stream immediately, instead of waiting for the next
 * chunk to be pulled (which may never come if the provider stalls).
 *
 * Shared by all providers (LMStudioProvider, OpenAIProvider) so the
 * missing-signal, already-aborted, and one-time-listener handling stays
 * consistent in one place.
 *
 * Returns a cleanup function that removes the abort listener. Providers must
 * call it in their finally block so the listener is released after normal
 * completion, timeout, or abort — the external signal (e.g. a conversation's
 * per-generation controller) can outlive the request, and a lingering listener
 * would otherwise hold a closure over a dead internal controller.
 */
export function linkExternalAbort(externalSignal: AbortSignal | undefined, controller: AbortController): () => void {
    if (!externalSignal) return () => {};
    if (externalSignal.aborted) {
        controller.abort();
        return () => {};
    }
    const onAbort = () => controller.abort();
    externalSignal.addEventListener('abort', onAbort, { once: true });
    return () => externalSignal.removeEventListener('abort', onAbort);
}
