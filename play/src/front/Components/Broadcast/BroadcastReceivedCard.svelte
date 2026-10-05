<script lang="ts">
    /* eslint-disable svelte/no-at-html-tags */
    import { createEventDispatcher, onDestroy, onMount } from "svelte";
    import { fly } from "svelte/transition";
    import LL from "../../../i18n/i18n-svelte";
    import type { BroadcastCard } from "../../Stores/BroadcastStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import WaveBars from "./WaveBars.svelte";
    import { describeAudioFile, formatDuration, WAVE_BARS } from "./voiceRecorder";
    import { IconPauseFilled, IconPlayFilled, IconSpeakerPhone, IconUser } from "@wa-icons";

    export let card: BroadcastCard;

    const dispatch = createEventDispatcher<{ dismiss: void }>();

    let player: HTMLAudioElement | undefined;
    let playing = false;
    let levels: number[] = new Array<number>(WAVE_BARS).fill(0.2);
    let duration: number | undefined;
    // The uploader keeps a voice note for a minute: fetch it on arrival so Play still works later.
    let audioSrc: string | undefined;
    let objectUrl: string | undefined;

    $: reachText = card.reachLabel
        ? $LL.broadcast.reach.everyoneIn({ name: card.reachLabel })
        : $LL.broadcast.reach.everyone();

    function togglePlay() {
        if (!player) return;
        if (playing) player.pause();
        else player.play().catch((e) => console.warn("Broadcast: could not play the voice note", e));
    }

    // A voice note that arrives after Got it is dropped: its URL would never be revoked.
    let destroyed = false;

    onMount(() => {
        if (!card.audioUrl) {
            gameManager.getCurrentGameScene().playSound("audio-megaphone");
            return;
        }
        const url = card.audioUrl;
        fetch(url)
            .then(async (response) => {
                if (!response.ok) throw new Error(`${response.status} fetching the voice note`);
                const blob = await response.blob();
                if (destroyed) return;
                objectUrl = URL.createObjectURL(blob);
                audioSrc = objectUrl;
                try {
                    const described = await describeAudioFile(blob);
                    if (destroyed) return;
                    levels = described.levels;
                    duration = described.duration;
                } catch (e) {
                    console.warn("Broadcast: the voice note's shape could not be read", e);
                }
            })
            .catch((e) => {
                if (destroyed) return;
                console.warn("Broadcast: the voice note could not be fetched, streaming it instead", e);
                audioSrc = url;
            });
    });

    onDestroy(() => {
        destroyed = true;
        player?.pause();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
    });

    function autoplay(node: HTMLAudioElement) {
        // Plays as soon as the audio is there, like the old announcement did; a browser that refuses leaves Play.
        node.play().catch((e) => console.warn("Broadcast: the voice note did not autoplay", e));
    }
</script>

<div
    class="u-surface rounded-2xl text-white p-4 flex flex-col gap-3 pointer-events-auto"
    transition:fly={{ y: -12, duration: 180 }}
    role="status"
    aria-label={$LL.broadcast.received.from({ name: card.senderName })}
    data-testid="broadcast-received"
>
    <header class="flex items-center gap-3">
        <span
            class="grid place-items-center w-10 h-10 rounded-full bg-white/10 text-white/80 flex-none"
            aria-hidden="true"
        >
            <IconUser font-size="20" />
        </span>
        <div class="flex-1 min-w-0 leading-tight">
            <div class="font-bold truncate">{card.senderName}</div>
            <div class="text-xs text-white/60 truncate">{reachText} · {$LL.broadcast.received.now()}</div>
        </div>
        <span
            class="grid place-items-center w-8 h-8 rounded-full text-white flex-none"
            style="background: linear-gradient(135deg, #8629fc, #4156f6)"
            aria-hidden="true"
        >
            <IconSpeakerPhone font-size="16" />
        </span>
    </header>

    {#if card.audioUrl}
        <div class="flex items-center gap-3 rounded-2xl bg-white/5 border border-white/10 p-3">
            <button
                type="button"
                class="u-cta rounded-full grid place-items-center w-11 h-11 flex-none"
                on:click={togglePlay}
                disabled={!audioSrc}
                aria-label={playing ? $LL.broadcast.received.pause() : $LL.broadcast.received.play()}
                data-testid="broadcast-received-play"
            >
                {#if playing}
                    <IconPauseFilled font-size="18" />
                {:else}
                    <IconPlayFilled font-size="18" />
                {/if}
            </button>
            <WaveBars {levels} height={28} classList="flex-1 min-w-0 overflow-hidden" />
            {#if duration !== undefined}
                <span class="text-sm text-white/60 tabular-nums flex-none">{formatDuration(duration)}</span>
            {/if}
            {#if audioSrc}
                <audio
                    src={audioSrc}
                    bind:this={player}
                    use:autoplay
                    on:play={() => (playing = true)}
                    on:pause={() => (playing = false)}
                    on:ended={() => (playing = false)}
                />
            {/if}
        </div>
    {/if}

    {#if card.html}
        <div class="broadcast-text text-base leading-snug break-words max-h-48 overflow-y-auto">
            {@html card.html}
        </div>
    {/if}

    <div class="flex justify-end">
        <button
            type="button"
            class="u-cta-secondary rounded-full px-5 py-2 text-sm font-bold"
            on:click={() => dispatch("dismiss")}
            data-testid="broadcast-received-dismiss"
        >
            {$LL.broadcast.received.gotIt()}
        </button>
    </div>
</div>

<style lang="scss">
    .broadcast-text :global(p) {
        margin: 0 0 0.25rem;
    }
    .broadcast-text :global(a) {
        color: #c4b5fd;
        text-decoration: underline;
    }
    /* What the rich editor can write: the page's reset strips lists, headings and quotes, so they are drawn here. */
    .broadcast-text :global(ul),
    .broadcast-text :global(ol) {
        margin: 0 0 0.25rem;
        padding-inline-start: 1.5rem;
    }
    .broadcast-text :global(ul) {
        list-style: disc;
    }
    .broadcast-text :global(ol) {
        list-style: decimal;
    }
    .broadcast-text :global(h1),
    .broadcast-text :global(h2),
    .broadcast-text :global(h3),
    .broadcast-text :global(h4),
    .broadcast-text :global(h5),
    .broadcast-text :global(h6) {
        margin: 0 0 0.25rem;
        font-family: inherit;
        font-weight: 700;
        text-transform: none;
        letter-spacing: normal;
        line-height: 1.25;
    }
    .broadcast-text :global(h1) {
        font-size: 1.5rem;
    }
    .broadcast-text :global(h2) {
        font-size: 1.25rem;
    }
    .broadcast-text :global(h3) {
        font-size: 1.125rem;
    }
    .broadcast-text :global(blockquote) {
        margin: 0 0 0.25rem;
        padding-inline-start: 0.75rem;
        border-inline-start: 3px solid rgba(167, 139, 250, 0.6);
        color: rgba(255, 255, 255, 0.8);
    }
    .broadcast-text :global(pre) {
        margin: 0 0 0.25rem;
        padding: 0.5rem 0.75rem;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.06);
        white-space: pre-wrap;
    }
    .broadcast-text :global(img),
    .broadcast-text :global(iframe) {
        max-width: 100%;
    }
</style>
