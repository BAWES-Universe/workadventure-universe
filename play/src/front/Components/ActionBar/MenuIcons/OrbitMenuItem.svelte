<script lang="ts">
    import { adminDashboardActivatedStore } from "../../../Stores/MenuStore";
    import { modalIframeStore, modalVisibilityStore } from "../../../Stores/ModalStore";
    import ActionBarButton from "../ActionBarButton.svelte";
    import { openAdminModalFromMenu } from "../../../external-modules/admin-api/index";
    import OrbitIcon from "../../Icons/OrbitIcon.svelte";

    export let first: boolean | undefined = undefined;
    export let last: boolean | undefined = undefined;
    export let classList: string | undefined = undefined;

    // Orbit stands apart from the other buttons: its own pill (round on both ends, with the edge drawn on the
    // start side too, whether or not it is the first item on screen) and a margin before it.
    $: finalClassList = classList
        ? classList
        : "!rounded-s-xl u-seg-start !ps-2 !ml-1 @md/actions:!ml-2 @xl/actions:!ml-4";

    // Orbit is the side window titled "Orbit" (external-modules/admin-api): while it shows, the button shows it is open.
    $: orbitOpen = $modalVisibilityStore && $modalIframeStore?.title === "Orbit";
</script>

{#if $adminDashboardActivatedStore}
    <ActionBarButton
        label="Orbit"
        tooltipTitle="Explore the universe and what's in orbit"
        boldLabel={true}
        chevron
        hideIconInActionBar={false}
        state={orbitOpen ? "open" : "normal"}
        on:click={openAdminModalFromMenu}
        {first}
        {last}
        classList={finalClassList}
    >
        <OrbitIcon />
    </ActionBarButton>
{/if}
