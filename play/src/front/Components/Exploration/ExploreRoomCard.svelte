<script context="module" lang="ts">
    // Each card's SVG gradient needs its own id: ids are page-wide.
    let nextCardId = 0;
</script>

<script lang="ts">
    import type { UniverseRoomDescription } from "@workadventure/messages";
    import { createEventDispatcher } from "svelte";
    import LL from "../../../i18n/i18n-svelte";
    import { displayName, formatPeakHour } from "./exploreText";

    // A room at a glance, the same as Orbit's room cards (admin: app/admin/components/room-card.tsx and its CSS, in
    // Orbit's dark theme): what it is, how popular it is and when it is busiest. Your current room gets
    // Orbit's "You are here" and its orbit.

    export let room: UniverseRoomDescription;

    const dispatch = createEventDispatcher<{ select: UniverseRoomDescription }>();

    const moonId = `explore-moon-${nextCardId++}`;

    $: peak = room.peakHourUtc === undefined ? undefined : formatPeakHour(room.peakHourUtc);
</script>

<button
    type="button"
    class="explore-card shrink-0 snap-start w-64 sm:w-72 text-start {room.isCurrent ? 'current' : ''}"
    aria-current={room.isCurrent ? "location" : undefined}
    data-testid="explore-room-card"
    on:click={() => dispatch("select", room)}
