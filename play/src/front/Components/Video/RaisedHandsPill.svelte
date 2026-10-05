<script lang="ts">
    import { fly } from "svelte/transition";
    import LL from "../../../i18n/i18n-svelte";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import { userIsAdminStore } from "../../Stores/GameStore";
    import { lowerHand, raisedHandsStore, type RaisedHand } from "../../Space/RaiseHand/RaiseHandStore";
    import type { SpaceUserExtended } from "../../Space/SpaceInterface";
    import { canInviteToSpeakStore, pendingInvitesStore } from "../../Space/RaiseHand/PodiumStore";
    import { IconHandStop } from "@wa-icons";
    import RaisedHandWoka from "./RaisedHandWoka.svelte";

    /** In the phone's chat sheet header: "✋ 2", and the list opens downwards, from the right. */
    export let compact = false;

    const myUuid = localUserStore.getLocalUser()?.uuid ?? "";

    let open = false;
    let root: HTMLDivElement | undefined;
    // Near the bottom of the screen (a phone's chat sheet is open), the list opens upwards.
    let upwards = false;

    $: hands = $raisedHandsStore;
    $: if (hands.length === 0) open = false;

    function toggle() {
        if (!open && root && !compact) {
            upwards = root.getBoundingClientRect().bottom > window.innerHeight / 2;
        }
        open = !open;
    }

    function lower(hand: RaisedHand) {
        if (hand.uuid === myUuid) {
            lowerHand();
            analyticsClient.lowerHand("self");
            return;
        }
        // The pusher only lets admins do it.
        hand.user.emitPrivateEvent({ $case: "lowerHand", lowerHand: {} });
    }

    function inviteToSpeak(hand: RaisedHand) {
        pendingInvitesStore.update((invites) => new Set(invites).add(hand.uuid));
    }

    function lowerAll() {
        // Each conversation with a hand up: a person in two of them is lowered in both by their own client.
        const spaces = new Set<SpaceUserExtended["space"]>(hands.map((hand) => hand.user.space));
        for (const space of spaces) {
            space.emitPublicMessage({ $case: "lowerAllHands", lowerAllHands: {} });
        }
        open = false;
    }

    function onWindowPointerDown(event: PointerEvent) {
        if (open && root && !root.contains(event.target as Node)) open = false;
    }

    function onWindowKeydown(event: KeyboardEvent) {
        if (open && event.key === "Escape") open = false;
    }
</script>

<svelte:window on:pointerdown={onWindowPointerDown} on:keydown={onWindowKeydown} />

