<script lang="ts">
    import type { BotReplyLimit } from "../../Bots/BotReplyLimit";
    import { replyLimitCardKind, replyLimitTime } from "../../Bots/BotReplyLimit";
    import { askedBotMakers } from "../../Bots/BotReplyLimitAsks";
    import LL, { locale } from "../../../../i18n/i18n-svelte";
    import { sendLogin } from "../../Utils";
    import { botApiService } from "../../../external-modules/bots/services/BotApiService";
    import { openBotPage } from "../../../external-modules/bots/index";
    import { IconBell, IconCheck, IconClock, IconEye, IconKey, IconLogin } from "@wa-icons";

    /**
     * The fixed card a bot shows one person who reached a reply limit (#1159, mock approved 26 Oct 2026): when it
     * answers again in their own clock, and the one way out that fits them. Only they see it; no AI wrote it.
     */
    export let replyLimit: BotReplyLimit;

    $: kind = replyLimitCardKind(replyLimit);
    $: name = replyLimit.botName;
    $: time = replyLimitTime(replyLimit.resetsAt, $locale);
    $: askKey = `${replyLimit.botId}|${replyLimit.resetsAt}`;
    $: asked = $askedBotMakers.has(askKey);

    let asking = false;
    let askFailed = false;

    async function askMaker() {
        if (asking || asked) return;
        asking = true;
        askFailed = false;
        const key = askKey;
        await botApiService.askBotMaker(replyLimit.botId).then((done) => {
            asking = false;
            if (done) askedBotMakers.add(key);
            else askFailed = true;
        });
    }
</script>

<div class="reply-limit mx-3 mb-3 flex flex-col" data-testid="botReplyLimitCard">
    <div class="flex items-start gap-2.5">
        <IconClock class="reply-limit-icon" />
        <div class="flex min-w-0 flex-col gap-0.5">
            <b class="reply-limit-title" dir="auto">
                {#if kind === "member" || kind === "maker"}
                    {$LL.chat.replyLimit.titleUniverseAi()}
                {:else if kind === "guest"}
                    {$LL.chat.replyLimit.titleGuest()}
                {:else}
                    {$LL.chat.replyLimit.titleBot({ name })}
                {/if}
            </b>
            <p class="reply-limit-line m-0" dir="auto">
                {#if kind === "member"}
                    {$LL.chat.replyLimit.lineMember({ name, time })}
                {:else if kind === "maker"}
                    {$LL.chat.replyLimit.lineMaker({ name, time })}
                {:else if kind === "guest"}
                    {$LL.chat.replyLimit.lineGuest({ time })}
                {:else}
                    {$LL.chat.replyLimit.lineBot({ name, time })}
                {/if}
            </p>
        </div>
    </div>
    {#if kind === "member"}
        <button
            class="reply-limit-cta"
            class:done={asked}
            disabled={asking || asked}
            on:click={askMaker}
            data-testid="botReplyLimitAsk"
        >
            {#if asked}
                <IconCheck />{$LL.chat.replyLimit.asked()}
            {:else}
                <IconBell />{$LL.chat.replyLimit.askMaker({ name })}
            {/if}
        </button>
        {#if askFailed}
            <span class="reply-limit-hint" role="status">{$LL.chat.replyLimit.askFailed()}</span>
        {/if}
    {:else if kind === "guest"}
        <button class="reply-limit-cta" on:click={sendLogin} data-testid="botReplyLimitSignIn">
            <IconLogin />{$LL.chat.replyLimit.signIn()}
        </button>
    {:else if kind === "maker"}
        <button class="reply-limit-cta" on:click={() => openBotPage(replyLimit.botId)} data-testid="botReplyLimitKey">
            <IconKey />{$LL.chat.replyLimit.useMyKey()}
        </button>
    {/if}
    <span class="reply-limit-who"><IconEye />{$LL.chat.replyLimit.onlyYou()}</span>
</div>

<style>
    /* The approved limit card: the chat's ink, a soft violet ring, one gradient button. */
    .reply-limit {
        gap: 8px;
        padding: 12px;
        border-radius: 16px;
        color: #fff;
        background: linear-gradient(160deg, rgba(31, 28, 47, 0.96), rgba(20, 18, 30, 0.97));
        box-shadow: 0 0 0 1px rgba(167, 139, 250, 0.22), 0 0 24px -12px rgba(134, 41, 252, 0.55);
        overflow-wrap: anywhere;
    }
    .reply-limit :global(.reply-limit-icon) {
        width: 20px;
        height: 20px;
        flex: none;
        margin-top: 1px;
    }
    .reply-limit-title {
        font-size: 14px;
        line-height: 19px;
    }
    .reply-limit-line {
        font-size: 13px;
        line-height: 18px;
        color: rgba(255, 255, 255, 0.75);
    }
    .reply-limit-cta {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        min-height: 44px;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        font-size: 14px;
        font-weight: 700;
        color: #fff;
        background: linear-gradient(90deg, #8629fc, #4156f6);
        box-shadow: 0 8px 24px -10px rgba(134, 41, 252, 0.7);
        cursor: pointer;
    }
    .reply-limit-cta :global(svg) {
        width: 18px;
        height: 18px;
    }
    .reply-limit-cta:disabled {
        cursor: default;
    }
    .reply-limit-cta.done {
        background: rgba(167, 139, 250, 0.18);
        box-shadow: none;
        color: rgba(255, 255, 255, 0.85);
    }
    .reply-limit-hint {
        font-size: 12px;
        color: #ffd9cf;
    }
    .reply-limit-who {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        color: rgba(255, 255, 255, 0.5);
    }
    .reply-limit-who :global(svg) {
        width: 1.2em;
        height: 1.2em;
    }
</style>
