<script lang="ts">
    import LL from "../../../../i18n/i18n-svelte";
    import type { BotAvailability } from "../../Bots/BotChatStatus";

    /** The bot's state under its name in the chat header: plain grey words, like a person's; the dot is on its woka. */
    export let state: BotAvailability;
</script>

<span class="min-w-0 truncate text-xs text-white/60" data-testid="botStatusLine" data-state={state}>
    {$LL.chat.botStatus[state]()}
</span>
