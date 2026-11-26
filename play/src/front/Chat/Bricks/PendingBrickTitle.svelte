<script lang="ts">
    import { botStatusColour } from "../Bots/BotChatStatus";
    import { botStatusCache } from "../Bots/BotStatusStore";
    import BotStatusLine from "../Components/Bots/BotStatusLine.svelte";
    import StatusDot from "../Components/Status/StatusDot.svelte";
    import TopRowAvatar from "../Components/TopRow/TopRowAvatar.svelte";
    import { brickPicture } from "./BrickLookPicture";
    import type { BrickCard } from "./Brick";

    /**
     * The header of a Brick's chat while the chat itself is still being made: the Brick's picture with the dot, its name,
     * and its state under it, laid out as the header of any chat with a Brick. Its profile has nothing to show yet, so the
     * title is not a button.
     */
    export let brick: BrickCard;

    $: state = botStatusCache.store(brick.id);
</script>

<div
    class="m-0 flex min-h-11 min-w-0 max-w-full items-center gap-2.5 py-1 pe-2 ps-1 text-start text-white"
    data-testid="pendingBrickTitle"
>
    <span class="relative flex shrink-0" aria-hidden="true">
        <TopRowAvatar pictureStore={brickPicture(brick.characterTextureId)} name={brick.name} ring={false} />
        {#if $state}
            <StatusDot color={botStatusColour($state)} size="sm" />
        {/if}
    </span>
    <span class="flex min-w-0 flex-col">
        <span class="flex min-w-0 items-center gap-1.5">
            <span class="truncate text-md font-bold leading-5" data-testid="roomName">{brick.name}</span>
        </span>
        {#if $state}
            <BotStatusLine state={$state} />
        {/if}
    </span>
</div>
