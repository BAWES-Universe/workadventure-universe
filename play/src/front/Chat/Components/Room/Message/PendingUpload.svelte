<script lang="ts">
    import type { Readable } from "svelte/store";
    import type { ChatMessageContent } from "../../../Connection/ChatConnection";

    // MOCK: what a message with files shows while it is still on its way out, or when it could not be sent.
    // It sits over the message the chat already draws (a picture, a gallery, a file), which stays untouched.
    export let content: Readable<ChatMessageContent>;
    $: upload = $content.upload;
    const RING = 2 * Math.PI * 18;
</script>

{#if upload?.state === "sending"}
    <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded bg-black/45" data-testid="pendingUpload">
        <button
            type="button"
            class="relative flex h-11 w-11 items-center justify-center rounded-full border-0 bg-transparent p-0 text-white"
            aria-label="Cancel sending"
            data-testid="uploadCancel"
        >
            <svg class="absolute inset-0 -rotate-90" viewBox="0 0 44 44" aria-hidden="true">
                <circle cx="22" cy="22" r="18" fill="rgba(10,8,20,.55)" stroke="rgba(255,255,255,.25)" stroke-width="3" />
                <circle
                    cx="22"
                    cy="22"
                    r="18"
                    fill="none"
                    stroke="#fff"
                    stroke-width="3"
                    stroke-linecap="round"
                    stroke-dasharray={RING}
                    stroke-dashoffset={RING * (1 - (upload.percent ?? 0.05))}
                />
            </svg>
            <svg class="relative" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        {#if upload.reason}<span class="text-xs font-bold text-white">{upload.reason}</span>{/if}
    </div>
{:else if upload?.state === "waiting"}
    <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded bg-black/45" data-testid="pendingUploadWaiting">
        <button
            type="button"
            class="relative flex h-11 w-11 items-center justify-center rounded-full border-0 bg-transparent p-0 text-white"
            aria-label="Cancel sending"
            data-testid="uploadCancel"
        >
            <svg class="absolute inset-0" viewBox="0 0 44 44" aria-hidden="true">
                <circle cx="22" cy="22" r="18" fill="rgba(10,8,20,.55)" stroke="rgba(255,255,255,.25)" stroke-width="3" stroke-dasharray="4 5" />
            </svg>
            <svg class="relative" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <span class="text-xs font-bold text-white">{upload.reason ?? "Waiting"}</span>
    </div>
{:else if upload?.state === "failed"}
    <div class="flex flex-col gap-2 px-2 pb-1.5 pt-0.5">
        <p class="m-0 flex items-center gap-1.5 text-xs text-white/70" data-testid="messageNotSent">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" /></svg>
            Not sent. {upload.reason}
        </p>
        <div class="flex items-center gap-2">
            <button type="button" class="u-cta h-11 rounded-full border-0 px-5 text-sm font-bold" data-testid="uploadRetry">Try again</button>
            <button type="button" class="h-11 rounded-full border-0 bg-transparent px-4 text-sm font-bold text-white/80" data-testid="uploadRemove">Remove</button>
        </div>
    </div>
{/if}
