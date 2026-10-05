<script lang="ts">
    import { adminDashboardActivatedStore } from "../../../Stores/MenuStore";
    import { modalIframeStore, modalVisibilityStore } from "../../../Stores/ModalStore";
    import ActionBarButton from "../ActionBarButton.svelte";
    import { openAdminModalFromMenu } from "../../../external-modules/admin-api/index";
    import OrbitIcon from "../../Icons/OrbitIcon.svelte";
    import { iframeListener } from "../../../Api/IframeListener";
    import { orbitAttentionCountStore } from "../../../Stores/OrbitAttentionStore";

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

    // Things in Orbit waiting for an answer (invitations for now), counted like chat's unread messages.
    $: attention = $orbitAttentionCountStore;
    $: attentionLabel = attention > 99 ? "99+" : String(attention);

    // The button toggles, like Explore: pressed again while Orbit shows, it closes Orbit the way its close button does.
    function toggleOrbit() {
        if (!orbitOpen) {
            openAdminModalFromMenu();
            return;
        }
        modalVisibilityStore.set(false);
        if ($modalIframeStore != undefined) {
            iframeListener.sendModalCloseTriggered($modalIframeStore);
        }
    }
</script>

{#if $adminDashboardActivatedStore}
    <ActionBarButton
        label="Orbit"
        tooltipTitle="Explore the universe and what's in orbit"
        boldLabel={true}
        chevron
        hideIconInActionBar={false}
        state={orbitOpen ? "open" : "normal"}
        on:click={toggleOrbit}
        {first}
        {last}
        classList={finalClassList}
    >
        <OrbitIcon />
        {#if attention > 0}
            <!-- Where chat draws its unread count: the top-left corner of the pill, which starts 8px before and above
                 this button. -->
            <span
                class="u-badge orbit-attention-badge pointer-events-none absolute -top-4 -start-2 flex min-w-5 h-5 px-1 items-center justify-center text-sm font-bold leading-none tabular-nums rounded-full z-10"
                data-testid="orbitAttentionBadge"
            >
                <span aria-hidden="true">{attentionLabel}</span>
                <span class="sr-only"
                    >, {attention === 1 ? "1 thing waits" : `${attentionLabel} things wait`} for your answer</span
                >
            </span>
        {/if}
    </ActionBarButton>
{/if}

<style>
    /* The same thin ink ring as chat's count, so it stays apart from the pill it sits on. */
    .orbit-attention-badge {
        box-shadow: 0 0 0 2px #0a0814, 0 2px 8px -2px rgba(134, 41, 252, 0.8);
    }
</style>
