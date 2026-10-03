<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount } from "svelte";
    import LL from "../../../i18n/i18n-svelte";
    import type { BroadcastReach } from "../../Stores/BroadcastStore";
    import { menuInputFocusStore } from "../../Stores/MenuInputFocusStore";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { reachTitle } from "./reach";
    import { sendBroadcastText } from "./send";
    import { IconSpeakerPhone, IconX } from "@wa-icons";

    export let reach: BroadcastReach;

    const dispatch = createEventDispatcher<{ sent: void }>();

    let text = "";
    let error: string | undefined;
    let textarea: HTMLTextAreaElement;

    onMount(() => {
        // The game must not read the keys typed here as moves.
        menuInputFocusStore.set(true);
        textarea?.focus();
    });
    onDestroy(() => menuInputFocusStore.set(false));

    function send() {
        if (text.trim() === "") {
            error = $LL.broadcast.write.empty();
            return;
        }
        try {
            analyticsClient.sendGlocalTextMessage();
            sendBroadcastText(text, reach);
            dispatch("sent");
        } catch (e) {
            console.error(e);
            error = $LL.broadcast.write.sendFailed();
        }
    }
</script>

<textarea
    class="u-field min-h-[7rem]"
    rows="4"
    placeholder={$LL.broadcast.write.placeholder()}
    bind:value={text}
    bind:this={textarea}
    on:input={() => (error = undefined)}
    data-testid="broadcast-text"
/>
{#if error}
    <div class="u-error-line" role="alert">
        <span class="flex-1">{error}</span>
        <button
            type="button"
            class="u-chip-remove"
            on:click={() => (error = undefined)}
            aria-label={$LL.broadcast.close()}
        >
            <IconX font-size="14" />
        </button>
    </div>
{/if}
<button
    type="button"
    class="u-cta rounded-full w-full py-3.5 text-base font-bold flex items-center justify-center gap-2"
    on:click={send}
    data-testid="broadcast-send"
>
    <IconSpeakerPhone font-size="18" aria-hidden="true" />
    {$LL.broadcast.reach.sendTo({ reach: reachTitle($LL, reach) })}
</button>
