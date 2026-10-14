<script lang="ts">
    // Stands in for the whole chat in ChatSidebar's tests: only the sheet around it matters there.
    export let sideBarWidth: number;
</script>

<div data-testid="chatStub" style="width: {sideBarWidth}px" />
