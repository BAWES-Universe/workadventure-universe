<script lang="ts">
    import { coWebsites } from "../../../../src/front/Stores/CoWebsiteStore";
    import PanelProbe from "./PanelProbe.svelte";
</script>

{#each $coWebsites as coWebsite (coWebsite.getId())}
    <PanelProbe id={coWebsite.getId()} />
{/each}
