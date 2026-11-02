<script lang="ts">
    import { onDestroy } from "svelte";
    import { backOut } from "svelte/easing";
    import { LL } from "../../../i18n/i18n-svelte";
    import { WORK_EMOJI, type BotFeeling } from "../../Chat/Bots/BotMood";

    /**
     * The emoji beside a bot's Woka (#1667). The mood pops in when the bot starts talking, bobs while it talks and
     * floats away when it stops; a reply nobody hears shows it once for a moment. While the bot works and isn't
     * talking, the work emoji takes the spot. Put it in the Woka's box; it is placed at the Woka's top right.
     */
    export let feeling: BotFeeling | undefined = undefined;
    /** The bot's voice is playing (the same signal the box's level meter and highlight use). */
    export let talking = false;

    /** How long a mood shows for a reply that is only read. */
    const TEXT_REPLY_MS = 2500;

    let recent = false;
    let seenMood = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function noticeMood(current: BotFeeling | undefined) {
        if (!current || current.moodSeq === seenMood) return;
        seenMood = current.moodSeq;
        if (!current.mood) return;
        recent = true;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => (recent = false), TEXT_REPLY_MS);
    }

    $: noticeMood(feeling);

    $: mood = feeling?.mood && (talking || recent) ? feeling.mood : undefined;
    $: work = !mood && feeling?.work ? feeling.work : undefined;
    $: shown = mood ?? (work ? WORK_EMOJI[work] : undefined);
    $: label = work ? $LL.video.botWorking({ work: $LL.video.botWork[work]() }) : mood ? $LL.video.botMood() : "";

    function reduced(): boolean {
        return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    }

    function pop(_node: Element) {
        return {
            duration: reduced() ? 0 : 550,
            easing: backOut,
            css: (t: number) => `transform: scale(${t}); opacity: ${Math.min(1, t * 2)}`,
        };
    }

    function floatAway(_node: Element) {
        return {
            duration: reduced() ? 0 : 700,
            css: (t: number, u: number) => `transform: translateY(${-14 * u}px); opacity: ${t}`,
        };
    }

    onDestroy(() => {
        if (timer) clearTimeout(timer);
    });
</script>

{#key shown}
    {#if shown}
        <span
            class="bot-mood"
            role="img"
            aria-label={label}
            data-testid="botMoodEmoji"
            in:pop|global
            out:floatAway|global
        >
            <span class="face" class:bob={!!mood} class:wiggle={!!work} aria-hidden="true">{shown}</span>
        </span>
    {/if}
{/key}

<style>
    .bot-mood {
        position: absolute;
        top: -0.35em;
        right: -0.6em;
        z-index: 40;
        font-size: 1rem;
        line-height: 1;
        pointer-events: none;
        filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
    }

    @container videomediabox (min-width: 15rem) {
        .bot-mood {
            font-size: 1.5rem;
        }
    }

    @container videomediabox (min-width: 25rem) {
        .bot-mood {
            font-size: 2.25rem;
        }
    }

    .face {
        display: block;
    }

    .bob {
        animation: bot-mood-bob 2.4s ease-in-out infinite;
    }

    .wiggle {
        animation: bot-mood-wiggle 0.9s ease-in-out infinite;
    }

    @keyframes bot-mood-bob {
        0%,
        100% {
            transform: translateY(0);
        }
        50% {
            transform: translateY(-3px);
        }
    }

    @keyframes bot-mood-wiggle {
        0%,
        100% {
            transform: rotate(-8deg);
        }
        50% {
            transform: rotate(8deg);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .bob,
        .wiggle {
            animation: none;
        }
    }
</style>
