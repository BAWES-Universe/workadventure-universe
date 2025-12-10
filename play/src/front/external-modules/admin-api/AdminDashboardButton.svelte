<script lang="ts">
    export let onOpenModal: () => void;
</script>

<button
    type="button"
    class="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
    on:click={onOpenModal}
    title="Open Admin Dashboard"
>
    <span>Admin Dashboard</span>
</button>
