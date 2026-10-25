<script lang="ts">
    import { getContext, hasContext } from "svelte";
    import { readable, type Readable } from "svelte/store";
    import { LL } from "../../../i18n/i18n-svelte";
    import { gameSceneStore } from "../../Stores/GameSceneStore";
    import { DIRECT_PARTNER_CONTEXT, type DirectPartner } from "../Components/Room/DirectChat/DirectPartnerStore";
    import type { BotRoomLink } from "./BotRoomLink";
    import { roomCardTarget, visitBotRoom } from "./visitBotRoom";

    /** The room a bot's reply names: a tap takes you to the bot there. */
    export let link: BotRoomLink;
    export let botName: string | undefined;

    const partner: Readable<DirectPartner | undefined> = hasContext(DIRECT_PARTNER_CONTEXT)
        ? getContext(DIRECT_PARTNER_CONTEXT)
        : readable(undefined);

    $: currentRoomUrl = $gameSceneStore?.roomUrl;
    $: here = roomCardTarget(link, $partner, currentRoomUrl) === "here";
    $: place = link.world ? `${link.room} · ${link.world}` : link.room;
</script>

<button
    class="bot-room-card"
    disabled={here}
    on:click={() => visitBotRoom(link, $partner, currentRoomUrl)}
    data-testid="botRoomCard"
>
    <span class="bot-room-card-place">{place}</span>
    <span class="bot-room-card-hint">
        {here ? $LL.chat.botStatus.inThisRoom() : $LL.chat.botStatus.visitRoom({ name: botName ?? "" })}
    </span>
</button>

<style lang="scss">
    /* The same card as a link's preview, so it reads as part of the message. */
    .bot-room-card {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        justify-content: center;
        gap: 2px;
        width: 300px;
        max-width: calc(100% - 16px);
        min-height: 44px;
        margin: 2px 8px 8px;
        padding: 8px 10px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: white;
        font: inherit;
        text-align: start;
        cursor: pointer;
    }
    .bot-room-card:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.1);
    }
    .bot-room-card:disabled {
        cursor: default;
    }
    .bot-room-card-place {
        max-width: 100%;
        font-size: 13.5px;
        font-weight: 700;
        line-height: 1.3;
        overflow-wrap: anywhere;
    }
    .bot-room-card-hint {
        font-size: 12px;
        line-height: 1.35;
        color: rgba(255, 255, 255, 0.65);
    }
</style>
