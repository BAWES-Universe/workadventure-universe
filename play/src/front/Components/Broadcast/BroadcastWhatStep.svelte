<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import LL from "../../../i18n/i18n-svelte";
    import type { BroadcastKind } from "../../Stores/BroadcastStore";
    import { IconChevronRight, IconMessage, IconMicrophone, IconSpeakerPhone } from "@wa-icons";

    /** Written and voice notes (admins). */
    export let canMessage = false;
    /** At least one reach this player may go live at. */
    export let canGoLive = false;
    /** May open the room's broadcast settings. */
    export let canConfigure = false;

    const dispatch = createEventDispatcher<{ choose: BroadcastKind; settings: void }>();
</script>

{#if !canMessage && !canGoLive}
    <div class="flex flex-col items-center text-center gap-3 py-6 px-2">
        <span class="grid place-items-center text-white/60" aria-hidden="true">
            <IconSpeakerPhone font-size="28" />
        </span>
        <p class="m-0 text-base font-semibold">{$LL.broadcast.off.title()}</p>
        <p class="m-0 text-sm text-white/60">
            {canConfigure ? $LL.broadcast.off.admin() : $LL.broadcast.off.other()}
        </p>
        {#if canConfigure}
            <button
                type="button"
                class="u-cta rounded-full px-6 py-3 text-sm font-bold"
                on:click={() => dispatch("settings")}
                data-testid="broadcast-turn-on"
            >
                {$LL.broadcast.off.turnOn()}
            </button>
        {/if}
    </div>
{:else}
    <h3 class="m-0 text-base font-semibold">{$LL.broadcast.what.title()}</h3>
    <div class="flex flex-col gap-2">
        {#if canMessage}
            <button
                type="button"
                class="u-option"
                on:click={() => dispatch("choose", "message")}
                data-testid="broadcast-kind-message"
            >
                <span class="u-option-tile" aria-hidden="true"><IconMessage /></span>
                <span class="u-option-text">
                    <span class="u-option-title block">{$LL.broadcast.what.message.title()}</span>
                    <span class="u-option-desc block">{$LL.broadcast.what.message.desc()}</span>
                </span>
                <IconChevronRight font-size="18" class="u-option-go rtl:-scale-x-100" aria-hidden="true" />
            </button>
            <button
                type="button"
                class="u-option"
                on:click={() => dispatch("choose", "voice")}
                data-testid="broadcast-kind-voice"
            >
                <span class="u-option-tile u-tile-gold" aria-hidden="true"><IconMicrophone /></span>
                <span class="u-option-text">
                    <span class="u-option-title block">{$LL.broadcast.what.voice.title()}</span>
                    <span class="u-option-desc block">{$LL.broadcast.what.voice.desc()}</span>
                </span>
                <IconChevronRight font-size="18" class="u-option-go rtl:-scale-x-100" aria-hidden="true" />
            </button>
        {/if}
        <button
            type="button"
            class="u-option"
            disabled={!canGoLive}
            on:click={() => dispatch("choose", "live")}
            data-testid="broadcast-kind-live"
        >
            <span class="u-option-tile u-tile-coral" aria-hidden="true"><IconSpeakerPhone /></span>
            <span class="u-option-text">
                <span class="u-option-title block">{$LL.broadcast.what.live.title()}</span>
                <span class="u-option-desc block">
                    {canGoLive ? $LL.broadcast.what.live.desc() : $LL.broadcast.what.live.notAllowed()}
                </span>
            </span>
            <IconChevronRight font-size="18" class="u-option-go rtl:-scale-x-100" aria-hidden="true" />
        </button>
    </div>
    <p class="m-0 text-center text-xs text-white/50">{$LL.broadcast.what.hint()}</p>
{/if}
