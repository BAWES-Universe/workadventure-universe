<script lang="ts">
    import { botStatusColour } from "../Bots/BotChatStatus";
    import BotStatusLine from "../Components/Bots/BotStatusLine.svelte";
    import StatusDot from "../Components/Status/StatusDot.svelte";
    import TopRowAvatar from "../Components/TopRow/TopRowAvatar.svelte";
    import { brickPicture } from "./BrickLookPicture";
    import type { BrickCard } from "./Brick";

    /**
     * The header of the chat with the Brick for guests (#1997), laid out like a chat with any bot: its picture with the
     * dot, its name, and "Online" under it. It has no profile to open, so the title is not a button.
     */
    export let brick: BrickCard;
</script>

<div
    class="m-0 flex min-h-11 min-w-0 max-w-full items-center gap-2.5 py-1 pe-2 ps-1 text-start text-white"
    data-testid="guestBrickTitle"
>
    <span class="relative flex shrink-0" aria-hidden="true">
        <TopRowAvatar pictureStore={brickPicture(brick.characterTextureId)} name={brick.name} ring={false} />
        <StatusDot color={botStatusColour("online")} size="sm" />
    </span>
    <span class="flex min-w-0 flex-col">
        <span class="flex min-w-0 items-center gap-1.5">
            <span class="truncate text-md font-bold leading-5" data-testid="roomName">{brick.name}</span>
        </span>
        <BotStatusLine state="online" />
    </span>
</div>
