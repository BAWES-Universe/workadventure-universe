<script lang="ts">
    import { LL } from "../../../i18n/i18n-svelte";
    import {
        noiseFilterStore,
        shownNoiseFilterStore,
        strongNoiseFilterStateStore,
        strongNoiseFilterSupported,
        voiceIsolationSupportedStore,
        type NoiseFilter,
    } from "../../Stores/NoiseFilterStore";

    function choose(filter: NoiseFilter) {
        // A new choice clears the "couldn't start" line.
        strongNoiseFilterStateStore.update((state) => (state === "failed" ? "off" : state));
        noiseFilterStore.set(filter);
    }

    $: choices = [
        { filter: "standard" as const, label: $LL.actionbar.noiseFilter.standard() },
        ...(strongNoiseFilterSupported
            ? [{ filter: "strong" as const, label: $LL.actionbar.noiseFilter.strong() }]
            : []),
        ...($voiceIsolationSupportedStore
            ? [{ filter: "voiceOnly" as const, label: $LL.actionbar.noiseFilter.voiceOnly() }]
            : []),
    ];
    $: starting = $shownNoiseFilterStore === "strong" && $strongNoiseFilterStateStore === "starting";
</script>

<!-- Only where there is something to choose: browsers without Strong or voice isolation keep today's filter. -->
{#if choices.length > 1}
    <div class="nf" data-testid="noise-filter">
        <div class="nf-head">
            <span class="nf-title" id="noise-filter-title">{$LL.actionbar.noiseFilter.title()}</span>
            {#if starting}<span class="nf-tag">{$LL.actionbar.noiseFilter.gettingReady()}</span>{/if}
        </div>
        <div class="nf-seg" class:three={choices.length === 3} role="radiogroup" aria-labelledby="noise-filter-title">
            {#each choices as choice (choice.filter)}
                <button
                    type="button"
                    role="radio"
                    aria-checked={$shownNoiseFilterStore === choice.filter}
                    class:on={$shownNoiseFilterStore === choice.filter}
                    on:click|stopPropagation={() => choose(choice.filter)}>{choice.label}</button
                >
            {/each}
        </div>
        {#if starting}
            <div class="nf-bar"><i /></div>
            <div class="nf-sub">{$LL.actionbar.noiseFilter.downloading()}</div>
        {:else if $strongNoiseFilterStateStore === "failed" && $shownNoiseFilterStore === "standard"}
            <div class="nf-sub err" role="status">{$LL.actionbar.noiseFilter.failed()}</div>
        {:else if $shownNoiseFilterStore === "strong"}
            <div class="nf-sub">{$LL.actionbar.noiseFilter.strongHint()}</div>
        {:else if $shownNoiseFilterStore === "voiceOnly"}
            <div class="nf-sub">{$LL.actionbar.noiseFilter.voiceOnlyHint()}</div>
        {:else}
            <div class="nf-sub">
                {strongNoiseFilterSupported
                    ? $LL.actionbar.noiseFilter.standardHint()
                    : $LL.actionbar.noiseFilter.standardHintNoStrong()}
            </div>
        {/if}
    </div>
{/if}

<style>
    .nf {
        margin: 0.375rem 0.25rem 2px;
        padding: 0.5rem;
        border-radius: 0.75rem;
        background: rgba(255, 255, 255, 0.04);
    }
    .nf-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 0.25rem 0.375rem;
    }
    .nf-title {
        font-size: 0.875rem;
        font-weight: 700;
    }
    .nf-tag {
        font-size: 11px;
        font-weight: 700;
        color: #c4b5fd;
    }
    .nf-seg {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 3px;
        padding: 3px;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.05);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
    }
    .nf-seg.three {
        grid-template-columns: 1fr 1fr 1fr;
    }
    .nf-seg.three button {
        font-size: 12px;
    }
    .nf-seg button {
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 4px;
        border: 1px solid transparent;
        border-radius: 9999px;
        font-size: 12.5px;
        white-space: nowrap;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.62);
        cursor: pointer;
        transition: background-color 150ms ease, color 150ms ease;
    }
    .nf-seg button:hover:not(.on) {
        color: #fff;
        background: rgba(255, 255, 255, 0.05);
    }
    .nf-seg button:focus-visible {
        outline: 2px solid rgba(196, 181, 253, 0.9);
        outline-offset: -2px;
    }
    .nf-seg button.on {
        background: rgba(134, 41, 252, 0.2);
        border-color: rgba(167, 139, 250, 0.45);
        color: #fff;
    }
    /* No byte count is exposed by the package, so the bar sweeps instead of claiming a percentage. */
    .nf-bar {
        position: relative;
        height: 4px;
        margin: 0.5rem 0.25rem 0;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.1);
        overflow: hidden;
    }
    .nf-bar i {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 40%;
        border-radius: 9999px;
        background: linear-gradient(90deg, #8629fc, #4156f6);
        animation: sweep 1.4s ease-in-out infinite;
    }
    @keyframes sweep {
        from {
            left: -40%;
        }
        to {
            left: 100%;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .nf-bar i {
            left: 30%;
            animation: none;
        }
    }
    .nf-sub {
        padding: 0.375rem 0.25rem 0;
        font-size: 0.75rem;
        line-height: 1.25;
        color: rgba(255, 255, 255, 0.6);
    }
    .nf-sub.err {
        color: #f08a70;
    }
</style>
