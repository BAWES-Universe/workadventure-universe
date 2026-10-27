<script lang="ts">
    import LL from "../../../../i18n/i18n-svelte";

    /**
     * The start of a direct message with a bot (Orbit #491, mock v4 approved 20 Oct 2026): the people who manage the bot
     * see who chats with it and how much, so the person is told before they start. Nearby chat needs no line: everyone
     * around already sees who talks to a bot.
     */
    export let name: string;
</script>

<li class="bot-dm-intro mx-3 mb-3 flex flex-col" data-testid="botDmIntro">
    <b dir="auto">{name}</b>
    <span dir="auto">{$LL.chat.botDmIntro({ name })}</span>
</li>

<style>
    .bot-dm-intro {
        gap: 4px;
        padding: 12px 14px;
        border-radius: 14px;
        font-size: 13px;
        line-height: 18px;
        color: #fff;
        background: rgba(255, 255, 255, 0.04);
        overflow-wrap: anywhere;
    }
    .bot-dm-intro b {
        font-size: 14px;
    }
    .bot-dm-intro span {
        color: rgba(245, 243, 255, 0.66);
    }
</style>
