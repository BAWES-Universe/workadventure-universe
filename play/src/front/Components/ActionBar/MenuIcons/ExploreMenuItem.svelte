<script lang="ts">
    import { openedMenuStore, roomListActivated } from "../../../Stores/MenuStore";
    import {
        modalIframeStore,
        modalVisibilityStore,
        roomListVisibilityStore,
        showModalGlobalComminucationVisibilityStore,
    } from "../../../Stores/ModalStore";
    import { chatVisibilityStore } from "../../../Stores/ChatStore";
    import { universeNameStore } from "../../../Stores/ExploreStore";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import ActionBarButton from "../ActionBarButton.svelte";
    import { displayName } from "../../Exploration/exploreText";
    import LL from "../../../../i18n/i18n-svelte";
    import { IconPlanet } from "@wa-icons";

    // "Explore {Universe}": the rooms of every world in this universe. In the action bar on wide screens, in the
    // hamburger menu on narrow ones (it sits with the contextual items, which move there).

    function toggle() {
        if ($roomListVisibilityStore) {
            roomListVisibilityStore.set(false);
            return;
        }
        analyticsClient.openedRoomList();
        // The list sits over the game: close the chat and any modal it would be hidden under.
        chatVisibilityStore.set(false);
        modalVisibilityStore.set(false);
        modalIframeStore.set(null);
        showModalGlobalComminucationVisibilityStore.set(false);
        roomListVisibilityStore.set(true);
        openedMenuStore.closeAll();
    }

    $: label = $universeNameStore
        ? $LL.actionbar.explore.button({ universe: displayName($universeNameStore) })
        : $LL.actionbar.explore.buttonWithoutName();
</script>

{#if $roomListActivated}
    <ActionBarButton
        on:click={toggle}
        {label}
        boldLabel={true}
        classList="group/btn-explore"
        tooltipTitle={label}
        desc={$LL.actionbar.explore.desc()}
        disabledHelp={$roomListVisibilityStore}
        dataTestId="explore-button"
    >
        <IconPlanet font-size="20" class="text-white" />
    </ActionBarButton>
{/if}
