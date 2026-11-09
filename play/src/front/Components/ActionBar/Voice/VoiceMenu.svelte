<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import LL, { locale } from "../../../../i18n/i18n-svelte";
    import Woka from "../../Woka/Woka.svelte";
    import { requestedMicrophoneState } from "../../../Stores/MediaStore";
    import {
        resumeBotSound,
        voiceChoiceStore,
        type VoiceBotView,
        type VoiceSpaceView,
    } from "../../../Chat/Bots/VoiceBots";
    import { choiceSpeaksToBot, voiceAllowanceLine, type VoiceChoice } from "../../../Chat/Bots/VoiceMode";
    import { replyLimitTime } from "../../../Chat/Bots/BotReplyLimit";
    import {
        IconAlignLeft,
        IconCheck,
        IconKeyboard,
        IconMessage,
        IconMessageCircle2,
        IconMicrophoneOn,
    } from "@wa-icons";

    /**
     * How you talk with bots (#1666), opened from the Voice button: the bot, where it stands with you, how to get its
     * attention when others are here, and four rows. The choice is yours alone and applies to every voice bot.
     *
     * Round 8: when there is something to do about this bot right now, the top fits the moment instead: what it can
     * hear of you in a group, with Keep talking, Cancel or Stop listening (Stop listening first while it listens), and
     * Play bot audio when the browser blocked its sound (its own tap). The four rows stay the same below it.
     */
    export let bot: VoiceBotView;
    export let view: VoiceSpaceView;
    /** The browser has not let the bot's sound start: the top line asks for a tap. */
    export let soundBlocked: boolean;

    const dispatch = createEventDispatcher<{ close: { refocus: boolean; to?: Node } }>();

    const rows: { choice: VoiceChoice; icon: typeof IconMicrophoneOn }[] = [
        { choice: "talk", icon: IconMicrophoneOn },
        { choice: "speak_and_read", icon: IconAlignLeft },
        { choice: "type_and_listen", icon: IconKeyboard },
        { choice: "text_only", icon: IconMessage },
    ];
    $: names = {
        talk: { name: $LL.say.voice.talk.name(), hint: $LL.say.voice.talk.hint() },
        speak_and_read: { name: $LL.say.voice.speakAndRead.name(), hint: $LL.say.voice.speakAndRead.hint() },
        type_and_listen: { name: $LL.say.voice.typeAndListen.name(), hint: $LL.say.voice.typeAndListen.hint() },
        text_only: { name: $LL.say.voice.textOnly.name(), hint: $LL.say.voice.textOnly.hint() },
    };

    $: pictureStore = bot.picture;

    // What is left of this person's spoken replies (#1669), as the bot told it. Read when the menu opens: a count is only true until its window ends.
    const openedAt = Date.now();
    $: allowance = voiceAllowanceLine(bot, openedAt);
    /** A name kept whole inside a sentence of another direction (an English bot name in Arabic). */
    const isolate = (name: string): string => `\u2068${name}\u2069`;
    const timeOf = (at: number | undefined, language: string): string | undefined =>
        at === undefined ? undefined : replyLimitTime(new Date(at).toISOString(), language);
    $: allowanceTime = timeOf(allowance.kind === "none" ? undefined : allowance.resetsAt, $locale);
    $: allowanceText =
        allowance.kind === "left"
            ? [
                  $LL.say.voice.allowanceLeft({ count: allowance.count }),
                  allowanceTime ? $LL.say.voice.allowanceMore({ time: allowanceTime }) : "",
              ]
                  .filter(Boolean)
                  .join(" ")
            : allowance.kind === "used_up"
            ? $LL.say.voice.allowanceUsedUp()
            : "";

    // The top line: where the bot's voice stands when something needs saying, otherwise who is here.
    $: micOff = choiceSpeaksToBot($voiceChoiceStore) && !$requestedMicrophoneState;
    $: status =
        bot.state === "paused"
            ? allowance.kind === "used_up" && allowanceTime
                ? $LL.say.voice.statusPausedUntil({ time: allowanceTime })
                : $LL.say.voice.statusPaused()
            : bot.state === "connecting"
            ? $LL.say.voice.statusConnecting()
            : soundBlocked
            ? $LL.say.voice.statusTapToHear()
            : micOff
            ? $LL.say.voice.statusMicOff()
            : view.meeting
            ? $LL.say.voice.inMeeting()
            : view.othersPresent
            ? $LL.say.voice.inBubbleWith({ count: view.people })
            : $LL.say.voice.inBubble();
    $: attention =
        $LL.say.voice.attention({ bot: bot.name }) +
        (bot.followUpSeconds > 0 ? " " + $LL.say.voice.attentionFollowUp({ seconds: bot.followUpSeconds }) : "");

    // ---- the top that fits the moment (round 8) ----

    /** What the bot hears of you in the group, when its voice is on: "" alone, or in a mode without the microphone. */
    $: listening = bot.state === "on" ? bot.listening : "";
    $: limited = bot.listeningReason === "limit";
    $: listeningOn = listening === "on" && !limited;
    $: showNow = !!listening || soundBlocked;
    $: nowStatus = micOff
        ? $LL.say.voice.statusMicOff()
        : listening === "on"
        ? limited
            ? $LL.say.voice.listen.onLimit()
            : $LL.say.voice.listen.on()
        : listening === "pending"
        ? $LL.say.voice.listen.turningOn()
        : listening === "stopping"
        ? $LL.say.voice.listen.stopping()
        : listening === "checking"
        ? $LL.say.voice.listen.checking()
        : listening === "off"
        ? bot.listeningReason === "others_joined"
            ? $LL.say.voice.listen.pausedOthers()
            : bot.listeningReason === "failed"
            ? $LL.say.voice.listen.failed()
            : limited
            ? $LL.say.voice.listen.limit()
            : $LL.say.voice.listen.notListening()
        : $LL.say.voice.listen.soundBlocked();
    /** Keep talking is offered while it doesn't listen, except when it can't for now (a limit). */
    $: offerKeep = listening === "off" && !limited;
    /** Stop listening, first, whenever it listens or may still: also to take back an ask that is paused by a limit. */
    $: offerStop = listening === "on" || listening === "stopping" || listening === "checking";
    $: hasAction = offerKeep || offerStop || listening === "pending" || soundBlocked;

    function ask(listen: "keep" | "stop") {
        view.askToListen(bot.spaceUserId, listen);
        dispatch("close", { refocus: true });
    }

    // Called straight from the tap: the browser lets sound start only from a person's own gesture. Nothing else changes:
    // listening stays as it is, and the button goes when the sound really plays
    function playAudio() {
        resumeBotSound(bot.spaceUserId);
    }

    let rowElements: HTMLButtonElement[] = [];
    let focusedOnOpen = false;

    // Opens on the top action when there is one, so it is reached first; otherwise on the row you have, so the arrows
    // start where you are. Only once, when the menu opens
    function focusWhenOpened(node: HTMLElement, wanted: boolean) {
        if (wanted && !focusedOnOpen) {
            focusedOnOpen = true;
            node.focus();
        }
    }

    function move(event: KeyboardEvent, from: number) {
        const last = rows.length - 1;
        let to: number | undefined;
        if (event.key === "ArrowDown") to = from === last ? 0 : from + 1;
        else if (event.key === "ArrowUp") to = from === 0 ? last : from - 1;
        else if (event.key === "Home") to = 0;
        else if (event.key === "End") to = last;
        if (to === undefined) return;
        event.preventDefault();
        rowElements[to]?.focus();
    }

    function onKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            event.stopPropagation();
            dispatch("close", { refocus: true });
        }
    }

    // Leaving the menu with Tab closes it, like any menu
    function onFocusout(event: FocusEvent) {
        const next = event.relatedTarget;
        if (next instanceof Node && !(event.currentTarget as HTMLElement).contains(next)) {
            dispatch("close", { refocus: false, to: next });
        }
    }
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
    class="voice-menu"
    role="dialog"
    aria-label={$LL.say.voice.menuLabel({ bot: bot.name })}
    data-testid="voice-menu"
    on:keydown={onKeydown}
    on:focusout={onFocusout}
