<script lang="ts">
    import type { BotStatusNote } from "../../Bots/BotChatStatus";
    import { botStatusColour } from "../../Bots/BotChatStatus";

    /** A bot's plain note (resting, gone...): the game speaking, so a card rather than the bot's own bubble. */
    export let note: BotStatusNote;
</script>

<div
    class="bot-note mx-3 mb-3 flex flex-col gap-[3px] rounded-[14px] px-[11px] pb-[9px] pt-2"
    data-testid="botStatusNote"
>
    <span class="bot-note-head inline-flex items-center gap-1.5" dir="auto">
        <span class="h-1.5 w-1.5 shrink-0 rounded-full" style="background:{botStatusColour(note.state)}" />
        {note.title}
    </span>
    <span dir="auto">{note.text}</span>
</div>

<style>
    .bot-note {
        font-size: 12.5px;
        line-height: 17px;
        color: rgba(255, 255, 255, 0.88);
        background: linear-gradient(
            145deg,
            rgba(134, 41, 252, 0.14),
            rgba(65, 86, 246, 0.08) 55%,
            rgba(233, 199, 76, 0.06)
        );
        border: 1px solid rgba(167, 139, 250, 0.22);
        overflow-wrap: anywhere;
    }
    .bot-note-head {
        font-size: 10.5px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #c4b5fd;
    }
</style>
