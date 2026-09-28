<script lang="ts">
    import { createEventDispatcher, onDestroy } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import type { Point } from "../QuestGeometry";
    import type { QuestPath } from "../QuestModel";
    import { prefersReducedMotion } from "../QuestMotion";
    import QuestStamp from "./QuestStamp.svelte";
    import { escapeKey, questControls } from "./questActions";

    export let path: QuestPath;
    /** The objective, shown on the pill while its glyph pops. */
    export let objective: string;
    export let eyebrow: string;
    /** The one line, e.g. "You found the Courtyard." */
    export let line: string;
    /** The stamp's name, for its label ("First Hello badge"). */
    export let stampLabel: string;
    /** Where the player's Woka is on screen, relative to `layer`. Without it the stamp just appears. */
    export let flyFrom: Point | undefined = undefined;
    /** The layer the stamp flies in (the dock's, over the map). */
    export let layer: HTMLElement | undefined = undefined;

    /** The glyph pops on the pill first (350 ms), then the line takes its place. */
    const TICK_MS = 700;

    const dispatch = createEventDispatcher<{ ticked: void; dismiss: void }>();

    let phase: "tick" | "line" = "tick";
    let slot: HTMLElement | undefined;
    let stampHidden = false;
    let tickTimer: ReturnType<typeof setTimeout> | undefined;
    let flight: Animation | undefined;
    let flying: HTMLElement | undefined;

    tickTimer = setTimeout(
        () => {
            tickTimer = undefined;
            phase = "line";
            dispatch("ticked");
            requestAnimationFrame(() => fly());
        },
        prefersReducedMotion() ? 0 : TICK_MS
    );

    onDestroy(() => {
        if (tickTimer) clearTimeout(tickTimer);
        flight?.cancel();
        flying?.remove();
    });

    /**
     * The stamp rises from the Woka and settles at the start of the line. DOM only: Phaser's own DOM layer is drawn
     * under the interface. Skipped under reduced motion or when there is no starting point.
     */
    function fly() {
        const stamp = slot?.querySelector("svg");
        if (!stamp || !layer || !flyFrom || prefersReducedMotion() || typeof stamp.animate !== "function") return;
        const layerRect = layer.getBoundingClientRect();
        const slotRect = stamp.getBoundingClientRect();
        const size = slotRect.width || 56;
        const to = { x: slotRect.left - layerRect.left, y: slotRect.top - layerRect.top };
        const from = { x: flyFrom.x - size / 2, y: flyFrom.y - size / 2 };
        const clone = stamp.cloneNode(true) as SVGElement;
        const element = document.createElement("div");
        element.className = "quest-stamp-flight";
        element.setAttribute("aria-hidden", "true");
        element.style.width = `${size}px`;
        element.style.height = `${size}px`;
        element.appendChild(clone);
        layer.appendChild(element);
        flying = element;
        stampHidden = true;
        flight = element.animate(
            [
                { transform: `translate(${from.x}px, ${from.y}px) scale(0.6)`, opacity: 0 },
                { transform: `translate(${from.x}px, ${from.y - 40}px) scale(1)`, opacity: 1, offset: 0.45 },
                { transform: `translate(${to.x}px, ${to.y}px) scale(1)`, opacity: 1 },
            ],
            { duration: 1_100, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" }
        );
        const land = () => {
            element.remove();
            flying = undefined;
            stampHidden = false;
        };
        flight.onfinish = land;
        flight.oncancel = land;
    }
</script>

{#if phase === "tick"}
    <!-- The followed pill, a moment longer: its glyph pops for the completion. -->
    <div class="quest-pill" data-testid="quest-payoff-tick">
        <span class="quest-pill-glyph quest-pill-pop" data-testid="quest-payoff-glyph">
            <QuestStamp {path} size={22} glyphOnly tilted={false} />
        </span>
        <span class="quest-pill-label">{objective}</span>
        <span class="sr-only">{$LL.quest.pill.done()}</span>
    </div>
{:else}
    <!-- Tapping the line (or Escape on it) ends it early. -->
    <button
        type="button"
        class="quest-surface quest-payoff pointer-events-auto"
        data-testid="quest-payoff"
        use:escapeKey={() => dispatch("dismiss")}
        use:questControls
        on:click={() => dispatch("dismiss")}
    >
        <span class="shrink-0" class:invisible={stampHidden} bind:this={slot} role="img" aria-label={stampLabel}>
            <QuestStamp {path} size={56} />
        </span>
        <span class="min-w-0 flex-1 text-start">
            <span class="quest-eyebrow block truncate" title={eyebrow}>{eyebrow}</span>
            <span class="block text-base font-bold leading-snug">{line}</span>
        </span>
    </button>
{/if}
