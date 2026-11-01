<script lang="ts">
    import { tick } from "svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import Woka from "../../Woka/Woka.svelte";
    import {
        currentVoiceSpaceStore,
        resumeBotSound,
        soundBlockedStore,
        voiceChoiceStore,
        type VoiceBotView,
    } from "../../../Chat/Bots/VoiceBots";
    import { voiceButtonState } from "../../../Chat/Bots/VoiceMode";
    import VoiceMenu from "./VoiceMenu.svelte";
    import {
        IconAlignLeft,
        IconKeyboard,
        IconMessage,
        IconMicrophoneOn,
        IconPauseFilled,
        IconVolumeOff,
    } from "@wa-icons";

    /**
     * The Voice button (#1666), directly above Raise hand: the bot's own woka with one small mark for how you talk
     * with it. It is there only while a bot with voice on is in your bubble or meeting (the first one, if there are
     * two: more than one voice bot answering is a later issue, #1670). Tapping it opens the menu, except when the
     * browser blocked the sound: then the tap is the gesture that lets the sound start.
     */

    $: view = $currentVoiceSpaceStore;
    $: current = view?.bot;
    // The last bot stays while the slot closes, so what fades out is not blank
    let shownBot: VoiceBotView | undefined;
    $: if (current) shownBot = current;
    $: shown = current !== undefined;
    $: bot = shownBot;

    $: blocked = bot ? $soundBlockedStore.has(bot.spaceUserId) : false;
    $: state = bot ? voiceButtonState($voiceChoiceStore, bot.state, blocked) : "talk";
    $: botName = bot?.name ?? "";
    $: label =
        state === "talk"
            ? $LL.say.voice.label.talk({ bot: botName })
            : state === "speak_and_read"
            ? $LL.say.voice.label.speakAndRead({ bot: botName })
            : state === "type_and_listen"
            ? $LL.say.voice.label.typeAndListen({ bot: botName })
            : state === "text_only"
            ? $LL.say.voice.label.textOnly({ bot: botName })
            : state === "paused"
            ? $LL.say.voice.label.paused({ bot: botName })
            : state === "connecting"
            ? $LL.say.voice.label.connecting({ bot: botName })
            : $LL.say.voice.label.tapToHear({ bot: botName });
    $: picture = bot?.picture;
    $: dim = state === "text_only" || state === "paused";

    const marks = {
        talk: IconMicrophoneOn,
        speak_and_read: IconAlignLeft,
        type_and_listen: IconKeyboard,
        text_only: IconMessage,
        paused: IconPauseFilled,
        tap_to_hear: IconVolumeOff,
    } as const;
    $: mark = state === "connecting" ? undefined : marks[state];

    let open = false;
    $: if (!shown) open = false;
    let button: HTMLButtonElement | undefined;
    let wrap: HTMLDivElement | undefined;

    // True between a pointer press on the button and its click: the press moves focus out of the menu first
    let pressing = false;

    // Called straight from the tap: the browser lets sound start only from a person's own gesture
    function onTap() {
        pressing = false;
        if (!bot) return;
        if (state === "tap_to_hear") {
            resumeBotSound(bot.spaceUserId);
            return;
        }
        open = !open;
    }

    async function closeMenu(refocus: boolean, to?: Node) {
        // A press on the button moves focus to it before its click, and the click closes the menu itself. Tabbing onto
        // the button from the menu has no click to follow, so it closes here.
        if (!refocus && to === button && pressing) return;
        open = false;
        if (refocus) {
            await tick();
            button?.focus();
        }
    }

    function onWindowPointerDown(event: PointerEvent) {
        if (open && wrap && event.target instanceof Node && !wrap.contains(event.target)) open = false;
    }
</script>

<svelte:window on:pointerdown={onWindowPointerDown} />

<!-- The Voice button, above Raise hand, with Raise hand's own size, ink, blur and edge. It is only there while a bot with
     voice on is in the bubble or meeting: its space opens (pushing the zoom pill up) and the woka pops in; leaving, it
     fades and the space closes. The state is always said in words too: the label, and a polite announcement when it
     changes (not on every render). -->
