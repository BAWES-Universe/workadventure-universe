<script lang="ts">
    import { readable, type Readable } from "svelte/store";
    import LL from "../../../i18n/i18n-svelte";
    import { userIsConnected } from "../../Stores/MenuStore";
    import { botIdFromChatId } from "./BotChatStatus";
    import { botDmAccessCache } from "./BotStatusStore";
    import { IconLock } from "@wa-icons";

    /**
     * Under a reply a bot wrote for this person alone, with others in nearby chat (#1658, #1993): the line that says
     * so, and one tap to carry on in their direct messages with that bot, where the same answer is.
     */

    /** The bot's chat address, as nearby chat knows it. Without one there is nowhere to carry on. */
    export let botChatId: string | undefined;
    export let onContinue: () => void;

    $: botId = botIdFromChatId(botChatId);
    // Only where this person may message the bot at all: signed in, and the bot takes their direct messages
    let mayMessage: Readable<boolean> = readable(false);
    $: mayMessage = botId ? botDmAccessCache.store(botId) : readable(false);
</script>

<div class="flex flex-wrap items-center gap-1.5 px-4 pb-2 text-xs text-white/60" data-testid="botPrivateReplyNote">
    <IconLock font-size="14" />{$LL.chat.botAsk.onlyYouSeeReply()}
    {#if $userIsConnected && botId && $mayMessage}
        <button
            type="button"
            class="ms-2 min-h-[32px] rounded-full bg-white/10 px-3 text-xs font-semibold text-white"
            data-testid="botContinuePrivately"
            on:click={onContinue}>{$LL.chat.botAsk.continuePrivately()}</button
        >
    {/if}
</div>
