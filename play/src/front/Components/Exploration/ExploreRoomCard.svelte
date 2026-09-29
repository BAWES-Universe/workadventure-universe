<script lang="ts">
    import type { UniverseRoomDescription } from "@workadventure/messages";
    import { createEventDispatcher } from "svelte";
    import LL from "../../../i18n/i18n-svelte";
    import { formatPeakHour } from "./peakHour";
    import { IconDoor, IconStar } from "@wa-icons";

    // A room at a glance, after Orbit's room cards: where it is, what it is, how popular it is and when it is busiest.
    // Rooms have no pictures, so the card is words and numbers; your current room gets Orbit's orbit.

    export let room: UniverseRoomDescription;
    export let worldName: string;

    const dispatch = createEventDispatcher<{ select: UniverseRoomDescription }>();

    $: peak = room.peakHourUtc === undefined ? undefined : formatPeakHour(room.peakHourUtc);
</script>

<button
    type="button"
    class="explore-card relative isolate flex flex-col shrink-0 snap-start w-64 sm:w-72 min-h-44 overflow-hidden text-start rounded-2xl border border-solid px-4 pt-4 pb-3 transition-colors
        {room.isCurrent ? 'current cursor-default' : 'cursor-pointer'}"
    aria-current={room.isCurrent ? "location" : undefined}
    data-testid="explore-room-card"
    on:click={() => dispatch("select", room)}
>
    {#if room.isCurrent}
        <svg
            class="orbit absolute -z-10 w-48 h-36 top-1 -right-10 pointer-events-none"
            viewBox="0 0 280 200"
            fill="none"
            aria-hidden="true"
            focusable="false"
        >
            <circle cx="147" cy="93" r="65" stroke="currentColor" stroke-opacity="0.16" stroke-width="0.7" />
            <circle
                cx="147"
                cy="93"
                r="45"
                fill="currentColor"
                fill-opacity="0.12"
                stroke="currentColor"
                stroke-opacity="0.35"
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
            <circle cx="50" cy="126" r="4" fill="currentColor" />
            <circle cx="235" cy="49" r="2" fill="currentColor" fill-opacity="0.5" />
        </svg>
    {/if}

    <div class="flex items-center gap-2 min-h-4">
        {#if room.isCurrent}
            <span class="eyebrow inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.13em]">
                <i class="presence w-1.5 h-1.5 rounded-full" />
                {$LL.actionbar.explore.youAreHere()}
            </span>
        {/if}
        <span
            class="accent ms-auto inline-flex items-center gap-1 text-xs tabular-nums"
            aria-label={$LL.actionbar.explore.stars({ count: room.stars })}
        >
            <IconStar font-size="13" aria-hidden="true" />
            {room.stars.toLocaleString()}
        </span>
    </div>

    <div class="pt-2 min-w-0">
        <p class="m-0 mb-1.5 text-xs text-white/60 truncate">{worldName}</p>
        <div class="flex items-center gap-2 min-w-0">
            <span class="accent shrink-0 flex" aria-hidden="true"><IconDoor font-size="18" /></span>
            <h3 class="m-0 text-lg font-bold leading-tight tracking-tight text-white truncate">{room.name}</h3>
        </div>
        {#if room.description}
            <p class="description m-0 mt-1.5 text-xs leading-relaxed text-white/60">{room.description}</p>
        {/if}
    </div>

    <dl class="grid grid-cols-2 gap-2.5 m-0 mt-auto pt-2.5 border-0 border-t border-solid border-white/10">
        <div>
            <dt class="mb-0.5 text-[11px] text-white/60">{$LL.actionbar.explore.visits()}</dt>
            <dd class="m-0 text-base font-semibold tabular-nums text-white">{room.visits.toLocaleString()}</dd>
        </div>
        <div>
            <dt class="mb-0.5 text-[11px] text-white/60">{$LL.actionbar.explore.peak()}</dt>
            <dd class="m-0 text-base font-semibold tabular-nums text-white">{peak ?? $LL.actionbar.explore.never()}</dd>
        </div>
    </dl>
</button>

<style>
    /* Orbit's room accent: amber, with a green "you are here" dot. */
    .explore-card {
        --room-accent: #f59e0b;
        border-color: rgb(255 255 255 / 0.1);
        background: rgb(255 255 255 / 0.04);
    }
    .explore-card:hover,
    .explore-card:focus-visible {
        border-color: color-mix(in srgb, var(--room-accent) 44%, transparent);
    }
    .explore-card:focus-visible {
        outline: 2px solid var(--room-accent);
        outline-offset: 2px;
    }
    .current {
        background: linear-gradient(118deg, rgb(255 255 255 / 0.04) 20%, rgb(245 158 11 / 0.08));
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
        background-image: radial-gradient(var(--room-accent) 0.65px, transparent 0.8px);
        background-size: 26px 26px;
        opacity: 0.18;
        mask-image: linear-gradient(100deg, transparent, #000);
    }
    .accent,
    .eyebrow,
    .orbit {
        color: var(--room-accent);
    }
    .orbit {
        opacity: 0.8;
    }
    .presence {
        background: #22c55e;
        box-shadow: 0 0 0 4px rgb(34 197 94 / 0.18);
    }
    .description {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        overflow: hidden;
    }
    @media (prefers-reduced-motion: reduce) {
        .explore-card {
            transition: none;
        }
    }
</style>
