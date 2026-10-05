<script lang="ts">
    // The foot of the bot page: who made the bot and when, and Delete with its question in place.
    import LL from "../../../../../i18n/i18n-svelte";
    import type { BotData } from "../../types";
    import PageButton from "./PageButton.svelte";
    import { IconTrash } from "@wa-icons";

    export let bot: BotData;
    export let onDelete: () => void;

    let askingDelete = false;
    let lastBotId = bot.id;
    $: if (bot.id !== lastBotId) {
        lastBotId = bot.id;
        askingDelete = false;
    }

    function shortDate(value?: string): string {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
    }

    $: page = $LL.mapEditor.edit.bots.page;
    $: madeBy = bot.createdBy?.name ?? undefined;
    $: made = bot.createdAt
        ? madeBy
            ? page.about.createdBy({ name: madeBy, date: shortDate(bot.createdAt) })
            : page.about.created({ date: shortDate(bot.createdAt) })
        : "";
    $: updatedBy = bot.updatedBy?.name && bot.updatedBy.id !== bot.createdBy?.id ? ` · ${bot.updatedBy.name}` : "";
    $: changed = bot.updatedAt ? `${page.about.updated({ date: shortDate(bot.updatedAt) })}${updatedBy}` : "";
    $: meta = [made, changed].filter(Boolean).join(" · ");
</script>

<footer class="bp-foot">
    {#if meta}<p class="bp-meta">{meta}</p>{/if}
    {#if askingDelete}
        <div class="bp-ask" role="alert">
            <p>{page.about.deleteAsk({ name: bot.name || "" })}</p>
            <div class="bp-ask-actions">
                <PageButton on:click={() => (askingDelete = false)}>{page.about.keep()}</PageButton>
                <PageButton danger testId="bot-delete-confirm" on:click={onDelete}>{page.about.delete()}</PageButton>
            </div>
        </div>
    {:else}
        <div class="bp-delete">
            <PageButton danger testId="bot-delete" on:click={() => (askingDelete = true)}
                ><IconTrash font-size="16" />{page.about.delete()}</PageButton
            >
        </div>
    {/if}
</footer>

<style>
    .bp-foot {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 4px;
        padding: 12px 4px 4px;
        border-top: 1px solid rgba(255, 255, 255, 0.07);
    }
    .bp-meta {
        margin: 0;
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.56);
    }
    .bp-delete {
        display: flex;
    }
    .bp-ask {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(255, 112, 92, 0.1);
        box-shadow: inset 0 0 0 1px rgba(255, 112, 92, 0.3);
    }
    .bp-ask p {
        margin: 0;
        font-size: 13px;
        line-height: 1.35;
    }
    .bp-ask-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }
</style>
