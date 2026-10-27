<script lang="ts">
    import { getContext, hasContext } from "svelte";
    import { readable, type Readable } from "svelte/store";
    import { LL } from "../../../i18n/i18n-svelte";
    import { gameSceneStore } from "../../Stores/GameSceneStore";
    import PlaceKindIcon from "../../Components/Icons/PlaceKindIcon.svelte";
    import { DIRECT_PARTNER_CONTEXT, type DirectPartner } from "../Components/Room/DirectChat/DirectPartnerStore";
    import type { BotRoomLink } from "./BotRoomLink";
    import { roomCardTarget, visitBotRoom } from "./visitBotRoom";
    import { IconLogin } from "@wa-icons";

    /** The room a bot's reply names, with where it is and a Visit button that takes you to the bot there. */
    export let link: BotRoomLink;
    export let botName: string | undefined;

    const partner: Readable<DirectPartner | undefined> = hasContext(DIRECT_PARTNER_CONTEXT)
        ? getContext(DIRECT_PARTNER_CONTEXT)
        : readable(undefined);

    $: currentRoomUrl = $gameSceneStore?.roomUrl;
    $: here = roomCardTarget(link, $partner, currentRoomUrl) === "here";
</script>

<div class="bot-room-card" data-testid="botRoomCard">
    <div class="bot-room-card-room">
        <PlaceKindIcon kind="room" size={16} />
        <span class="bot-room-card-name">{link.room}</span>
    </div>
    {#if link.world || link.universe}
        <div class="bot-room-card-where">
            {#if link.world}
                <span class="bot-room-card-place"><PlaceKindIcon kind="world" size={13} />{link.world}</span>
            {/if}
            {#if link.universe}
                <span class="bot-room-card-place"><PlaceKindIcon kind="universe" size={13} />{link.universe}</span>
            {/if}
        </div>
    {/if}
    <div class="bot-room-card-actions">
        {#if here}
            <span class="bot-room-card-here" data-testid="botRoomCardHere">{$LL.chat.botStatus.inThisRoom()}</span>
        {:else}
            <button
                class="u-cta bot-room-card-button"
                aria-label={$LL.chat.botStatus.visitAria({ name: botName ?? "", room: link.room })}
                on:click={() => visitBotRoom(link, $partner, currentRoomUrl)}
                data-testid="botRoomCardVisit"
            >
                <IconLogin font-size={15} />
                {$LL.chat.botStatus.visit()}
            </button>
        {/if}
    </div>
</div>

<style lang="scss">
    /* The same card as a link's preview, so it reads as part of the message; its button is the chat's pill. */
    .bot-room-card {
        box-sizing: border-box;
        width: 300px;
        max-width: calc(100% - 16px);
        margin: 2px 8px 8px;
        padding: 9px 10px 0;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: white;
    }
    .bot-room-card-room {
        display: flex;
        align-items: center;
        gap: 7px;
        min-width: 0;
    }
    .bot-room-card-name {
        min-width: 0;
        font-size: 13.5px;
        font-weight: 700;
        line-height: 1.3;
        overflow-wrap: anywhere;
    }
    .bot-room-card-where {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 12px;
        margin-top: 4px;
        font-size: 12px;
        line-height: 1.35;
        color: rgba(255, 255, 255, 0.65);
    }
    .bot-room-card-place {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-width: 0;
        overflow-wrap: anywhere;
    }
    .bot-room-card-actions {
        display: flex;
        align-items: center;
        min-height: 32px;
        padding: 8px 0 10px;
    }
    .bot-room-card-here {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.65);
    }
    .bot-room-card-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        height: 32px;
        margin: 0;
        padding: 0 14px;
        border-radius: 9999px;
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
        white-space: nowrap;
        color: white;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }
    /* On a touch screen the button is a full 44px tap target, as on a link's card. */
    @media (pointer: coarse) {
        .bot-room-card-button {
            height: 44px;
            padding: 0 18px;
            font-size: 13px;
        }
    }
</style>
