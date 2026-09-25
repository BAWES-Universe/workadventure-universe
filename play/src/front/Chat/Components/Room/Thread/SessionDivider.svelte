<script lang="ts">
    import LL, { locale } from "../../../../../i18n/i18n-svelte";
    import type { ProximitySessionMarker } from "../../../Connection/Proximity/ProximitySessions";
    import { formatSessionDivider } from "../../../Connection/Proximity/ProximitySessions";
    import { IconArrowBackUp, IconMapPin, IconUsers } from "@wa-icons";

    export let marker: ProximitySessionMarker;
    export let date: Date | null;
    /** The group this tab is in right now: the divider is highlighted. */
    export let isCurrent = false;
    /** You came back to the same people (or place) and carried on: "Back with Sara" instead of "With Sara". */
    export let resumed = false;

    $: isArea = marker.participants.length === 0;
    $: text = resumed
        ? isArea
            ? $LL.chat.thread.backIn({ name: marker.label })
            : $LL.chat.thread.backWith({ names: marker.label })
        : formatSessionDivider(marker, { withPeople: $LL.chat.thread.withPeople });
    $: time = date?.toLocaleTimeString($locale, { hour: "2-digit", minute: "2-digit" });
</script>

<div
    class="session-divider flex items-center gap-2 px-3 pt-4 pb-3"
    role="separator"
    aria-label={text}
    data-testid="threadSessionDivider"
    data-current={isCurrent}
    data-resumed={resumed}
>
    <span class="session-divider-line h-px grow" aria-hidden="true" />
    <span
        class="flex min-w-0 max-w-[80%] items-center gap-1.5 rounded-full px-3 py-1 text-xs {isCurrent
            ? 'session-divider-current text-white font-bold'
            : 'bg-white/5 text-white/70'}"
    >
        {#if resumed}
            <IconArrowBackUp font-size="12" class="shrink-0 opacity-80" />
        {:else if isArea}
            <IconMapPin font-size="12" class="shrink-0 opacity-80" />
        {:else}
            <IconUsers font-size="12" class="shrink-0 opacity-80" />
        {/if}
        <span class="truncate" data-testid="threadSessionDividerLabel">{text}</span>
        {#if time}
            <span class="shrink-0 font-normal text-white/40">{time}</span>
        {/if}
    </span>
    <span class="session-divider-line h-px grow" aria-hidden="true" />
</div>

<style>
    .session-divider-line {
        background-image: linear-gradient(to right, transparent, rgb(255 255 255 / 0.14));
    }

    .session-divider-line:last-child {
        background-image: linear-gradient(to left, transparent, rgb(255 255 255 / 0.14));
    }

    .session-divider-current {
        background-image: linear-gradient(to right, rgb(134 41 252 / 0.35), rgb(65 86 246 / 0.3));
        box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.12);
    }

    :global([dir="rtl"]) .session-divider-line {
        background-image: linear-gradient(to left, transparent, rgb(255 255 255 / 0.14));
    }

    :global([dir="rtl"]) .session-divider-line:last-child {
        background-image: linear-gradient(to right, transparent, rgb(255 255 255 / 0.14));
    }

    :global([dir="rtl"]) .session-divider-current {
        background-image: linear-gradient(to left, rgb(134 41 252 / 0.35), rgb(65 86 246 / 0.3));
    }
</style>
