<script lang="ts">
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import LL from "../../../../i18n/i18n-svelte";
    import { localUserStore } from "../../../Connection/LocalUserStore";
    import {
        canRaiseHandStore,
        lowerHand,
        myHandPositionStore,
        raiseHand,
    } from "../../../Space/RaiseHand/RaiseHandStore";
    import { keepHandOfferStore } from "../../../Space/RaiseHand/AutoLowerHand";
    import { speakingFromAudienceStore, speakInvitationStore } from "../../../Space/RaiseHand/PodiumStore";

    const positionStore = myHandPositionStore(localUserStore.getLocalUser()?.uuid ?? "");
    $: handUp = $positionStore !== undefined;

    $: label = !handUp
        ? $LL.say.raiseHand.raise()
        : $positionStore === 1
        ? `${$LL.say.raiseHand.lower()} · ${$LL.say.raiseHand.next()}`
        : $positionStore
        ? `${$LL.say.raiseHand.lower()} · ${$LL.say.raiseHand.inLine({ position: $positionStore })}`
        : $LL.say.raiseHand.lower();

    function toggle() {
        if (handUp) {
            lowerHand();
            analyticsClient.lowerHand("self");
        } else {
            raiseHand();
            analyticsClient.raiseHand();
        }
    }
</script>

<!-- Raise hand, between the zoom pill and Express, Express's size and ink. It is only there in a bubble or a meeting
     room: its space opens, pushing the zoom pill up, then the ✋ pops in; leaving, it fades and the space closes. While
     the hand is up it turns gold with the place in line. -->
