<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import { requestedMicrophoneState } from "../../../Stores/MediaStore";
    import { openBrickChat } from "../BrickChat";
    import CallBar from "./CallBar.svelte";
    import { botCallStore } from "./CallStore";
    import { callConnection } from "./CallHost";

    /**
     * The call bar, wired to the one call this person has (game #2004). In the Brick's chat it sits at the top of the chat;
     * with another chat open, or the chat closed, the same bar floats on screen (`floating`) and tapping it goes back to
     * the call's chat. It is drawn only for the person who made the call.
     */
    export let floating = false;
    export let picture: string | undefined = undefined;

    let now = Date.now();
    let timer: ReturnType<typeof setInterval> | undefined;
    onMount(() => {
        timer = setInterval(() => (now = Date.now()), 1000);
    });
    onDestroy(() => {
        if (timer) clearInterval(timer);
    });

    $: call = $botCallStore;
    $: endedLine =
        call?.state.phase === "ended"
            ? call.state.endedBy === "quiet"
                ? $LL.chat.brickCall.endedQuiet()
                : call.state.endedBy === "unavailable" || call.state.endedBy === "bot"
                ? $LL.chat.brickCall.endedUnavailable()
                : undefined
            : undefined;
</script>

{#if call && call.state.phase !== "ended"}
    <CallBar
        state={call.state}
        botName={call.botName}
        {picture}
        {now}
        {floating}
        stoppable={false}
        onResume={() => botCallStore.send({ type: "resume", now: Date.now() })}
        onEnd={() => callConnection.end()}
        onMute={() => {
            if ($requestedMicrophoneState) requestedMicrophoneState.disableMicrophone();
            else requestedMicrophoneState.enableMicrophone();
        }}
        onOpen={() => {
            if (floating && call) void openBrickChat(call.botId);
        }}
    />
{:else if endedLine}
    <div class="call-ended" class:floating role="status" data-testid="call-ended">{endedLine}</div>
{/if}

<style>
    .call-ended {
        margin: 0 8px;
        padding: 10px 14px;
        border-radius: 14px;
        font-size: 13px;
        color: rgb(255 255 255 / 0.8);
        background: rgb(27 27 41 / 0.96);
    }
    .call-ended.floating {
        position: fixed;
        z-index: 60;
        left: 8px;
        right: 8px;
        top: 12px;
    }
    @media (min-width: 768px) {
        .call-ended.floating {
            right: auto;
            width: 392px;
        }
    }
</style>
