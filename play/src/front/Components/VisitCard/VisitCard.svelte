<script lang="ts">
    import { onMount } from "svelte";
    import { get } from "svelte/store";
    import { requestVisitCardsStore, selectedChatIDRemotePlayerStore } from "../../Stores/GameStore";
    import { LL } from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { openDirectChatRoom } from "../../Chat/Utils";
    import { isHttpUrl } from "../../Utils/SafeUrl";
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

    // A visit card is a web page: anything else (a javascript: link...) would run in the game's page.
    $: safeVisitCardUrl = isHttpUrl(visitCardUrl) ? visitCardUrl : undefined;

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
        if (message.data.type === "cvIframeSize") {
            // w = message.data.data.w + "px";
            h = message.data.data.h;
        }
    }

    onMount(() => {
        cvIframe.onload = () => (hidden = false);
        cvIframe.onerror = () => (hidden = false);
    });
</script>

<section class="visitCard {isEmbedded ? 'w-full' : 'max-w-[320px]'}">
    <div class="{isEmbedded ? '' : 'bg-contrast/80 rounded-lg'} relative backdrop-blur">
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
                src={safeVisitCardUrl ? `${safeVisitCardUrl}&embed=${isEmbedded}` : "about:blank"}
                class="max-h-lg"
                allow="clipboard-read; clipboard-write {safeVisitCardUrl ?? ''}"
                style="width: {isEmbedded ? '100%' : w}; height: {Math.min(h, maxHeigth)}px; color-scheme: dark"
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
