<script lang="ts">
    import { getContext, hasContext } from "svelte";
    import LL from "../../i18n/i18n-svelte";
    import { coWebsites } from "../Stores/CoWebsiteStore";
    import { ArtifactCoWebsite } from "../WebRtc/CoWebsite/ArtifactCoWebsite";
    import type { ArtifactChat } from "./ArtifactApi";
    import { artifactBadge, artifactKindName } from "./artifactBadge";
    import type { ArtifactCard } from "./artifactCard";
    import { ARTIFACT_CHAT_CONTEXT, type ArtifactChatOf } from "./artifactChatContext";
    import { openArtifactFromCard } from "./openArtifact";

    /** A bot's artifact as a card in the chat: tap it to open the artifact in the window. */
    export let card: ArtifactCard;
    /** The name of the bot that sent the message, when the card itself does not say. */
    export let makerName: string | undefined = undefined;
    /** A card for a pasted share link (game #1582): it names its maker instead of a version, and says when it is open. */
    export let fromLink = false;

    const chatOf: ArtifactChatOf | undefined = hasContext(ARTIFACT_CHAT_CONTEXT)
        ? getContext(ARTIFACT_CHAT_CONTEXT)
        : undefined;

    $: openWindow = $coWebsites.find(
        (coWebsite): coWebsite is ArtifactCoWebsite =>
            coWebsite instanceof ArtifactCoWebsite && coWebsite.artifactId === card.id
    );
    $: shownVersion = openWindow?.version;
    // A pasted link's card stands for the latest version, whichever number that is now.
    $: isOpen =
        openWindow !== undefined && ($shownVersion === card.version || (fromLink && $shownVersion === undefined));
    $: badge = artifactBadge(card.kind, $LL);
    $: kindName = artifactKindName(card.kind, $LL);
    $: linkMaker = card.maker ?? makerName;
    $: sub =
        fromLink && linkMaker
            ? (isOpen ? $LL.chat.artifacts.linkCardLineOpen : $LL.chat.artifacts.linkCardLine)({
                  kind: kindName,
                  maker: linkMaker,
              })
            : $LL.chat.artifacts.cardLine({ kind: kindName, version: card.version });

    function open() {
        const chat: ArtifactChat | undefined = chatOf?.();
        openArtifactFromCard(card, chat, makerName, fromLink);
    }
</script>

<button
    type="button"
    class="artifact-card"
    class:open={isOpen}
    aria-label={$LL.chat.artifacts.cardAria({ title: card.title, version: card.version })}
    data-testid="artifactCard"
    on:click={open}
>
    <span class="badge" style:background={badge.color} aria-hidden="true">{badge.label}</span>
    <span class="text">
        <span class="name">{card.title}</span>
        <span class="sub">{sub}</span>
    </span>
</button>

<style>
    /* The same card as a link's preview, so it reads as part of the message; soft violet when it is the one that is open. */
    .artifact-card {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-width: 230px;
        min-height: 56px;
        box-sizing: border-box;
        padding: 8px;
        border: 0;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.05);
        color: #fff;
        font: inherit;
        text-align: start;
        cursor: pointer;
    }
    .artifact-card:hover {
        background: rgba(255, 255, 255, 0.09);
    }
    .artifact-card:focus-visible {
        outline: 2px solid #c4b5fd;
        outline-offset: 2px;
    }
    .artifact-card.open {
        outline: 2px solid rgba(167, 139, 250, 0.7);
        outline-offset: -2px;
        background: rgba(134, 41, 252, 0.14);
    }
    .badge {
        flex: none;
        width: 40px;
        height: 40px;
        border-radius: 8px;
        display: grid;
        place-items: center;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.04em;
        color: #fff;
    }
    .text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
    }
    .name {
        font-size: 14px;
        line-height: 20px;
        color: rgba(255, 255, 255, 0.9);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .sub {
        font-size: 12px;
        line-height: 16px;
        color: rgba(255, 255, 255, 0.6);
        margin-top: 2px;
    }
</style>
