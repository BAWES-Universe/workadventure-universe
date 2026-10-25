<script lang="ts">
    import { LL } from "../../../../../i18n/i18n-svelte";
    import PlaceKindIcon from "../../../../Components/Icons/PlaceKindIcon.svelte";
    import type { BotRoomLink } from "../../../Bots/BotRoomLink";
    import { sameRoom } from "./PartnerNowIn";
    import { IconLogin } from "@wa-icons";

    /**
     * A room on a profile in a direct message: where a bot lives, or where a person is now. Visit takes you there, or
     * it says you're already in that room.
     */
    export let label: string;
    export let link: BotRoomLink;
    export let name: string;
    export let currentRoomUrl: string | undefined;
    export let visit: () => void;

    $: inRoom = sameRoom(currentRoomUrl, link.url);
</script>

<div class="partner-room" data-testid="partnerRoom">
    <span class="partner-room-label">{label}</span>
    <div class="partner-room-room">
        <PlaceKindIcon kind="room" size={18} />
        <span class="partner-room-name">{link.room}</span>
    </div>
    {#if link.world || link.universe}
        <div class="partner-room-where">
            {#if link.world}
                <span class="partner-room-place"><PlaceKindIcon kind="world" size={13} />{link.world}</span>
            {/if}
            {#if link.universe}
                <span class="partner-room-place"><PlaceKindIcon kind="universe" size={13} />{link.universe}</span>
            {/if}
        </div>
    {/if}
    {#if inRoom}
        <span class="partner-room-here" data-testid="partnerRoomHere">{$LL.chat.botStatus.inThisRoom()}</span>
    {:else}
        <button
            type="button"
            class="u-cta partner-room-visit"
            aria-label={$LL.chat.botStatus.visitAria({ name, room: link.room })}
            on:click={visit}
            data-testid="partnerRoomVisit"
        >
            <IconLogin font-size={16} />
            {$LL.chat.botStatus.visit()}
        </button>
    {/if}
</div>

<style lang="scss">
    /* A group like the profile's other rows; the button is the chat's pill at a full 44px tap height. */
    .partner-room {
        display: grid;
        gap: 6px;
        padding: 12px 14px 14px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: white;
    }
    .partner-room-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.5);
    }
    .partner-room-room {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
    }
    .partner-room-name {
        min-width: 0;
        font-size: 16px;
        font-weight: 700;
        line-height: 1.3;
        overflow-wrap: anywhere;
    }
    .partner-room-where {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 12px;
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(255, 255, 255, 0.65);
    }
    .partner-room-place {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-width: 0;
        overflow-wrap: anywhere;
    }
    .partner-room-here {
        margin-top: 4px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.65);
    }
    .partner-room-visit {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 44px;
        margin: 6px 0 0;
        border-radius: 9999px;
        font-size: 14px;
        font-weight: 700;
        line-height: 1;
        color: white;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }
</style>
