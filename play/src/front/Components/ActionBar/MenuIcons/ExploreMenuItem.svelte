<script lang="ts">
    import { roomListActivated } from "../../../Stores/MenuStore";
    import { roomListVisibilityStore } from "../../../Stores/ModalStore";
    import { universeNameStore } from "../../../Stores/ExploreStore";
    import ActionBarButton from "../ActionBarButton.svelte";
    import { displayName } from "../../Exploration/exploreText";
    import { toggleExploreList } from "../../Exploration/toggleExploreList";
    import LL from "../../../../i18n/i18n-svelte";
    import { IconPlanet } from "@wa-icons";

    // "Explore {Universe}": the rooms of every world in this universe. Its own pill in the action bar, between Tools
    // and Orbit (MenuStore's right items); in the menu when the bar has no room for it. Phones have it in the zoom
    // column (ExplorerMenu.svelte).

    // Set by the action bar for the right items; the pill draws its own ends and margin.
    // svelte-ignore unused-export-let
    export let first: boolean | undefined = undefined;
    export let classList: string | undefined = undefined;

    $: label = $universeNameStore
        ? $LL.actionbar.explore.button({ universe: displayName($universeNameStore) })
        : $LL.actionbar.explore.buttonWithoutName();
</script>

{#if $roomListActivated}
    <ActionBarButton
        on:click={toggleExploreList}
        {label}
        boldLabel={true}
        chevron
        first={true}
        last={true}
        classList="group/btn-explore ms-1 @md/actions:ms-2 @xl/actions:ms-4 {classList ?? ''}"
        tooltipTitle={label}
        desc={$LL.actionbar.explore.desc()}
        disabledHelp={$roomListVisibilityStore}
        state={$roomListVisibilityStore ? "open" : "normal"}
        dataTestId="explore-button"
    >
        <IconPlanet font-size="20" class="text-white" />
    </ActionBarButton>
{/if}