>
    {#if showNow}
        <div class="now" data-testid="voice-menu-now">
            <div class="who">
                <span class="who-woka" class:on={listeningOn} class:dim={listening === "off"} aria-hidden="true">
                    {#if $pictureStore}
                        <Woka src={$pictureStore} customWidth="30px" />
                    {/if}
                </span>
                <span class="who-text">
                    <span class="who-name" dir="auto">{bot.name}</span>
                    <span class="who-status" data-testid="voice-menu-listening"
                        ><i class="dot" class:off={!listeningOn} aria-hidden="true" /><span dir="auto">{nowStatus}</span
                        ></span
                    >
                </span>
            </div>
            {#if offerStop}
                <button
                    type="button"
                    class="act"
                    data-testid="voice-stop-listening"
                    use:focusWhenOpened={true}
                    on:click={() => ask("stop")}>{$LL.say.voice.listen.stop()}</button
                >
            {/if}
            {#if listening === "pending"}
                <button
                    type="button"
                    class="act"
                    data-testid="voice-cancel-listening"
                    use:focusWhenOpened={true}
                    on:click={() => ask("stop")}>{$LL.say.voice.listen.cancel()}</button
                >
            {/if}
            {#if soundBlocked}
                {#if listening}
                    <p class="note" dir="auto">{$LL.say.voice.listen.soundBlocked()}</p>
                {/if}
                <button
                    type="button"
                    class="act"
                    class:cta={!offerKeep}
                    data-testid="voice-play-audio"
                    use:focusWhenOpened={true}
                    on:click={playAudio}>{$LL.say.voice.listen.playAudio()}</button
                >
            {/if}
            {#if offerKeep}
                <p class="note" dir="auto">{$LL.say.voice.listen.warning({ bot: isolate(bot.name) })}</p>
                <button
                    type="button"
                    class="act cta"
                    data-testid="voice-keep-talking"
                    use:focusWhenOpened={true}
                    on:click={() => ask("keep")}>{$LL.say.voice.listen.keep({ bot: isolate(bot.name) })}</button
                >
            {/if}
            {#if listeningOn}
                <p class="note" dir="auto">{$LL.say.voice.listen.onNote()}</p>
            {/if}
        </div>
    {:else}
        <div class="head">
            <span class="head-woka" class:dim={bot.state === "paused"} aria-hidden="true">
                {#if $pictureStore}
                    <Woka src={$pictureStore} customWidth="32px" />
                {/if}
            </span>
            <div class="head-text">
                <span class="head-name" dir="auto">{bot.name}</span>
                <span class="head-status" data-testid="voice-menu-status"
                    ><span class="dot" aria-hidden="true" />{status}</span
                >
            </div>
        </div>

        {#if view.othersPresent}
            <!-- With others here a bot answers the one who uses its name; it says so only then. -->
            <p class="attention" data-testid="voice-menu-attention">
                <span class="attention-icon" aria-hidden="true"><IconMessageCircle2 /></span>
                <span>{attention}</span>
            </p>
        {/if}
    {/if}

    <p class="eyebrow" id="voice-menu-eyebrow">{$LL.say.voice.howYouTalk()}</p>
    <div class="rows" role="menu" aria-labelledby="voice-menu-eyebrow">
        {#each rows as row, index (row.choice)}
            {@const picked = $voiceChoiceStore === row.choice}
            <button
                type="button"
                class="row"
                class:picked
                role="menuitemradio"
                aria-checked={picked}
                tabindex={picked ? 0 : -1}
                data-testid={`voice-choice-${row.choice}`}
                bind:this={rowElements[index]}
                use:focusWhenOpened={picked && !hasAction}
                on:click={() => voiceChoiceStore.choose(row.choice)}
                on:keydown={(event) => move(event, index)}
            >
                <span class="row-icon" aria-hidden="true"><svelte:component this={row.icon} /></span>
                <span class="row-text">
                    <span class="row-name">{names[row.choice].name}</span>
                    <span class="row-hint">{names[row.choice].hint}</span>
                </span>
                {#if picked}
                    <span class="row-check" aria-hidden="true"><IconCheck /></span>
                {/if}
            </button>
        {/each}
    </div>

    <!-- What is left of the person's spoken replies (#1669) when the bot told it, then what is always true -->
    <div class="foot" data-testid="voice-menu-foot">
        <p>{allowanceText ? allowanceText + " " : ""}{$LL.say.voice.micUnchanged()}</p>
    </div>
</div>

<style>
    .voice-menu {
        width: 300px;
        max-width: calc(100vw - 96px);
        max-height: calc(100dvh - 160px);
        overflow-y: auto;
        padding: 12px 8px 8px;
        border-radius: 16px;
        background: var(--u-surface-bg);
        box-shadow: var(--u-surface-shadow);
        backdrop-filter: blur(18px) saturate(140%);
        -webkit-backdrop-filter: blur(18px) saturate(140%);
        color: #fff;
        animation: menu-in 200ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
    }
    /* The top that fits the moment (round 8): the bot and what it hears of you, then the one thing to do. */
    .now {
        display: grid;
        gap: 10px;
        padding: 0 8px 10px;
    }
    .who {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 44px;
    }
    .who-woka {
        display: grid;
        place-items: center;
        flex: none;
        width: 40px;
        height: 40px;
        border-radius: 9999px;
        background: #1f1c2f;
        box-shadow: 0 0 0 1px rgba(167, 139, 250, 0.3);
    }
    .who-woka.on {
        box-shadow: 0 0 0 2.5px #8629fc, 0 0 12px -2px rgba(134, 41, 252, 0.8);
    }
    .who-woka.dim {
        opacity: 0.6;
    }
    .who-text {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        gap: 2px;
    }
    .who-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 0.9375rem;
        font-weight: 700;
        line-height: 1.2;
    }
    .who-status {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.8125rem;
        line-height: 1.3;
        color: rgba(255, 255, 255, 0.72);
    }
    .dot.off {
        background: #8b88a0;
    }
    .note {
        margin: 0;
        font-size: 0.8125rem;
        line-height: 1.4;
        color: rgba(255, 255, 255, 0.72);
    }
    /* UI standard secondary button: glass, thin edge, fully round, 44px. The one main action uses the gradient. */
    .act {
        width: 100%;
        min-height: 44px;
        padding: 0 18px;
        border-radius: 9999px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
        font-weight: 700;
        font-size: 0.875rem;
        line-height: 1.2;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }
    .act.cta {
        border: 0;
        background: linear-gradient(90deg, #8629fc, #4156f6);
        box-shadow: 0 8px 24px -10px rgba(134, 41, 252, 0.7);
    }
    @media (hover: hover) {
        .act:not(.cta):hover {
            background: rgba(255, 255, 255, 0.1);
        }
    }
    .act:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .head {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 8px 10px;
    }
    .head-woka {
        display: grid;
        place-items: center;
        flex: none;
        width: 36px;
        height: 36px;
    }
    .head-woka.dim {
        opacity: 0.5;
    }
    .head-text {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }
    .head-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 0.9375rem;
        font-weight: 700;
        line-height: 1.2;
    }
    .head-status {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.8125rem;
        line-height: 1.3;
        color: rgba(255, 255, 255, 0.72);
    }
    .dot {
        flex: none;
        width: 8px;
        height: 8px;
        border-radius: 9999px;
        background: #3ddc84;
    }
    /* The attention line, in a soft panel with a chat icon. */
    .attention {
        display: flex;
        gap: 8px;
        margin: 0 4px 6px;
        padding: 10px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.06);
        font-size: 0.8125rem;
        line-height: 1.4;
        color: rgba(255, 255, 255, 0.86);
    }
    .attention-icon {
        flex: none;
        display: grid;
        place-items: start center;
        padding-top: 1px;
        font-size: 1rem;
        color: rgba(167, 139, 250, 0.95);
    }
    .eyebrow {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 10px 8px 4px;
        font-size: 0.6875rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.55);
    }
    .eyebrow::before {
        content: "";
        width: 14px;
        height: 1px;
        background: rgba(255, 255, 255, 0.3);
    }
    .rows {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .row {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 44px;
        padding: 8px 10px;
        border: 0;
        border-radius: 12px;
        background: transparent;
        color: #fff;
        text-align: start;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }
    .row.picked {
        background: rgba(134, 41, 252, 0.24);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.55);
    }
    @media (hover: hover) {
        .row:hover:not(.picked) {
            background: rgba(255, 255, 255, 0.07);
        }
    }
    .row:focus-visible {
        outline: 2px solid #8629fc;
        outline-offset: -2px;
    }
    .row-icon {
        flex: none;
        display: grid;
        place-items: center;
        width: 24px;
        font-size: 1.25rem;
        color: rgba(255, 255, 255, 0.9);
    }
    .row-text {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
    }
    .row-name {
        font-size: 0.9375rem;
        font-weight: 600;
        line-height: 1.25;
    }
    .row-hint {
        font-size: 0.75rem;
        line-height: 1.3;
        color: rgba(255, 255, 255, 0.62);
    }
    .row-check {
        flex: none;
        display: grid;
        place-items: center;
        font-size: 1.125rem;
        color: #fff;
    }
    .foot {
        margin: 8px 0 0;
        padding: 10px 10px 4px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        font-size: 0.75rem;
        line-height: 1.4;
        color: rgba(255, 255, 255, 0.62);
    }
    .foot p {
        margin: 0;
    }
    @keyframes menu-in {
        from {
            opacity: 0;
            transform: translateY(6px) scale(0.98);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .voice-menu {
            animation: none;
        }
    }
</style>
