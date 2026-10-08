<script lang="ts">
    import type { Readable } from "svelte/store";
    import Woka from "../Woka/Woka.svelte";

    export let picture: Readable<string | undefined>;
</script>

{#if $picture}
    <Woka src={$picture} customWidth="28px" />
{/if}
