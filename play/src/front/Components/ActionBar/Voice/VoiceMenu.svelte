<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import Woka from "../../Woka/Woka.svelte";
    import { requestedMicrophoneState } from "../../../Stores/MediaStore";
    import { voiceChoiceStore, type VoiceBotView, type VoiceSpaceView } from "../../../Chat/Bots/VoiceBots";
    import { choiceSpeaksToBot, type VoiceChoice } from "../../../Chat/Bots/VoiceMode";
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

    // The top line: where the bot's voice stands when something needs saying, otherwise who is here.
    $: micOff = choiceSpeaksToBot($voiceChoiceStore) && !$requestedMicrophoneState;
    $: status =
        bot.state === "paused"
            ? $LL.say.voice.statusPaused()
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

    let rowElements: HTMLButtonElement[] = [];

    // Opens on the row you have, so the arrows start where you are
    function focusWhenOpened(node: HTMLElement, picked: boolean) {
        if (picked) node.focus();
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
                use:focusWhenOpened={picked}
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

    <!-- What is always true, one line. The allowance (#1669) adds its own line above this one. -->
    <div class="foot" data-testid="voice-menu-foot">
        <p>{$LL.say.voice.micUnchanged()}</p>
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
