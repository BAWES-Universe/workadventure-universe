<script lang="ts">
    import LL from "../../../../i18n/i18n-svelte";
    import type { BotAvailability } from "../../Bots/BotChatStatus";
    import { botStatusColour } from "../../Bots/BotChatStatus";

    /** The bot's state under its name in the chat header, with the same dot people get. */
    export let state: BotAvailability;
</script>

<span
    class="inline-flex items-center gap-[5px] text-[11px] leading-[14px]"
    style="color:{botStatusColour(state)}"
    data-testid="botStatusLine"
    data-state={state}
>
    <span class="h-1.5 w-1.5 shrink-0 rounded-full" style="background:{botStatusColour(state)}" />
    {$LL.chat.botStatus[state]()}
</span>
