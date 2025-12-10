<script lang="ts">
    import { adminDashboardActivatedStore } from "../../../Stores/MenuStore";
    import ActionBarButton from "../ActionBarButton.svelte";
    import { openAdminModalFromMenu } from "../../../external-modules/admin-api/index";
    import WorldIcon from "../../Icons/WorldIcon.svelte";

    export let first: boolean | undefined = undefined;
    export let last: boolean | undefined = undefined;
    export let classList: string | undefined = undefined;

    // Ensure Orbit always has proper left margin and rounded corners
    $: finalClassList = classList ? classList : "!rounded-s-lg !ps-2 !ml-1 @md/actions:!ml-2 @xl/actions:!ml-4";
</script>

{#if $adminDashboardActivatedStore}
    <ActionBarButton
        label="Orbit"
        tooltipTitle="Explore the universe and what's in orbit"
        boldLabel={true}
        hideIconInActionBar={false}
        on:click={openAdminModalFromMenu}
        {first}
        {last}
        classList={finalClassList}
    >
        <WorldIcon />
    </ActionBarButton>
{/if}
