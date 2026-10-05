<script lang="ts">
    import { broadcastInboxStore, broadcastPanelOpenStore } from "../../Stores/BroadcastStore";
    import { menuVisiblilityStore, openedMenuStore } from "../../Stores/MenuStore";
    import { modalVisibilityStore, roomListVisibilityStore } from "../../Stores/ModalStore";
    import { wokaMenuStore } from "../../Stores/WokaMenuStore";
    import { actionsMenuStore } from "../../Stores/ActionsMenuStore";
    import { expressTrayStore } from "../../Stores/ExpressStore";
    import { liveBroadcastStore } from "../../Stores/MegaphoneStore";
    import { enableUserInputsStore } from "../../Stores/UserInputStore";
    import BroadcastReceivedCard from "./BroadcastReceivedCard.svelte";

    // Escape dismisses the newest card only, one per press, and only when nothing else was open: an Escape that closes
    // a menu, a window, the Broadcast card or leaves a text field does only that. Read in the capture phase, before
    // the other Escape handlers close what was open.
    function onKeyDown(event: KeyboardEvent) {
        if (event.key !== "Escape") return;
        const somethingElseOpen =
            $broadcastPanelOpenStore ||
            $openedMenuStore !== undefined ||
            $menuVisiblilityStore ||
            $modalVisibilityStore ||
            $roomListVisibilityStore ||
            $wokaMenuStore !== undefined ||
            $actionsMenuStore !== undefined ||
            $expressTrayStore !== "closed" ||
            !$enableUserInputsStore;
        if (somethingElseOpen) return;
        const newest = $broadcastInboxStore[0];
        if (newest) broadcastInboxStore.dismiss(newest.id);
    }

    // The last opened in front: Settings opened while cards show goes over them (they stay, under it), and a card that
    // arrives while Settings is open comes over it.
    let settingsOpenedAt: number | undefined;
    $: settingsOpenedAt = $menuVisiblilityStore ? settingsOpenedAt ?? Date.now() : undefined;
    $: settingsOverCards =
        settingsOpenedAt !== undefined &&
        $broadcastInboxStore.length > 0 &&
        $broadcastInboxStore[0].receivedAt <= settingsOpenedAt;
</script>

<svelte:window on:keydown|capture={onKeyDown} />

{#if $broadcastInboxStore.length > 0}
    <!-- Received broadcasts stack at the top of the screen, the newest first, each until its Got it. While you are live
         yourself they start under your Live pill, which holds the same top strip on a phone (a desktop has the pill on
         the left and the cards on the right). -->
    <div
        class="fixed {settingsOverCards ? 'z-[890]' : 'z-[1090]'} pointer-events-none inset-x-3 {$liveBroadcastStore
            ? 'top-20'
            : 'top-3'} flex flex-col gap-2 lg:inset-x-auto lg:right-4 lg:top-20 lg:w-[380px]"
        data-testid="broadcast-inbox"
    >
        {#each $broadcastInboxStore as card (card.id)}
            <BroadcastReceivedCard {card} on:dismiss={() => broadcastInboxStore.dismiss(card.id)} />
        {/each}
    </div>
{/if}
