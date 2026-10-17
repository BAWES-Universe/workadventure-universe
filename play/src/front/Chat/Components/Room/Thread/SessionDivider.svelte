<script lang="ts">
    import LL, { locale } from "../../../../../i18n/i18n-svelte";
    import type { ProximitySessionMarker } from "../../../Connection/Proximity/ProximitySessions";
    import { formatSessionDivider } from "../../../Connection/Proximity/ProximitySessions";

    export let marker: ProximitySessionMarker;
    export let date: Date | null;
    /** The group this tab is in right now (data-current). */
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

<!-- The same look as someone joining or leaving (MessageSystem), so every notice in the chat reads alike. -->
<div
    class="session-divider flex justify-center px-3 mb-3"
    role="separator"
    aria-label={text}
    data-testid="threadSessionDivider"
    data-current={isCurrent}
    data-resumed={resumed}
>
    <span class="max-w-[80%] px-3 py-1.5 m-0 text-xs text-center border border-solid border-white/10 rounded-2xl">
        <span class="text-white/80" data-testid="threadSessionDividerLabel">{text}</span>
        {#if time}<span class="text-white/40">{time}</span>{/if}
    </span>
</div>

<style>
    .session-divider {
        overflow-wrap: anywhere;
    }
</style>