>
    {#if room.isCurrent}
        <svg class="orbit" viewBox="0 0 280 200" fill="none" aria-hidden="true" focusable="false">
            <defs>
                <radialGradient id={moonId} cx="0.27" cy="0.22" r="0.8">
                    <stop offset="0" stop-color="currentColor" stop-opacity="0.95" />
                    <stop offset="0.3" stop-color="currentColor" stop-opacity="0.55" />
                    <stop offset="0.7" stop-color="currentColor" stop-opacity="0.12" />
                    <stop offset="1" stop-color="currentColor" stop-opacity="0.02" />
                </radialGradient>
            </defs>
            <circle cx="147" cy="93" r="65" stroke="currentColor" stroke-opacity="0.16" stroke-width="0.7" />
            <circle cx="147" cy="93" r="45" fill="url(#{moonId})" stroke="currentColor" stroke-opacity="0.35" />
            <path
                d="M116 60c30-12 58 15 59 45M108 80c26-9 43 7 44 33M131 53c9 18 13 44 4 73"
                stroke="currentColor"
                stroke-opacity="0.2"
                stroke-width="0.6"
            />
            <ellipse
                cx="147"
                cy="93"
                rx="114"
                ry="36"
                transform="rotate(-26 147 93)"
                stroke="currentColor"
                stroke-opacity="0.5"
                stroke-width="0.8"
            />
            <ellipse
                cx="147"
                cy="93"
                rx="133"
                ry="51"
                transform="rotate(-26 147 93)"
                stroke="currentColor"
                stroke-opacity="0.13"
                stroke-width="0.6"
            />
            <circle cx="50" cy="126" r="4" fill="#e9c74c" />
            <circle cx="235" cy="49" r="2" fill="currentColor" fill-opacity="0.5" />
            <path d="M45 55h8m-4-4v8M226 144h6m-3-3v6" stroke="currentColor" stroke-opacity="0.45" stroke-width="0.8" />
        </svg>
    {/if}

    <span class="card-top">
        {#if room.isCurrent}
            <span class="eyebrow"><i class="presence" />{$LL.actionbar.explore.youAreHere()}</span>
        {/if}
        <span class="stars" aria-label={$LL.actionbar.explore.stars({ count: room.stars })}>
            <!-- Lucide "star", as on Orbit's cards -->
            <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
            >
                <path
                    d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"
                />
            </svg>
            {room.stars.toLocaleString()}
        </span>
    </span>

    <span class="place">
        <span class="name-row">
            <!-- Orbit's room kind: Lucide "door-open" on the room gradient -->
            <span class="kind" aria-hidden="true">
                <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <path d="M11 20H2" />
                    <path
                        d="M11 4.562v16.157a1 1 0 0 0 1.242.97L19 20V5.562a2 2 0 0 0-1.515-1.94l-4-1A2 2 0 0 0 11 4.561z"
                    />
                    <path d="M11 4H8a2 2 0 0 0-2 2v14" />
                    <path d="M14 12h.01" />
                    <path d="M22 20h-3" />
                </svg>
            </span>
            <span class="room-name">{displayName(room.name)}</span>
        </span>
        {#if room.description}
            <span class="description">{room.description}</span>
        {/if}
    </span>

    <span class="activity">
        <span class="metric">
            <span class="metric-label">{$LL.actionbar.explore.visits()}</span>
            <span class="metric-value">{room.visits.toLocaleString()}</span>
        </span>
        <span class="metric">
            <span class="metric-label">{$LL.actionbar.explore.peak()}</span>
            <span class="metric-value">{peak ?? $LL.actionbar.explore.never()}</span>
        </span>
    </span>
</button>

<style>
    /* Orbit's dark theme (admin app/globals.css .dark) and room card (room-card.module.css). */
    .explore-card {
        --card: hsl(216 41% 18%);
        --line: hsl(216 28% 26%);
        --muted: hsl(216 20% 72%);
        --accent: #fbbf24;
        position: relative;
        isolation: isolate;
        display: flex;
        flex-direction: column;
        min-height: 11rem;
        overflow: hidden;
        margin: 0;
        padding: 15px 17px 12px;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: var(--card);
        color: #fff;
        font: inherit;
        text-transform: none;
        cursor: pointer;
        transition: border-color 160ms;
    }
    /* Orbit's room wash, shown on hover */
    .explore-card::before {
        content: "";
        position: absolute;
        inset: 0;
        z-index: -1;
        border-radius: inherit;
        opacity: 0;
        transition: opacity 200ms;
        pointer-events: none;
        background: linear-gradient(135deg, rgb(245 158 11 / 0.14), transparent 55%, rgb(236 72 153 / 0.18));
    }
    .explore-card:hover,
    .explore-card:focus-visible {
        border-color: color-mix(in srgb, var(--accent) 44%, transparent);
    }
    .explore-card:hover::before,
    .explore-card:focus-visible::before {
        opacity: 1;
    }
    .explore-card:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }
    .current {
        cursor: default;
        background: linear-gradient(118deg, var(--card) 20%, rgb(245 158 11 / 0.07)), var(--card);
    }
    .current::after {
        content: "";
        pointer-events: none;
        position: absolute;
        z-index: -1;
        width: 68%;
        height: 160px;
        right: 0;
        top: 0;
        background-image: radial-gradient(var(--accent) 0.65px, transparent 0.8px);
        background-size: 26px 26px;
        opacity: 0.18;
        mask-image: linear-gradient(100deg, transparent, #000);
    }
    .orbit {
        position: absolute;
        z-index: -1;
        width: 200px;
        height: 143px;
        top: 7px;
        right: -44px;
        pointer-events: none;
        color: var(--accent);
        opacity: 0.65;
    }
    .card-top {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 16px;
    }
    .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        color: var(--accent);
        font-size: 10px;
        font-weight: 650;
        letter-spacing: 0.13em;
        text-transform: uppercase;
    }
    .presence {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #22c55e;
        box-shadow: 0 0 0 4px rgb(34 197 94 / 0.18);
    }
    .stars {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        margin-left: auto;
        color: var(--accent);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
    }
    .place {
        display: block;
        min-width: 0;
        padding: 12px 0 13px;
    }
    .name-row {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
    }
    .kind {
        display: inline-grid;
        place-items: center;
        flex: none;
        width: 2.25rem;
        height: 2.25rem;
        border-radius: 0.75rem;
        color: #fff;
        background-image: linear-gradient(135deg, #f59e0b, #ec4899);
    }
    .room-name {
        min-width: 0;
        overflow: hidden;
        font-size: 19px;
        font-weight: 700;
        letter-spacing: -0.02em;
        line-height: 1.15;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .description {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        overflow: hidden;
        margin-top: 6px;
        color: var(--muted);
        font-size: 11px;
        line-height: 1.6;
        overflow-wrap: anywhere;
    }
    .activity {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 10px;
        margin-top: auto;
        padding-top: 10px;
        border-top: 1px solid var(--line);
    }
    .metric {
        display: flex;
        flex-direction: column;
    }
    .metric-label {
        margin-bottom: 2px;
        color: var(--muted);
        font-size: 11px;
    }
    .metric-value {
        font-size: 15px;
        font-weight: 600;
        letter-spacing: -0.02em;
        line-height: 1.2;
        font-variant-numeric: tabular-nums;
    }
    @media (prefers-reduced-motion: reduce) {
        .explore-card,
        .explore-card::before {
            transition: none;
        }
    }
</style>
