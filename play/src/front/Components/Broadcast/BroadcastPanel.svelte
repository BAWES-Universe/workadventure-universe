<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { fly } from "svelte/transition";
    import LL from "../../../i18n/i18n-svelte";
    import type { BroadcastKind, BroadcastReach } from "../../Stores/BroadcastStore";
    import {
        broadcastPanelOpenStore,
        broadcastPanelSettingsStore,
        broadcastReachInfoStore,
    } from "../../Stores/BroadcastStore";
    import { megaphoneChannelsStore } from "../../Stores/MegaphoneStore";
    import { exploreStore } from "../../Stores/ExploreStore";
    import { userIsAdminStore } from "../../Stores/GameStore";
    import { mapEditorActivated } from "../../Stores/MenuStore";
    import { displayedMegaphoneScreenStore } from "../../Stores/MediaStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import BroadcastWhatStep from "./BroadcastWhatStep.svelte";
    import BroadcastWhoStep from "./BroadcastWhoStep.svelte";
    import BroadcastWriteStep from "./BroadcastWriteStep.svelte";
    import BroadcastVoiceStep from "./BroadcastVoiceStep.svelte";
    import BroadcastLiveStep from "./BroadcastLiveStep.svelte";
    import BroadcastSettings from "./BroadcastSettings.svelte";
    import { isBroadcastReach, REACH_ORDER, reachSummary } from "./reach";
    import { IconAdjustements, IconChevronLeft, IconSpeakerPhone, IconX } from "@wa-icons";

    type View = "what" | "who" | "compose" | "settings";

    let view: View = $broadcastPanelSettingsStore ? "settings" : "what";
    let kind: BroadcastKind | undefined = undefined;
    let reach: BroadcastReach | undefined = undefined;

    // Admins and people who may edit the room set who can go live here and how far they reach.
    $: canConfigure = $userIsAdminStore || $mapEditorActivated;
    // Written and voice notes are sent by the server to whole rooms: admins only.
    $: canMessage = $userIsAdminStore;

    // The room belongs to a world (and a universe) only when Orbit knows it.
    const roomGroup = gameManager.currentStartedRoom?.group ?? null;

    $: liveReaches = REACH_ORDER.filter((candidate) =>
        $megaphoneChannelsStore.some(
            (channel) => channel.canStream && isBroadcastReach(channel.scope) && channel.scope === candidate
        )
    );
    // The universe row waits for Orbit's answer: a room served without Orbit has a group but no universe.
    $: messageReaches = REACH_ORDER.filter(
        (candidate) =>
            candidate === "ROOM" ||
            (roomGroup !== null && (candidate !== "UNIVERSE" || $broadcastReachInfoStore.universeName !== undefined))
    );

    function reachesFor(chosen: BroadcastKind): BroadcastReach[] {
        return chosen === "live" ? liveReaches : messageReaches;
    }

    function choose(chosen: BroadcastKind) {
        const reaches = reachesFor(chosen);
        // The reach list can empty between the row's render and the tap (the room's settings just changed).
        if (reaches.length === 0) return;
        kind = chosen;
        if (chosen === "live") analyticsClient.openMegaphone();
        else if (chosen === "message") analyticsClient.openGlobalMessage();
        else analyticsClient.openGlobalAudio();
        // One reach only: nothing to choose, the send button names it.
        if (reaches.length === 1) {
            reach = reaches[0];
            view = "compose";
        } else {
            reach = reaches.includes("WORLD") ? "WORLD" : reaches[0];
            view = "who";
        }
    }

    function back() {
        if (view === "compose" && kind && reachesFor(kind).length > 1) {
            view = "who";
            return;
        }
        view = "what";
        kind = undefined;
        reach = undefined;
    }

    function close() {
        broadcastPanelOpenStore.set(false);
    }

    function onKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") close();
    }

    // The reaches say how many people they cover right now: ask again each time the card opens.
    onMount(() => exploreStore.refresh());
    onDestroy(() => {
        displayedMegaphoneScreenStore.set(false);
        broadcastPanelSettingsStore.set(false);
    });

    $: step = view === "what" ? 1 : view === "who" ? 2 : 3;
    $: title =
        view === "settings"
            ? $LL.broadcast.settings()
            : kind === "message"
            ? $LL.broadcast.what.message.title()
            : kind === "voice"
            ? $LL.broadcast.what.voice.title()
            : kind === "live"
            ? $LL.broadcast.what.live.title()
            : $LL.broadcast.title();
    $: subtitle =
        view === "settings"
            ? $broadcastReachInfoStore.roomName
            : view === "compose" && reach
            ? reachSummary($LL, reach, $broadcastReachInfoStore)
            : "";