<div class="voice-slot" class:shown aria-hidden={!shown}>
    <div class="voice-wrap" class:pointer-events-auto={shown} bind:this={wrap}>
        {#if open && bot && view}
            <div class="menu-anchor">
                <VoiceMenu
                    {bot}
                    {view}
                    soundBlocked={blocked}
                    on:close={(event) => closeMenu(event.detail.refocus, event.detail.to)}
                />
            </div>
        {/if}
        <button
            type="button"
            class="voice-btn"
            class:dim
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={open}
            tabindex={shown ? 0 : -1}
            disabled={!shown}
            data-testid="voice-button"
            data-state={state}
            bind:this={button}
            on:pointerdown={() => (pressing = true)}
            on:pointercancel={() => (pressing = false)}
            on:click={onTap}
        >
            {#if $picture}
                <span class="woka" aria-hidden="true"
                    ><Woka src={$picture} customWidth="calc(var(--voice-btn) * 0.62)" /></span
                >
            {/if}
            {#if state === "connecting"}
                <span class="voice-ring" aria-hidden="true" data-testid="voice-connecting" />
            {:else if mark}
                <span class="mark" class:amber={state === "tap_to_hear"} aria-hidden="true">
                    <svelte:component this={mark} />
                </span>
            {/if}
            {#if !open}
                <span class="voice-tip" aria-hidden="true">{label}</span>
            {/if}
        </button>
        <span class="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="voice-announce"
            >{shown ? label : ""}</span
        >
    </div>
</div>

<style>
    /* Closed, the slot takes no room: the -8px cancels the column's gap, so what is above it sits where it did. */
    .voice-slot {
        display: grid;
        grid-template-rows: 0fr;
        margin-top: -8px;
        visibility: hidden;
        transition: grid-template-rows 280ms cubic-bezier(0.2, 0, 0, 1) 140ms,
            margin-top 280ms cubic-bezier(0.2, 0, 0, 1) 140ms, visibility 0s linear 420ms;
    }
    .voice-slot.shown {
        grid-template-rows: 1fr;
        margin-top: 0;
        visibility: visible;
        transition-delay: 0s;
    }
    /* Raise hand's size: 64px, 56px between 640px and 1280px wide on a computer, 64px on any touch screen. */
    .voice-wrap {
        --voice-btn: 64px;
        position: relative;
        min-height: 0;
        /* Closed, no padding either: a 0fr row can't shrink below it, which would leave 8px and move the column. */
        padding-bottom: 0;
        transition: padding-bottom 280ms cubic-bezier(0.2, 0, 0, 1) 140ms;
    }
    /* Shown, held 8px off Raise hand beyond the column's gap, as Raise hand is held off Express. */
    .shown .voice-wrap {
        padding-bottom: 8px;
        transition-delay: 0s;
    }
    @media (min-width: 640px) and (max-width: 1279.98px) {
        .voice-wrap {
            --voice-btn: 56px;
        }
    }
    @media (pointer: coarse) {
        .voice-wrap {
            --voice-btn: 64px;
        }
    }
    .voice-btn {
        position: relative;
        display: grid;
        place-items: center;
        width: var(--voice-btn);
        height: var(--voice-btn);
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
    .shown .voice-btn {
        opacity: 1;
        transform: scale(1);
        transition-delay: 160ms;
    }
    .shown .voice-btn:active {
        transform: scale(0.9);
        transition-delay: 0s;
    }
    @media (hover: hover) {
        .voice-btn:hover {
            background: linear-gradient(rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.06)), var(--u-surface-bg);
            box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08) inset, 0 0 0 1px rgba(167, 139, 250, 0.3);
        }
    }
    .voice-btn:focus-visible {
        outline: 2px solid #8629fc;
        outline-offset: 2px;
    }
    .woka {
        display: grid;
        place-items: center;
    }
    /* Text only and a paused voice: the woka is quiet. */
    .dim .woka {
        opacity: 0.45;
    }
    /* The one small mark, bottom right: the same icon as the mode's row in the menu. No ring, no bars, no text. */
    .mark {
        position: absolute;
        right: 4px;
        bottom: 4px;
        display: grid;
        place-items: center;
        width: calc(var(--voice-btn) * 0.3);
        height: calc(var(--voice-btn) * 0.3);
        border-radius: 9999px;
        background: #0a0814;
        box-shadow: 0 0 0 1px rgba(167, 139, 250, 0.28);
        font-size: calc(var(--voice-btn) * 0.22);
        color: #fff;
    }
    .mark.amber {
        color: #f5c451;
        box-shadow: 0 0 0 1px rgba(245, 196, 81, 0.5);
    }
    /* Connecting: a ring that spins around the woka. */
    .voice-ring {
        position: absolute;
        inset: 6px;
        border-radius: 9999px;
        border: 3px solid rgba(167, 139, 250, 0.22);
        border-top-color: #a78bfa;
        animation: voice-spin 1s linear infinite;
    }
    @keyframes voice-spin {
        to {
            transform: rotate(360deg);
        }
    }
    /* The ink tooltip, to the left of the button, like Raise hand's. */
    .voice-tip {
        position: absolute;
        top: 50%;
        right: calc(var(--voice-btn) + 12px);
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
        .voice-btn:hover .voice-tip {
            opacity: 1;
        }
    }
    .voice-btn:focus-visible .voice-tip {
        opacity: 1;
    }
    /* The menu opens beside the column on computers and tablets, level with the button... */
    .menu-anchor {
        position: absolute;
        right: calc(100% + 10px);
        bottom: 8px;
    }
    /* ...and above it on phones. */
    @media (max-width: 639.98px) {
        .menu-anchor {
            right: 0;
            bottom: calc(100% + 4px);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .voice-slot,
        .voice-btn,
        .shown .voice-btn {
            transition: none;
        }
        /* A still ring says the same thing: it is on its way. */
        .voice-ring {
            animation: none;
        }
    }
</style>
