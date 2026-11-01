<script lang="ts">
    // "Lock room" while the player stands in a lockable room they may lock (#1622). It sits beside the bubble's own
    // Lock, which stays as it is: one locks the bubble, this one the room.
    import LockIcon from "../../Icons/LockIcon.svelte";
    import LockOpenIcon from "../../Icons/LockOpenIcon.svelte";
    import ActionBarButton from "../ActionBarButton.svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import { lockableRoomStore } from "../../../Stores/LockableRoomStore";
    import { gameManager } from "../../../Phaser/Game/GameManager";

    function toggle() {
        gameManager.getCurrentGameScene().getGameMapFrontWrapper().areasManager?.toggleLockableRoom();
    }
</script>

{#if $lockableRoomStore?.canToggle}
    <ActionBarButton
        on:click={toggle}
        classList="group/btn-lock-room"
        label={$lockableRoomStore.locked ? $LL.area.unlockRoom() : $LL.area.lockRoom()}
        state={$lockableRoomStore.locked ? "forbidden" : "normal"}
        dataTestId="lock-room-button"
    >
        {#if $lockableRoomStore.locked}
            <LockIcon />
        {:else}
            <LockOpenIcon />
        {/if}
    </ActionBarButton>
{/if}
