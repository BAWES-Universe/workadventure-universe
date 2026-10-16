<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { mapEditorAskToClaimPersonalAreaStore } from "../../Stores/MapEditorStore";
    import LL from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { notificationPlayingStore } from "../../Stores/NotificationStore";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import PopUpContainer from "../PopUp/PopUpContainer.svelte";
    import { inputFormFocusStore } from "../../Stores/UserInputStore";

    let name = "";
    const mapEditorModeManager = gameManager.getCurrentGameScene().getMapEditorModeManager();

    // function to check key press and if it is enter key then click on yes button
    function emitKeypressEvents(event: KeyboardEvent) {
        if (event.key === "Enter") {
            const claimPersonalAreaButton = document.querySelector("[data-testid=claimPersonalAreaButton]");
            claimPersonalAreaButton?.dispatchEvent(new MouseEvent("click"));
        }
    }

    // Typing here must not walk the avatar; closing the popup while typing gives the keys back.
    onDestroy(() => inputFormFocusStore.set(false));

    onMount(() => {
        // set name to current user name
        name = gameManager.getCurrentGameScene().CurrentPlayer.playerName;

        // Defined query to ask if the user be able to claim the area
        const userUUID = localUserStore.getLocalUser()?.uuid;
        if (userUUID === undefined) {
            console.error("Unable to claim the area, your UUID is undefined");
            return;
        }
        const gameMapFrontWrapper = gameManager.getCurrentGameScene().getGameMapFrontWrapper();
        gameMapFrontWrapper.areasManager?.getAreasByPropertyType("personalAreaPropertyData").forEach((area) => {
            const property = area.areaData.properties.find((property) => property.type === "personalAreaPropertyData");
            if (property !== undefined && property.ownerId === userUUID) {
                // If the user already has a personal area, we do not allow him to claim another one
                notificationPlayingStore.playNotification($LL.area.personalArea.alreadyHavePersonalArea());
            }
        });
    });
</script>

<div class="absolute w-fit bottom-0 left-0 right-0 pb-4 pointer-events-auto z-[150] m-auto hover:animate-none">
    <PopUpContainer extraClasses="w-fit">
        <p class="m-0 mt-2">{$LL.area.personalArea.claimDescription()}</p>
        <!-- The game's field (u-join-field), as on the join screens. -->
        <label class="flex flex-col gap-2 mt-3 text-left" for="claimPersonalAreaInput">
            <span class="text-sm text-white">{$LL.area.personalArea.yourName()}</span>
            <span class="u-join-field">
                <input
                    id="claimPersonalAreaInput"
                    class="cp-input"
                    type="text"
                    bind:value={name}
                    on:keydown={emitKeypressEvents}
                    on:focus={() => inputFormFocusStore.set(true)}
                    on:blur={() => inputFormFocusStore.set(false)}
                />
            </span>
        </label>
        <div slot="buttons" class="flex flex-row justify-content-center w-full gap-2">
            <button
                type="button"
                class="u-cta-secondary h-11 m-0 px-4 rounded-full w-full justify-center text-sm font-bold"
                on:click|preventDefault={() => mapEditorAskToClaimPersonalAreaStore.set(undefined)}
                >{$LL.area.personalArea.buttons.no()}
            </button>
            <button
                data-testid="claimPersonalAreaButton"
                type="button"
                class="u-cta h-11 m-0 px-4 rounded-full w-full justify-center text-sm font-bold"
                on:click={() => mapEditorModeManager.claimPersonalArea(name)}
                >{$LL.area.personalArea.buttons.yes()}
            </button>
        </div>
    </PopUpContainer>
</div>

<style>
    .cp-input {
        flex: 1;
        min-width: 0;
        height: 100%;
        padding: 0;
        border: 0;
        background: transparent;
        font: inherit;
        font-size: 15px;
        color: #fff;
        outline: none;
        box-shadow: none;
    }
</style>