</script>

<svelte:window on:keydown={onKeyDown} />

<!-- Over the map and beside the bar, never over it: the game stays usable while the card is open. A phone has the
     card at the top, under the status bar; a desktop centres it like a dialog. -->
<div
    class="fixed z-[1200] pointer-events-auto inset-x-3 top-8 lg:inset-x-auto lg:top-1/2 lg:left-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-[420px]"
    transition:fly={{ y: -16, duration: 180 }}
    data-testid="broadcast-panel"
>
    <div
        class="broadcast-card u-surface rounded-3xl text-white p-4 flex flex-col gap-3 max-h-[calc(100vh-4rem)] overflow-y-auto"
        role="dialog"
        aria-label={title}
    >
        <header class="flex items-center gap-3">
            {#if view === "what"}
                <span
                    class="flex-none grid place-items-center w-10 h-10 rounded-xl text-white"
                    style="background: linear-gradient(135deg, #8629fc, #4156f6)"
                    aria-hidden="true"
                >
                    <IconSpeakerPhone font-size="22" />
                </span>
            {:else}
                <button type="button" class="u-close" on:click={back} aria-label={$LL.broadcast.back()}>
                    <IconChevronLeft font-size="20" class="rtl:-scale-x-100" />
                </button>
            {/if}
            <div class="flex-1 min-w-0">
                <h2 class="m-0 text-lg font-bold leading-tight truncate">{title}</h2>
                {#if view === "what"}
                    <p class="m-0 text-sm text-white/60 leading-tight">{$LL.broadcast.subtitle()}</p>
                {:else if subtitle}
                    <p class="m-0 text-sm text-white/60 leading-tight truncate">{subtitle}</p>
                {/if}
            </div>
            {#if view === "what" && canConfigure}
                <button
                    type="button"
                    class="u-close"
                    on:click={() => (view = "settings")}
                    aria-label={$LL.broadcast.settings()}
                    data-testid="broadcast-settings"
                >
                    <IconAdjustements font-size="20" />
                </button>
            {/if}
            <button
                type="button"
                class="u-close"
                on:click={close}
                aria-label={$LL.broadcast.close()}
                data-testid="broadcast-close"
            >
                <IconX font-size="20" />
            </button>
        </header>

        {#if view !== "settings"}
            <div class="u-steps" aria-hidden="true">
                <span class="u-step" data-done="true" />
                <span class="u-step" data-done={step >= 2 ? "true" : "false"} />
                <span class="u-step" data-done={step >= 3 ? "true" : "false"} />
            </div>
        {/if}

        {#if view === "what"}
            <BroadcastWhatStep
                {canMessage}
                canGoLive={liveReaches.length > 0}
                {canConfigure}
                on:choose={(event) => choose(event.detail)}
                on:settings={() => (view = "settings")}
            />
        {:else if view === "who" && kind}
            <BroadcastWhoStep reaches={reachesFor(kind)} bind:reach on:next={() => (view = "compose")} />
        {:else if view === "compose" && kind === "message" && reach}
            <BroadcastWriteStep {reach} on:sent={close} />
        {:else if view === "compose" && kind === "voice" && reach}
            <BroadcastVoiceStep {reach} on:sent={close} />
        {:else if view === "compose" && kind === "live" && reach}
            <BroadcastLiveStep {reach} on:live={close} />
        {:else if view === "settings"}
            <BroadcastSettings on:saved={() => (view = "what")} />
        {/if}
    </div>
</div>

<style lang="scss">
    /* The card's headings are plain sentence case in the body font, not the game's display font. */
    .broadcast-card :global(h2),
    .broadcast-card :global(h3) {
        font-family: inherit;
        text-transform: none;
        letter-spacing: normal;
    }
</style>
