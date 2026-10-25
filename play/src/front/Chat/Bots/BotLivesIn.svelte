<script lang="ts">
    import { LL } from "../../../i18n/i18n-svelte";
    import PlaceKindIcon from "../../Components/Icons/PlaceKindIcon.svelte";
    import type { DirectPartner } from "../Components/Room/DirectChat/DirectPartnerStore";
    import type { BotRoomLink } from "./BotRoomLink";
    import { visitBotRoom } from "./visitBotRoom";
    import { IconLogin } from "@wa-icons";

    /** Where a bot lives, on its profile in a direct message, with a Visit button unless you're already in that room. */
    export let link: BotRoomLink;
    export let partner: DirectPartner;
    export let name: string;
    export let currentRoomUrl: string | undefined;

    $: inRoom = currentRoomUrl === link.url;
</script>

<div class="bot-lives-in" data-testid="botLivesIn">
    <span class="bot-lives-in-label">{$LL.chat.botStatus.livesIn()}</span>
    <div class="bot-lives-in-room">
        <PlaceKindIcon kind="room" size={18} />
        <span class="bot-lives-in-name">{link.room}</span>
    </div>
    {#if link.world || link.universe}
        <div class="bot-lives-in-where">
            {#if link.world}
                <span class="bot-lives-in-place"><PlaceKindIcon kind="world" size={13} />{link.world}</span>
            {/if}
            {#if link.universe}
                <span class="bot-lives-in-place"><PlaceKindIcon kind="universe" size={13} />{link.universe}</span>
            {/if}
        </div>
    {/if}
    {#if inRoom}
        <span class="bot-lives-in-here" data-testid="botLivesInHere">{$LL.chat.botStatus.inThisRoom()}</span>
    {:else}
        <button
            type="button"
            class="u-cta bot-lives-in-visit"
            aria-label={$LL.chat.botStatus.visitAria({ name, room: link.room })}
            on:click={() => visitBotRoom(link, partner, currentRoomUrl)}
            data-testid="botLivesInVisit"
        >
            <IconLogin font-size={16} />
            {$LL.chat.botStatus.visit()}
        </button>
    {/if}
</div>

<style lang="scss">
    /* A group like the profile's other rows; the button is the chat's pill at a full 44px tap height. */
    .bot-lives-in {
        display: grid;
        gap: 6px;
        padding: 12px 14px 14px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: white;
    }
    .bot-lives-in-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.5);
    }
    .bot-lives-in-room {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
    }
    .bot-lives-in-name {
        min-width: 0;
        font-size: 16px;
        font-weight: 700;
        line-height: 1.3;
        overflow-wrap: anywhere;
    }
    .bot-lives-in-where {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 12px;
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(255, 255, 255, 0.65);
    }
    .bot-lives-in-place {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-width: 0;
        overflow-wrap: anywhere;
    }
    .bot-lives-in-here {
        margin-top: 4px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.65);
    }
    .bot-lives-in-visit {
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
