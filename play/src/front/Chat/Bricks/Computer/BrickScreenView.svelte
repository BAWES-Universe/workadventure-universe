<script lang="ts">
    // The screen of a Brick's computer, shown in the game itself (not in a frame): the picture comes through the bot server, which
    // Orbit lets carry it only while the job works, and only as long as the person may see it. Watching is view only, and the bot
    // server drops everything a viewer sends besides; the keyboard and mouse are the person's only after they take over.
    // When the connection ends (the job moved on, the keyboard was handed back) it asks again with the ticket that now fits.
    import { onDestroy, onMount } from "svelte";
    import { botApiService } from "../../../external-modules/bots/services/BotApiService";
    import { loadNoVnc } from "./novnc";
    import { createScreenSession, type ScreenSession } from "./BrickScreenSession";
    import { IconLoader2 } from "@wa-icons";

    export let brickId: string;
    export let title: string;
    /** The person has taken over: the screen takes their mouse and keyboard. */
    export let inControl: boolean;
    /** There is a screen to show: the computer is working. */
    export let active: boolean;

    let target: HTMLDivElement;
    let live = false;
    let session: ScreenSession | undefined;

    // The screen is asked for again when the computer starts or stops having something to show, and when the keyboard changes hands
    $: session?.want(active ? (inControl ? "input" : "watch") : "");

    onMount(() => {
        session = createScreenSession(
            {
                ticket: (mode) => botApiService.screenTicketForBrick(brickId, mode),
                socketUrl: (ticket) => botApiService.screenSocketUrl(ticket),
                load: loadNoVnc,
            },
            target,
            (isLive) => (live = isLive)
        );
    });
    onDestroy(() => session?.destroy());
</script>

<div class="bsv" aria-label={title} data-testid="brickScreenView" data-live={live ? "yes" : "no"}>
    <div class="bsv-target" bind:this={target} />
    {#if !live}
        <div class="bsv-wait" data-testid="brickScreenConnecting"><IconLoader2 font-size="22" class="bsv-spin" /></div>
    {/if}
</div>

<style>
    .bsv {
        position: relative;
        width: 100%;
        height: 100%;
        min-height: 0;
        background: rgb(var(--u-ink));
    }
    .bsv-target {
        position: absolute;
        inset: 0;
        overflow: hidden;
    }
    .bsv-wait {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: rgb(255 255 255 / 0.6);
        pointer-events: none;
    }
    :global(.bsv-spin) {
        animation: bsv-turn 1s linear infinite;
    }
    @keyframes bsv-turn {
        to {
            transform: rotate(360deg);
        }
    }
</style>
