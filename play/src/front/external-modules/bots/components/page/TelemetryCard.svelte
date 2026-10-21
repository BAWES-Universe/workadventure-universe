<script lang="ts">
    // One row card with the "Bot chat telemetry" switch, used by the bot page's Advanced settings and by
    // the New bot form. "What's sent" opens the explainer popup. When the universe has turned it off, the switch is
    // off, locked, and the line under it says where to change it.
    import LL from "../../../../../i18n/i18n-svelte";
    import TelemetryInfo from "./TelemetryInfo.svelte";
    import { IconLock } from "@wa-icons";

    export let on: boolean;
    export let locked = false;
    /** Why the last change was not saved: the switch is back where Orbit holds it, and this says so. */
    export let error: string | undefined = undefined;
    export let onChange: (on: boolean) => void;

    $: text = $LL.mapEditor.edit.bots.page.telemetry;

    let infoOpen = false;
    $: checked = on && !locked;
</script>

<div class="u-option tm-card" data-testid="bot-telemetry-card">
    <div class="u-option-text">
        <div class="u-option-title" id="bot-telemetry-label">{text.switchTitle()}</div>
        <div class="u-option-desc tm-hint">
            {#if locked}
                {text.lockedHint()}
            {:else}
                {text.hint()}
            {/if}
            <button type="button" class="tm-link" data-testid="bot-telemetry-info" on:click={() => (infoOpen = true)}
                >{text.whatsSent()}</button
            >
        </div>
        {#if error}
            <div class="tm-error" role="alert" data-testid="bot-telemetry-error">{error}</div>
        {/if}
    </div>
    {#if locked}
        <span class="tm-lock" title={text.lockedBy()} aria-hidden="true"><IconLock font-size="16" /></span>
    {/if}
    <button
        type="button"
        role="switch"
        class="u-switch tm-switch"
        aria-checked={checked}
        aria-labelledby="bot-telemetry-label"
        disabled={locked}
        data-testid="bot-telemetry-switch"
        on:click={() => onChange(!on)}
    />
</div>

{#if infoOpen}
    <TelemetryInfo onClose={() => (infoOpen = false)} />
{/if}

<style>
    /* The game's row card, as a plain container: the switch is what takes the tap */
    .tm-card {
        gap: 12px;
        cursor: default;
    }
    @media (hover: hover) {
        .tm-card:hover:not(:disabled) {
            background: rgba(255, 255, 255, 0.04);
            border-color: rgba(255, 255, 255, 0.08);
        }
    }
    .tm-hint {
        line-height: 1.4;
    }
    .tm-link {
        display: inline;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        font: inherit;
        color: rgba(255, 255, 255, 0.85);
        text-decoration: underline;
        text-underline-offset: 2px;
        cursor: pointer;
        white-space: nowrap;
    }
    @media (hover: hover) {
        .tm-link:hover {
            color: #fff;
        }
    }
    .tm-link:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
        border-radius: 4px;
    }
    .tm-error {
        margin-top: 4px;
        font-size: 12.5px;
        line-height: 1.4;
        color: #fecaca;
    }
    .tm-lock {
        display: grid;
        place-items: center;
        flex: none;
        color: rgba(255, 255, 255, 0.6);
        margin-inline-end: -4px;
    }
    /* A 44 px tap target around the 46 x 26 track */
    .tm-switch::before {
        content: "";
        position: absolute;
        inset: -9px -1px;
    }
</style>
