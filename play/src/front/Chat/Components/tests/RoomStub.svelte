<script lang="ts">
    // Stands for a chat's row, and for the other parts of a folder, in tests of the list that holds them
    export let room: { id: string } | undefined = undefined;
</script>

{#if room}<div data-testid="stub-room">{room.id}</div>{/if}
