<script lang="ts">
    import { onMount } from "svelte";
    import { get } from "svelte/store";
    import { requestVisitCardsStore, selectedChatIDRemotePlayerStore } from "../../Stores/GameStore";
    import { LL } from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { openDirectChatRoom } from "../../Chat/Utils";
    import chat from "../images/chat.png";

    import ButtonClose from "../Input/ButtonClose.svelte";
    import Spinner from "../Icons/Spinner.svelte";
    import { IconLoader } from "@wa-icons";

    export let visitCardUrl: string;
    export let isEmbedded = false;
    export let showSendMessageButton = true;
    export let maxHeigth = 350;
    let w = "100%";
    let h = 250;
    let hidden = true;
    let cvIframe: HTMLIFrameElement;

    const chatConnection = gameManager.chatConnection;
    const selectPlayerChatID = get(selectedChatIDRemotePlayerStore);
    const roomCreationInProgress = chatConnection.roomCreationInProgress;

    function closeCard() {
        requestVisitCardsStore.set(null);
    }

    function openChat() {
        if (!selectPlayerChatID) return;
        openDirectChatRoom(selectPlayerChatID).catch((error) => console.error(error));
        closeCard();
    }

    function handleIframeMessage(message: MessageEvent) {
        // Only this card's own frame: another card open at the same time sends its own size.
        if (message.source !== cvIframe?.contentWindow) return;
        if (message.data?.type === "cvIframeSize") {
            // w = message.data.data.w + "px";
            h = message.data.data.h;
        }
    }

    onMount(() => {
        cvIframe.onload = () => (hidden = false);
        cvIframe.onerror = () => (hidden = false);
    });
</script>

<!-- A profile with nothing written and no links reports no height: embedded, the card then takes no room at all
     (an empty frame would still leave a dark strip). -->
<section class="visitCard {isEmbedded ? 'w-full' : 'max-w-[320px]'}" class:collapsed={isEmbedded && !hidden && h === 0}>
    <div class="{isEmbedded ? '' : 'bg-contrast/80 rounded-lg backdrop-blur'} relative">
        {#if !isEmbedded}
            <div class="absolute top-2 {h > maxHeigth ? 'right-5' : ' right-2'}">
                <ButtonClose size="xs" dataTestId="closeVisitCardButton" on:click={closeCard} />
            </div>
        {/if}
        {#if hidden}
            <div class="w-full flex justify-center items-center p-4">
                <Spinner size="lg" />
            </div>
        {/if}
        <div class={isEmbedded ? "" : "px-2 py-4"}>
            <iframe
                title="visitCard"
                src="{visitCardUrl}&embed={isEmbedded}"
                class="max-h-lg"
                class:block={isEmbedded}
                allow="clipboard-read; clipboard-write {visitCardUrl}"
                style="width: {isEmbedded ? '100%' : w}; height: {Math.max(
                    isEmbedded ? 1 : 0,
                    Math.min(h, maxHeigth)
                )}px; color-scheme: dark"
                class:hidden
                bind:this={cvIframe}
            />
        </div>
        {#if !hidden && !isEmbedded}
            <div class="buttonContainer p-2.5 flex flex-row justify-end gap-2 bg-contrast rounded-b-lg">
                {#if selectPlayerChatID && showSendMessageButton}
                    {#if !$roomCreationInProgress}
                        <button
                            class="btn btn-secondary text-nowrap justify-center m-2 flex-1 min-w-0"
                            data-testid="sendMessagefromVisitCardButton"
                            on:click={openChat}
                        >
                            <img src={chat} alt="chat" class="w-6 h-6 mx-2" draggable="false" />
                            {$LL.menu.visitCard.sendMessage()}
                        </button>
                    {:else}
                        <button
                            class="light cursor-pointer px-3 mb-2 mr-0"
                            data-testid="sendMessagefromVisitCardButton"
                        >
                            <IconLoader class="animate-spin" />
                        </button>
                    {/if}
                {/if}
            </div>
        {/if}
    </div>
</section>

<svelte:window on:message={handleIframeMessage} />

<style lang="scss">
    .visitCard {
        pointer-events: all;
        z-index: 750;

        /* Out of the way but not hidden: the browser stops updating a hidden or zero-size frame from another
           site, so it could never report the profile's real height. */
        &.collapsed {
            position: absolute;
            opacity: 0;
            pointer-events: none;
        }

        iframe {
            border: 0;
            overflow: hidden;
            /* The profile inside declares a dark scheme too: when the two differ, the browser paints the frame
               opaque (white), instead of letting the card sit on the panel. */

            &.hidden {
                visibility: hidden;
                position: absolute;
            }
        }

        button {
            float: right;
        }
    }
</style>