<div class="hand-slot" class:shown={$canRaiseHandStore} aria-hidden={!$canRaiseHandStore}>
    <div class="hand-wrap" class:pointer-events-auto={$canRaiseHandStore}>
        {#if $speakInvitationStore}
            <!-- A speaker invites us on stage: nothing goes live until we say so. -->
            <div class="keep-callout invite-callout" role="alertdialog" data-testid="speak-invitation">
                <p class="keep-text">{$LL.say.raiseHand.invitesYou({ name: $speakInvitationStore.fromName })}</p>
                <p class="callout-hint">{$LL.say.raiseHand.invitesYouHint()}</p>
                <div class="callout-actions">
                    <button
                        type="button"
                        class="u-cta m-0 h-9 flex-1 justify-center rounded-full px-4 text-sm font-bold"
                        data-testid="speak-invitation-accept"
                        on:click={() => $speakInvitationStore?.accept()}>{$LL.say.raiseHand.startSpeaking()}</button
                    >
                    <button
                        type="button"
                        class="callout-secondary"
                        data-testid="speak-invitation-decline"
                        on:click={() => $speakInvitationStore?.decline()}>{$LL.say.raiseHand.notNow()}</button
                    >
                </div>
            </div>
        {:else if $speakingFromAudienceStore}
            <!-- Live from the audience: stays until we stop or the speaker moves us back. -->
            <div class="keep-callout live-callout" role="status" data-testid="speaking-from-audience">
                <p class="keep-text live-text">
                    <span class="live-dot" aria-hidden="true" />{$LL.say.raiseHand.speakingNow()}
                </p>
                <button
                    type="button"
                    class="callout-secondary w-full"
                    data-testid="stop-speaking"
                    on:click={() => $speakingFromAudienceStore?.stop()}>{$LL.say.raiseHand.stopSpeaking()}</button
                >
            </div>
        {:else if $keepHandOfferStore}
            <!-- After you talk with your hand up: it goes down when the bar runs out, unless you keep it. -->
            <div class="keep-callout" role="status" data-testid="keep-hand-raised">
                <p class="keep-text">{$LL.say.raiseHand.spoke()}</p>
                <div class="keep-bar" aria-hidden="true">
                    <div style:animation-duration="{$keepHandOfferStore.durationMs}ms" />
                </div>
                <button
                    type="button"
                    class="u-cta m-0 h-9 w-full justify-center rounded-full px-4 text-sm font-bold"
                    data-testid="keep-hand-raised-button"
                    on:click={() => $keepHandOfferStore?.keep()}>{$LL.say.raiseHand.keepRaised()}</button
                >
            </div>
        {/if}
        <button
            type="button"
            class="hand-btn"
            class:up={handUp}
            aria-label={label}
            aria-pressed={handUp}
            tabindex={$canRaiseHandStore ? 0 : -1}
            disabled={!$canRaiseHandStore}
            data-testid="raise-hand-button"
            on:click={toggle}
        >
            <span class="hand-emoji" aria-hidden="true">✋</span>
            {#if handUp && $positionStore}
                <span class="hand-badge" aria-hidden="true" data-testid="raise-hand-position">{$positionStore}</span>
            {/if}
            <span class="hand-tip" aria-hidden="true">{label}</span>
        </button>
    </div>
</div>

<style>
    /* Closed, the slot takes no room: the -8px cancels the column's gap, so the zoom pill sits on Express as before. */
    .hand-slot {
        display: grid;
        grid-template-rows: 0fr;
        margin-top: -8px;
        visibility: hidden;
        transition: grid-template-rows 280ms cubic-bezier(0.2, 0, 0, 1) 140ms,
            margin-top 280ms cubic-bezier(0.2, 0, 0, 1) 140ms, visibility 0s linear 420ms;
    }
    .hand-slot.shown {
        grid-template-rows: 1fr;
        margin-top: 0;
        visibility: visible;
        transition-delay: 0s;
    }
    /* Express's size: 64px, 56px between 640px and 1280px wide on a computer, 64px on any touch screen. */
    .hand-wrap {
        --hand-btn: 64px;
        position: relative;
        min-height: 0;
        /* Held 8px further up off Express than the column's gap, like the zoom pill. */
        padding-bottom: 8px;
    }
    @media (min-width: 640px) and (max-width: 1279.98px) {
        .hand-wrap {
            --hand-btn: 56px;
        }
    }
    @media (pointer: coarse) {
        .hand-wrap {
            --hand-btn: 64px;
        }
    }
    .hand-btn {
        position: relative;
        display: grid;
        place-items: center;
        width: var(--hand-btn);
        height: var(--hand-btn);
        padding: 0;
        border: 0;
        border-radius: 9999px;
        color: #fff;
        cursor: pointer;
        background: var(--u-surface-bg);
        backdrop-filter: blur(18px) saturate(140%);
        -webkit-backdrop-filter: blur(18px) saturate(140%);
        box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08) inset, 0 0 0 1px var(--u-surface-edge);
        opacity: 0;
        transform: scale(0.5);
        transition: opacity 180ms ease, transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 200ms ease;
        -webkit-tap-highlight-color: transparent;
    }
    .shown .hand-btn {
        opacity: 1;
        transform: scale(1);
        transition-delay: 160ms;
    }
    .shown .hand-btn:active {
        transform: scale(0.9);
        transition-delay: 0s;
    }
    @media (hover: hover) {
        .hand-btn:hover {
            background: linear-gradient(rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.06)), var(--u-surface-bg);
            box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08) inset, 0 0 0 1px rgba(167, 139, 250, 0.3);
        }
        .hand-btn.up:hover {
            background: linear-gradient(rgba(245, 196, 81, 0.22), rgba(245, 196, 81, 0.22)), var(--u-surface-bg);
            box-shadow: inset 0 0 0 1.5px rgba(245, 196, 81, 0.9), 0 0 22px -4px rgba(245, 196, 81, 0.7);
        }
    }
    .hand-btn.up {
        background: linear-gradient(rgba(245, 196, 81, 0.14), rgba(245, 196, 81, 0.14)), var(--u-surface-bg);
        box-shadow: inset 0 0 0 1.5px rgba(245, 196, 81, 0.8), 0 0 20px -4px rgba(245, 196, 81, 0.6);
    }
    .hand-btn:focus-visible {
        outline: 2px solid #8629fc;
        outline-offset: 2px;
    }
    .hand-emoji {
        font-size: 1.9rem;
        line-height: 1;
    }
    /* Top-left, towards the screen, so the right edge of a phone never cuts it. */
    .hand-badge {
        position: absolute;
        top: -6px;
        left: -6px;
        min-width: 20px;
        height: 20px;
        padding: 0 5px;
        border-radius: 9999px;
        background: #f5c451;
        color: #1d1606;
        font-size: 0.75rem;
        font-weight: 800;
        line-height: 20px;
        text-align: center;
        box-shadow: 0 0 0 2px #14121e;
    }
    /* The ink tooltip, to the left of the button, like the zoom pill's. */
    .hand-tip {
        position: absolute;
        top: 50%;
        right: calc(var(--hand-btn) + 12px);
        transform: translateY(-50%);
        padding: 6px 10px;
        border-radius: 10px;
        background: linear-gradient(180deg, rgb(31 28 47 / 0.96), rgb(20 18 30 / 0.97));
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        color: #fff;
        font-size: 0.875rem;
        font-weight: 600;
        white-space: nowrap;
        pointer-events: none;
        opacity: 0;
        transition: opacity 150ms ease;
    }
    @media (hover: hover) {
        .hand-btn:hover .hand-tip {
            opacity: 1;
        }
    }
    .hand-btn:focus-visible .hand-tip {
        opacity: 1;
    }
    /* The ink callout to the left of the button, with the brand button. */
    .keep-callout {
        position: absolute;
        right: calc(100% + 10px);
        top: calc(50% - 4px);
        transform: translateY(-50%);
        width: 288px;
        max-width: calc(100vw - var(--hand-btn) - 32px);
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 12px;
        border-radius: 16px;
        background: linear-gradient(180deg, rgb(31 28 47 / 0.96), rgb(20 18 30 / 0.97));
        box-shadow: inset 0 0 0 1px rgba(245, 196, 81, 0.35), 0 12px 32px -12px rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(18px) saturate(140%);
        -webkit-backdrop-filter: blur(18px) saturate(140%);
        color: #fff;
        animation: callout-in 220ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
    }
    .invite-callout {
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.45), 0 12px 32px -12px rgba(0, 0, 0, 0.6);
    }
    .live-callout {
        box-shadow: inset 0 0 0 1.5px rgba(134, 41, 252, 0.85), 0 0 22px -6px rgba(134, 41, 252, 0.7);
    }
    .callout-hint {
        margin: -4px 0 0;
        color: rgba(255, 255, 255, 0.65);
        font-size: 0.8125rem;
        line-height: 1.35;
    }
    .callout-actions {
        display: flex;
        gap: 8px;
    }
    .callout-secondary {
        height: 36px;
        padding: 0 14px;
        border: 0;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.08);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
        color: #fff;
        font-size: 0.875rem;
        font-weight: 700;
        cursor: pointer;
    }
    @media (hover: hover) {
        .callout-secondary:hover {
            background: rgba(255, 255, 255, 0.14);
        }
    }
    .live-text {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .live-dot {
        flex: none;
        width: 8px;
        height: 8px;
        border-radius: 9999px;
        background: #8629fc;
        box-shadow: 0 0 0 3px rgba(134, 41, 252, 0.3);
        animation: live-pulse 1.6s ease-in-out infinite;
    }
    @keyframes live-pulse {
        50% {
            box-shadow: 0 0 0 6px rgba(134, 41, 252, 0);
        }
    }
    .keep-text {
        margin: 0;
        font-size: 0.875rem;
        font-weight: 600;
        line-height: 1.3;
    }
    .keep-bar {
        height: 4px;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.1);
        overflow: hidden;
    }
    .keep-bar div {
        height: 100%;
        border-radius: 9999px;
        background: #f5c451;
        transform-origin: left;
        animation-name: keep-empty;
        animation-timing-function: linear;
        animation-fill-mode: forwards;
    }
    :global([dir="rtl"]) .keep-bar div {
        transform-origin: right;
    }
    @keyframes keep-empty {
        from {
            transform: scaleX(1);
        }
        to {
            transform: scaleX(0);
        }
    }
    @keyframes callout-in {
        from {
            opacity: 0;
            transform: translate(8px, -50%);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .hand-slot,
        .hand-btn,
        .shown .hand-btn {
            transition: none;
        }
        .keep-callout {
            animation: none;
        }
        .keep-bar {
            display: none;
        }
        .live-dot {
            animation: none;
        }
    }
</style>
