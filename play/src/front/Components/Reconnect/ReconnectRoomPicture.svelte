<script lang="ts">
    import { softReconnect } from "../../Connection/SoftReconnect";

    $: picture = $softReconnect?.picture;

    /** Puts a still copy (the names, the bar) in place. */
    function still(node: HTMLElement, element: HTMLElement | undefined) {
        const show = (next: HTMLElement | undefined) => node.replaceChildren(...(next ? [next] : []));
        show(element);
        return { update: show, destroy: () => node.replaceChildren() };
    }
</script>

{#if picture}
    <!-- The room as it was (the others faded) while the game rebuilds it underneath: over the map, under the chat.
         It takes the taps on the map, which wait until the game is back in (#958). -->
    <div
        class="reconnect-room-picture absolute inset-0 z-[1] overflow-hidden bg-black"
        data-testid="reconnect-room-picture"
    >
        <img
            src={picture.src}
            alt=""
            draggable="false"
            class="absolute max-w-none select-none"
            style="left: {picture.left}px; top: {picture.top}px; width: {picture.width}px; height: {picture.height}px;"
        />
        <div class="pointer-events-none absolute inset-0" use:still={picture.names} />
    </div>
    <!-- The bar as it was, where it was; its taps wait too. -->
    <div class="contents" inert use:still={picture.ui} />
{/if}

<style>
    /* The names only show on a loaded scene (style.scss); the copy shows them as they were. */
    :global(.reconnect-room-picture .username-display) {
        display: flex;
    }
</style>
