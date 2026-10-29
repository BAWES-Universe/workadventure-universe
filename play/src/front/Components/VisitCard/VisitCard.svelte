<script lang="ts">
    import { get, readable } from "svelte/store";
    import { requestVisitCardsStore, selectedChatIDRemotePlayerStore } from "../../Stores/GameStore";
    import { wokaMenuStore } from "../../Stores/WokaMenuStore";
    import { actionsMenuStore } from "../../Stores/ActionsMenuStore";
    import {
        isFromCardOrigin,
        isProfileLinkList,
        openProfileLinkHere,
        profileLinksOpeningHere,
    } from "../../Chat/LinkPreview/ProfileLinks";
    import { LL } from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { openDirectChatRoom } from "../../Chat/Utils";
    import { isHttpUrl } from "../../Utils/SafeUrl";
    import { botApiService } from "../../external-modules/bots/services/BotApiService";
    import chat from "../images/chat.png";

    import ButtonClose from "../Input/ButtonClose.svelte";
    import Spinner from "../Icons/Spinner.svelte";
    import ProfileCard from "./ProfileCard.svelte";
    import { orbitProfileUuid, profileCardStore, type ProfileCardState } from "./ProfileCard";
    import { IconLoader } from "@wa-icons";

    export let visitCardUrl: string;
    export let isEmbedded = false;
    export let showSendMessageButton = true;
    export let maxHeigth = 350;
    let w = "100%";
    let h = 250;
    let hidden = true;
    let cvIframe: HTMLIFrameElement;

    // A visit card is a web page: anything else (a javascript: link...) would run in the game's page. A relative link
    // is a page on the game's own server, and loads as before.
    function isWebPage(url: string): boolean {
        try {
            return isHttpUrl(new URL(url, window.location.href).href);
        } catch {
            return false;
        }
    }
    $: safeVisitCardUrl = isWebPage(visitCardUrl) ? visitCardUrl : undefined;

    // An Orbit card is drawn here from its data and kept while you're in the game, so it shows again at once (#1585).
    // Any other card, or one Orbit can't give as data, is its page in a frame.
    $: profileUuid = safeVisitCardUrl
        ? orbitProfileUuid(safeVisitCardUrl, botApiService.adminOrigin, window.location.href)
        : undefined;
    $: cardState = profileUuid
        ? profileCardStore(profileUuid, (uuid) => botApiService.getProfileCard(uuid))
        : readable<ProfileCardState>({ kind: "frame" });
    $: framed = $cardState.kind === "frame";
    $: drawn = $cardState.kind === "card" ? $cardState.card : undefined;
    $: waiting = framed ? hidden : $cardState.kind === "loading";
    let drawnHeight = 0;
    $: cardHeight = framed ? h : drawnHeight;

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
        } else if (!isFromCardOrigin(message.origin, safeVisitCardUrl, window.location.href)) {
            // Asking about links and opening one are left to the card itself: the frame may have gone to another site.
            return;
        } else if (message.data?.type === "cvCheckLinks" && isProfileLinkList(message.data.urls)) {
            answerLinks(message.data.urls);
        } else if (message.data?.type === "cvOpenLink" && typeof message.data.url === "string") {
            // The card covers the window, so it closes to show the page, as Send message closes it to show the chat.
            if (openProfileLinkHere(message.data.url)) closeCards();
        }
    }

    /** Tells the profile which of its links open in the window: those lose their new-tab icon. */
    function answerLinks(urls: string[]) {
        const frame = cvIframe?.contentWindow;
        if (!frame || !safeVisitCardUrl) return;
        const origin = new URL(safeVisitCardUrl, window.location.href).origin;
        profileLinksOpeningHere(urls)
            .then((openHere) => {
                // The card may have closed, or shown someone else, meanwhile.
                if (cvIframe?.contentWindow === frame) frame.postMessage({ type: "cvLinks", openHere }, origin);
            })
            .catch((error) => console.error("Could not check profile links", error));
    }

    /** The card closes from wherever it shows: on its own, or under a player's name. */
    function closeCards() {
        closeCard();
        wokaMenuStore.clear();
        actionsMenuStore.clear();
    }
</script>

<!-- A profile with nothing written and no links reports no height: embedded, the card then takes no room at all
     (an empty frame would still leave a dark strip). -->
<section
    class="visitCard {isEmbedded ? 'w-full' : 'max-w-[320px]'}"
    class:collapsed={isEmbedded && framed && !hidden && h === 0}
>
    <div class="{isEmbedded ? '' : 'bg-contrast/80 rounded-lg backdrop-blur'} relative">
        {#if !isEmbedded}
            <div class="absolute top-2 {cardHeight > maxHeigth ? 'right-5' : ' right-2'}">
                <ButtonClose size="xs" dataTestId="closeVisitCardButton" on:click={closeCard} />
            </div>
        {/if}
        {#if waiting}
            <div class="w-full flex justify-center items-center p-4">
                <Spinner size="lg" />
            </div>
        {/if}
        {#if drawn}
            <div class={isEmbedded ? "" : "px-2 py-4"}>
                <div class="overflow-y-auto" style:max-height="{maxHeigth}px">
                    <div bind:offsetHeight={drawnHeight}>
                        <ProfileCard card={drawn} on:openedHere={closeCards} />
                    </div>
                </div>
            </div>
        {:else if framed}
            <div class={isEmbedded ? "" : "px-2 py-4"}>
                <iframe
                    title="visitCard"
                    src={safeVisitCardUrl ? `${safeVisitCardUrl}&embed=${isEmbedded}` : "about:blank"}
                    class="max-h-lg"
                    class:block={isEmbedded}
                    allow="clipboard-read; clipboard-write {safeVisitCardUrl ?? ''}"
                    style="width: {isEmbedded ? '100%' : w}; height: {Math.max(
                        isEmbedded ? 1 : 0,
                        Math.min(h, maxHeigth)
                    )}px; color-scheme: dark"
                    class:hidden
                    bind:this={cvIframe}
                    on:load={() => (hidden = false)}
                    on:error={() => (hidden = false)}
                />
            </div>
        {/if}
        {#if !waiting && !isEmbedded}
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
