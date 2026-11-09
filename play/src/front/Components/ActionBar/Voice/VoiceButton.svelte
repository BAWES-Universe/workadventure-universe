<script lang="ts">
    import { onDestroy, tick } from "svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import Woka from "../../Woka/Woka.svelte";
    import {
        currentVoiceSpaceStore,
        resumeBotSound,
        soundBlockedStore,
        voiceChoiceStore,
        type VoiceBotView,
    } from "../../../Chat/Bots/VoiceBots";
    import { voiceBarMs, voiceButtonState, type VoiceBar } from "../../../Chat/Bots/VoiceMode";
    import VoiceMenu from "./VoiceMenu.svelte";
    import {
        IconAlignLeft,
        IconKeyboard,
        IconMessage,
        IconMicrophoneOff,
        IconMicrophoneOn,
        IconPauseFilled,
        IconVolumeOff,
    } from "@wa-icons";

    /**
     * The Voice button (#1666), directly above Raise hand: the bot's own woka with one small mark for how you talk
     * with it. It is there only while a bot with voice on is in your bubble or meeting (the first one, if there are
     * two: more than one voice bot answering is a later issue, #1670).
     *
     * One tap rule (round 8): a tap on the button, or on its bar while the bar shows, opens the voice options. Nothing
     * else is a tap target, and no tap does anything hidden. In a group, a short bar grows out of the button to say
     * what just changed (listening paused, turning on, listening, checking), then folds back into the button, whose
     * ring and mic mark keep saying it. The bar and the button are one target.
     */

    /**
     * Whether the tap that opens the voice options also lets blocked bot sound start. GPT's round-8 ruling: no, opening
     * the options is quiet, and Play bot audio inside is its own tap. Kept as one switch in case that ruling changes.
     */
    const OPENING_TAP_RESUMES_SOUND = false;

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

    // ---- listening in a group (round 8) ----

    /** What the bot hears of you in the group, when there is anything to say and its voice is on: "" otherwise, as today. */
    $: listening = bot && bot.state === "on" ? bot.listening : "";
    $: listenLimited = bot?.listeningReason === "limit";
    /** The folded look: the ring while it listens, a waiting ring while a change is not confirmed, mic or mic-off on top. */
    $: ring =
        listening === "on" && !listenLimited ? "on" : listening === "pending" || listening === "stopping" ? "wait" : "";
    $: micMark =
        listening === "off" || (listening === "on" && listenLimited)
            ? "off"
            : listening === "on" || listening === "pending" || listening === "stopping" || listening === "checking"
            ? "on"
            : "";
    $: groupLabel =
        listening === "on" && !listenLimited
            ? $LL.say.voice.groupLabel.on({ bot: botName })
            : listening === "pending"
            ? $LL.say.voice.groupLabel.pending({ bot: botName })
            : listening === "stopping" || listening === "checking"
            ? $LL.say.voice.groupLabel.checking({ bot: botName })
            : listening
            ? $LL.say.voice.groupLabel.off({ bot: botName })
            : "";
    $: name = groupLabel || label;

    // The bar: shown for a change, then folded after its time (not while a finger or the focus is on it)
    let barShown: VoiceBar | undefined;
    let seenSeq = 0;
    let foldTimer: ReturnType<typeof setTimeout> | undefined;
    let held = false;
    let barHeight = 0;
    let buttonHeight = 0;
    $: syncBar(bot?.bar, bot?.barSeq ?? 0, listening);

    function syncBar(bar: VoiceBar | undefined, seq: number, now: string) {
        if (seq !== seenSeq) {
            seenSeq = seq;
            // A bar about listening is only for a bot whose voice is on
            showBar(now ? bar : undefined);
        } else if (barShown && (bar !== barShown || !now)) {
            showBar(undefined);
        }
    }

    function showBar(bar: VoiceBar | undefined) {
        clearTimeout(foldTimer);
        foldTimer = undefined;
        barShown = bar;
        if (bar) announced = barText(bar).join(". ");
        armFold();
    }

    function armFold() {
        clearTimeout(foldTimer);
        const ms = barShown ? voiceBarMs(barShown) : undefined;
        if (ms === undefined) return;
        foldTimer = setTimeout(fold, ms);
    }

    function fold() {
        // A focused or pressed bar stays put: it folds a moment after it is let go
        if (held || open) {
            foldTimer = setTimeout(fold, 1500);
            return;
        }
        barShown = undefined;
    }

    onDestroy(() => clearTimeout(foldTimer));

    function barText(bar: VoiceBar): [string, string] {
        const voice = $LL.say.voice.bar;
        switch (bar) {
            case "paused":
                return [voice.paused({ bot: botName }), voice.tapForOptions()];
            case "not_listening":
                return [voice.notListening({ bot: botName }), voice.tapForOptions()];
            case "failed":
                return [voice.failed({ bot: botName }), voice.tapForOptions()];
            case "turning_on":
                return [voice.turningOn(), voice.oneMoment()];
            case "listening":
                return [voice.listening(), voice.hearsAll()];
            case "checking":
                return [voice.checking(), voice.mayStillHear({ bot: botName })];
        }
    }
    $: barLines = barShown ? barText(barShown) : undefined;
    /** Each change is said once, politely, by screen readers; folding says nothing. */
    let announced = "";
    $: if (!listening) announced = "";
    /** A tall bar (large text, Arabic) moves the column above it up instead of covering it. */
    $: barExtra = barShown ? Math.max(0, barHeight - buttonHeight) : 0;

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
    // In a group the mark says what the bot hears of you (sound the browser blocked is said in the options)
    $: shownMark = micMark === "on" ? IconMicrophoneOn : micMark === "off" ? IconMicrophoneOff : mark;

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
        if (OPENING_TAP_RESUMES_SOUND && state === "tap_to_hear" && !open) resumeBotSound(bot.spaceUserId);
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
    <div
        class="voice-wrap"
        class:pointer-events-auto={shown}
        bind:this={wrap}
        style:padding-top={barExtra ? `${barExtra}px` : undefined}
    >
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
            class:dim={dim || micMark === "off"}
            class:barred={!!barShown}
            class:ring-on={ring === "on"}
            class:ring-wait={ring === "wait"}
            aria-label={name}
            aria-haspopup="menu"
            aria-expanded={open}
            tabindex={shown ? 0 : -1}
            disabled={!shown}
            data-testid="voice-button"
            data-state={state}
            data-listening={listening}
            bind:this={button}
            bind:clientHeight={buttonHeight}
            on:pointerdown={() => (pressing = true)}
            on:pointercancel={() => (pressing = false)}
            on:pointerenter={() => (held = true)}
            on:pointerleave={() => (held = false)}
            on:focus={() => (held = true)}
            on:blur={() => (held = false)}
            on:click={onTap}
        >
            {#if barShown && barLines}
                <span
                    class="voice-bar"
                    class:offer={barShown === "paused" || barShown === "not_listening" || barShown === "failed"}
                    class:on={barShown === "listening"}
                    aria-hidden="true"
                    data-testid="voice-bar"
                    data-bar={barShown}
                    bind:clientHeight={barHeight}
                >
                    <span class="bar-l1"
                        >{#if barShown === "listening"}<i class="bar-dot" />{/if}<span dir="auto">{barLines[0]}</span
                        ></span
                    >
                    <span class="bar-l2" dir="auto">{barLines[1]}</span>
                </span>
            {/if}
            {#if $picture}
                <span class="woka" aria-hidden="true"
                    ><Woka src={$picture} customWidth="calc(var(--voice-btn) * 0.62)" /></span
                >
            {/if}
            {#if state === "connecting"}
                <span class="voice-ring" aria-hidden="true" data-testid="voice-connecting" />
            {:else if shownMark}
                <span
                    class="mark"
                    class:amber={micMark ? listening === "checking" : state === "tap_to_hear"}
                    aria-hidden="true"
                    data-testid="voice-mark"
                    data-mark={micMark || state}
                >
                    <svelte:component this={shownMark} />
                </span>
            {/if}
            {#if !open && !barShown}
                <span class="voice-tip" aria-hidden="true">{name}</span>
            {/if}
        </button>
        <span class="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="voice-announce"
            >{shown ? (listening ? announced || name : label) : ""}</span
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
        position: relative;
        z-index: 2;
        display: grid;
        place-items: center;
    }
    /* The bar (round 8): grows out of the button to the left, as wide as its words, two lines, the button's height or
       taller for large text. Same dark glass in every state; only the edge changes: violet when it offers, green while
       it listens. The button sits on it, so the bar and the woka are one tap target. */
    .voice-bar {
        position: absolute;
        right: 0;
        bottom: 0;
        z-index: 0;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 1px;
        min-height: var(--voice-btn);
        width: max-content;
        max-width: min(320px, calc(100vw - 24px));
        padding: 8px calc(var(--voice-btn) + 10px) 8px 20px;
        border-radius: calc(var(--voice-btn) / 2);
        color: #fff;
        text-align: start;
        background: linear-gradient(180deg, rgb(31 28 47 / 0.97), rgb(20 18 30 / 0.98));
        backdrop-filter: blur(18px) saturate(140%);
        -webkit-backdrop-filter: blur(18px) saturate(140%);
        box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08) inset, 0 0 0 1px rgba(167, 139, 250, 0.25),
            0 10px 30px -12px rgba(0, 0, 0, 0.7);
        transform-origin: right center;
        animation: bar-in 220ms cubic-bezier(0.2, 0, 0, 1) both;
    }
    .voice-bar.offer {
        box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08) inset, 0 0 0 1.5px rgba(167, 139, 250, 0.85),
            0 10px 30px -12px rgba(0, 0, 0, 0.7);
    }
    .voice-bar.on {
        box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08) inset, 0 0 0 1.5px rgba(61, 220, 132, 0.8),
            0 10px 30px -12px rgba(0, 0, 0, 0.7);
    }
    .bar-l1 {
        display: flex;
        align-items: center;
        gap: 7px;
        font-weight: 800;
        font-size: 0.9375rem;
        line-height: 1.25;
        overflow-wrap: anywhere;
    }
    .bar-l2 {
        font-size: 0.75rem;
        font-weight: 600;
        line-height: 1.35;
        color: rgba(255, 255, 255, 0.7);
        overflow-wrap: anywhere;
    }
    .bar-dot {
        flex: none;
        width: 9px;
        height: 9px;
        border-radius: 9999px;
        background: #3ddc84;
    }
    @keyframes bar-in {
        from {
            opacity: 0;
            transform: scaleX(0.6);
        }
    }
    /* With the bar out, the button's own disc steps back so the bar reads as one shape with the woka on it. */
    .voice-btn.barred {
        background: transparent;
        box-shadow: none;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
    }
    .voice-btn.barred::before {
        content: "";
        position: absolute;
        inset: 5px;
        z-index: 1;
        border-radius: 9999px;
        background: rgba(12, 10, 22, 0.55);
    }
    /* Listening to you: a steady ring around the woka. Waiting for the worker to confirm: a still, partial ring. */
    .voice-btn.ring-on::after,
    .voice-btn.ring-wait::after {
        content: "";
        position: absolute;
        inset: 3px;
        z-index: 1;
        border-radius: 9999px;
        pointer-events: none;
    }
    .voice-btn.ring-on::after {
        padding: 3px;
        background: conic-gradient(from 210deg, #8629fc, #4156f6, #a78bfa, #3ddc84, #8629fc);
        -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
        -webkit-mask-composite: xor;
        mask-composite: exclude;
    }
    .voice-btn.ring-wait::after {
        border: 3px solid rgba(167, 139, 250, 0.25);
        border-top-color: #c4b5fd;
        transform: rotate(40deg);
    }
    /* Text only and a paused voice: the woka is quiet. Not listening in a group: a little quiet. */
    .dim .woka {
        opacity: 0.45;
    }
    [data-listening="off"].dim .woka {
        opacity: 0.6;
    }
    /* The one small mark, bottom right: the same icon as the mode's row in the menu. No ring, no bars, no text. */
    .mark {
        position: absolute;
        z-index: 3;
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
        /* The bar appears and goes, without growing */
        .voice-bar {
            animation: none;
        }
    }
</style>
