<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { panelEvents } from "./panelEvents";

    export let id: string;
    onMount(() => {
        panelEvents.push(`mount:${id}`);
    });
    onDestroy(() => {
        panelEvents.push(`destroy:${id}`);
    });
</script>

<div data-panel={id} />