<!-- "N raised" under the videos: the people waiting to speak, in the order their hands went up. -->
{#if hands.length > 0}
    <div class="raised-hands" bind:this={root} transition:fly={{ y: -6, duration: 160 }}>
        <button
            type="button"
            class="raised-pill"
            class:compact
            aria-expanded={open}
            aria-label={$LL.say.raiseHand.listOpen()}
            data-testid="raised-hands-pill"
            on:click={toggle}
        >
            <span class="raised-pill-emoji" aria-hidden="true">✋</span>
            {compact ? hands.length : $LL.say.raiseHand.raisedCount({ count: hands.length })}
        </button>
        {#if open}
            <div
                class="raised-list"
                class:wide={$canInviteToSpeakStore}
                class:upwards
                class:compact
                role="dialog"
                aria-label={$LL.say.raiseHand.listTitle()}
                data-testid="raised-hands-list"
            >
                <p class="raised-title"><span aria-hidden="true">✋</span>{$LL.say.raiseHand.listTitle()}</p>
                <ol class="raised-rows">
                    {#each hands as hand (hand.uuid)}
                        <li class="raised-row" data-testid="raised-hand-row">
                            <span class="raised-number">{hand.position}</span>
                            <span class="raised-woka"><RaisedHandWoka picture={hand.user.pictureStore} /></span>
                            <span class="raised-name">{hand.uuid === myUuid ? $LL.say.raiseHand.you() : hand.name}</span
                            >
                            {#if $canInviteToSpeakStore && hand.uuid !== myUuid}
                                {#if $pendingInvitesStore.has(hand.uuid)}
                                    <span class="raised-invited" data-testid="raised-hand-invited"
                                        >{$LL.say.raiseHand.invited()}</span
                                    >
                                {:else}
                                    <button
                                        type="button"
                                        class="u-cta raised-invite"
                                        data-testid="raised-hand-invite"
                                        on:click={() => inviteToSpeak(hand)}>{$LL.say.raiseHand.inviteToSpeak()}</button
                                    >
                                {/if}
                            {/if}
                            {#if hand.uuid === myUuid || $userIsAdminStore}
                                <!-- Next to Invite to speak there is only room for the icon. -->
                                <button
                                    type="button"
                                    class="raised-lower"
                                    class:icon-only={$canInviteToSpeakStore}
                                    aria-label={$LL.say.raiseHand.lowerSomeone()}
                                    title={$LL.say.raiseHand.lowerSomeone()}
                                    data-testid="raised-hand-lower"
                                    on:click={() => lower(hand)}
                                    >{#if $canInviteToSpeakStore}<IconHandStop
                                            font-size="16"
                                            aria-hidden="true"
                                        />{:else}{$LL.say.raiseHand.lowerSomeone()}{/if}</button
                                >
                            {/if}
                        </li>
                    {/each}
                </ol>
                {#if $userIsAdminStore && hands.length > 1}
                    <button
                        type="button"
                        class="raised-lower-all"
                        data-testid="raised-hands-lower-all"
                        on:click={lowerAll}>{$LL.say.raiseHand.lowerAll()}</button
                    >
                {/if}
            </div>
        {/if}
    </div>
{/if}

<style>
    .raised-hands {
        position: relative;
        pointer-events: auto;
    }
    /* The ink of the bar's pills, with the ✋ button's gold edge. */
    .raised-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 32px;
        padding: 0 12px 0 9px;
        border: 0;
        border-radius: 9999px;
        background: var(--u-surface-bg);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        box-shadow: inset 0 0 0 1px rgba(245, 196, 81, 0.55);
        color: #fff;
        font-size: 13px;
        font-weight: 700;
        white-space: nowrap;
        cursor: pointer;
    }
    .raised-pill-emoji {
        font-size: 15px;
        line-height: 1;
    }
    @media (hover: hover) {
        .raised-pill:hover {
            box-shadow: inset 0 0 0 1px rgba(245, 196, 81, 0.9);
        }
    }
    .raised-pill:focus-visible,
    .raised-lower:focus-visible,
    .raised-lower-all:focus-visible {
        outline: 2px solid #8629fc;
        outline-offset: 2px;
    }
    .raised-list {
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        z-index: 60;
        display: flex;
        flex-direction: column;
        gap: 6px;
        width: 268px;
        max-width: calc(100vw - 32px);
        padding: 12px;
        border-radius: 16px;
        background: var(--u-surface-bg);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        box-shadow: inset 0 0 0 1px var(--u-surface-edge), 0 16px 40px rgba(0, 0, 0, 0.55);
        color: #fff;
    }
    .raised-pill.compact {
        height: 32px;
        padding: 0 10px 0 8px;
        gap: 4px;
    }
    .raised-list.compact {
        left: auto;
        right: 0;
    }
    .raised-list.wide {
        width: 320px;
    }
    .raised-invite {
        flex: none;
        height: 32px;
        margin: 0;
        padding: 0 12px;
        border-radius: 9999px;
        font-size: 13px;
        font-weight: 700;
    }
    .raised-invited {
        flex: none;
        padding: 0 6px;
        color: #c4b5fd;
        font-size: 13px;
        font-weight: 700;
    }
    .raised-list.upwards {
        top: auto;
        bottom: calc(100% + 6px);
    }
    .raised-title {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0 0 2px;
        font-size: 15px;
        font-weight: 700;
    }
    .raised-rows {
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 240px;
        margin: 0;
        padding: 0;
        overflow-y: auto;
        list-style: none;
    }
    .raised-row {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 40px;
        font-size: 14px;
    }
    .raised-number {
        display: grid;
        place-items: center;
        flex: none;
        width: 22px;
        height: 22px;
        border-radius: 9999px;
        background: rgba(245, 196, 81, 0.16);
        color: #f5c451;
        font-size: 12px;
        font-weight: 800;
    }
    .raised-woka {
        display: grid;
        place-items: center;
        flex: none;
        width: 28px;
        height: 28px;
    }
    .raised-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .raised-lower,
    .raised-lower-all {
        flex: none;
        height: 32px;
        padding: 0 12px;
        border: 0;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.08);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
        color: #fff;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
    }
    .raised-lower.icon-only {
        display: grid;
        place-items: center;
        width: 32px;
        padding: 0;
    }
    .raised-lower-all {
        width: 100%;
        height: 36px;
        margin-top: 4px;
    }
    @media (hover: hover) {
        .raised-lower:hover,
        .raised-lower-all:hover {
            background: rgba(255, 255, 255, 0.14);
        }
    }
</style>
