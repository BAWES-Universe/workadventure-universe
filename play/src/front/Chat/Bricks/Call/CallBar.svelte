<script lang="ts">
    import LL from "../../../../i18n/i18n-svelte";
    import BotMoodEmoji from "../../../Components/Video/BotMoodEmoji.svelte";
    import type { BotFeeling } from "../../Bots/BotMood";
    import { clock, type CallState } from "./CallSession";
    import { IconHandStop, IconMicrophoneOn, IconPhoneOff } from "@wa-icons";

    /**
     * The call bar (game #2004, mock v10 Part 18 and Desktop 15 to 17): at the top of the Brick's chat while its chat is
     * open, and the SAME bar on screen when another chat is open or the chat is closed. One bar for one call, only for
     * the caller. The game's own mood and working signs sit beside the bot's face (BotMoodEmoji, #1667), scoped to the call.
     */
    export let state: CallState;
    export let botName: string;
    /** The bot's face, as the chat draws it. */
    export let picture: string | undefined = undefined;
    /** The mood that came with its last reply, and a number that changes with each one (BotFeeling). */
    export let feeling: BotFeeling | undefined = undefined;
    /** The time shown: now, in ms. The page keeps it moving; a test fixes it. */
    export let now: number;
    /** The chat is closed or another chat is open: the bar stays on screen, and tapping it goes back to the call's chat. */
    export let floating = false;
    export let onResume: () => void = () => undefined;
    export let onEnd: () => void = () => undefined;
    export let onMute: () => void = () => undefined;
    export let onStopSpeaking: () => void = () => undefined;
    /** Whether Stop speaking can be offered: only where the game can really stop the bot's voice. */
    export let stoppable = true;
    export let onOpen: () => void = () => undefined;

    $: hold = state.phase === "hold";
    $: speaking = state.doing === "speaking" && state.phase === "on";
    $: line =
        state.phase === "connecting"
            ? $LL.chat.brickCall.connecting()
            : hold
            ? state.hold?.kind === "person"
                ? $LL.chat.brickCall.heldPerson({ name: state.hold.name })
                : $LL.chat.brickCall.heldMeeting()
            : state.doing === "waiting"
            ? $LL.chat.brickCall.waiting()
            : state.doing === "working"
            ? state.workLine ?? $LL.chat.brickCall.working()
            : speaking
            ? $LL.chat.brickCall.speaking({ name: botName })
            : $LL.chat.brickCall.listening();
    $: title = hold ? $LL.chat.brickCall.onHold() : $LL.chat.brickCall.callWith({ name: botName });
    $: time = clock(now - state.startedAt);
    $: feelingNow = feeling
        ? { ...feeling, work: state.doing === "working" ? state.work : undefined }
        : state.doing === "working" && state.work
        ? { moodSeq: 0, work: state.work }
        : undefined;
</script>

<div class="call-wrap" class:floating data-testid="call-bar-wrap">
    <div
        class="call-bar u-surface"
        class:wait={state.doing === "waiting"}
        class:hold
        data-testid="call-bar"
        role="group"
        aria-label={title}
    >
        <button
            type="button"
            class="call-open"
            on:click={onOpen}
            aria-label={$LL.chat.brickCall.callWith({ name: botName })}
        >
            <span class="call-face">
                <span class="call-woka"
                    >{#if picture}<img src={picture} alt="" />{/if}</span
                >
                <BotMoodEmoji feeling={feelingNow} talking={speaking} />
            </span>
            <span class="call-text">
                <span class="call-title" data-testid="call-title">{title} · {time}</span>
                <span class="call-line" data-testid="call-line"><span class="call-dot" />{line}</span>
            </span>
        </button>
        {#if hold}
            <button type="button" class="u-cta h-11 rounded-full px-4 text-sm font-bold" on:click={onResume}
                >{$LL.chat.brickCall.resume()}</button
            >
        {:else}
            {#if speaking && stoppable}
                <button
                    type="button"
                    class="call-ic"
                    aria-label={$LL.chat.brickCall.stopSpeaking()}
                    on:click={onStopSpeaking}
                >
                    <IconHandStop font-size="20" />
                </button>
            {/if}
            <button type="button" class="call-ic" aria-label={$LL.chat.brickCall.microphone()} on:click={onMute}>
                <IconMicrophoneOn font-size="20" />
            </button>
        {/if}
        <button type="button" class="call-end" aria-label={$LL.chat.brickCall.end()} on:click={onEnd}>
            <IconPhoneOff font-size="20" />
        </button>
    </div>
</div>

<style>
    .call-wrap {
        width: 100%;
        padding: 0 8px;
    }
    .call-wrap.floating {
        position: fixed;
        z-index: 60;
        left: 0;
        right: 0;
        top: 12px;
        /* It sits inside the game's layer, which lets clicks through to the map: only the bar itself takes them */
        pointer-events: none;
    }
    .call-wrap.floating .call-bar {
        pointer-events: auto;
    }
    @media (min-width: 768px) {
        .call-wrap.floating {
            right: auto;
            width: 408px;
        }
    }
    .call-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 8px 8px 10px;
        border-radius: 18px;
        box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.7), inset 0 0 0 1px rgba(74, 222, 128, 0.35);
        background: rgb(27 27 41 / 0.96);
    }
    .call-bar.wait {
        box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.7), inset 0 0 0 1px rgba(167, 139, 250, 0.7);
    }
    .call-bar.hold {
        box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.7), inset 0 0 0 1px rgba(251, 191, 36, 0.5);
    }
    .call-open {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 8px;
        background: none;
        border: 0;
        padding: 0;
        text-align: start;
        color: inherit;
    }
    .call-face {
        position: relative;
        flex: none;
        display: grid;
        margin-right: 4px;
    }
    .call-face :global(.bot-mood) {
        top: -6px;
        right: -8px;
        font-size: 17px;
    }
    .call-woka {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        overflow: hidden;
        display: grid;
        place-items: center;
        background: rgba(255, 255, 255, 0.08);
    }
    .call-woka img {
        width: 40px;
        height: 40px;
        image-rendering: pixelated;
    }
    .call-text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
    }
    .call-title {
        font-size: 14px;
        font-weight: 700;
        color: #fff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .call-line {
        font-size: 12.5px;
        color: rgba(244, 242, 250, 0.72);
        display: flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .call-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #4ade80;
        flex: none;
    }
    .wait .call-dot {
        background: #a78bfa;
    }
    .hold .call-dot {
        background: #fbbf24;
    }
    .call-ic,
    .call-end {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        border: 0;
        display: grid;
        place-items: center;
        color: #fff;
        background: rgba(255, 255, 255, 0.08);
        flex: none;
    }
    .call-end {
        background: #e96d51;
    }
</style>
