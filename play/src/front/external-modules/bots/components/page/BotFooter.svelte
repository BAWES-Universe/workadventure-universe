<script lang="ts">
    // The foot of the bot page: who made the bot and when, and Delete with its question in place.
    import LL from "../../../../../i18n/i18n-svelte";
    import type { BotData, BrickDeleteAsk } from "../../types";
    import PageButton from "./PageButton.svelte";
    import { IconTrash } from "@wa-icons";

    export let bot: BotData;
    export let onDelete: () => void;
    /**
     * A Brick's own page (game #1996): Delete says what goes and what stays, offers its computer's files first, and
     * says until when Undo on the Bricks page gives it back. Undefined for a bot in a room, which asks as before.
     */
    export let brick: BrickDeleteAsk | undefined = undefined;
    export let deleting = false;

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
    {#if askingDelete && brick}
        <div class="bp-ask" role="alert" data-testid="brickDeleteAsk">
            <p class="bp-ask-t">{$LL.chat.brick.deleteAsk({ name: bot.name || "" })}</p>
            <p>{$LL.chat.brick.deleteWhat()}</p>
            {#if brick.files}
                <div class="bp-ask-files" data-testid="brickDeleteFiles">
                    <span class="bp-ask-files-tx">
                        <b>{$LL.chat.brick.itsFiles()}</b>
                        <small>{$LL.chat.brick.itsFilesSize({ size: brick.files.size })}</small>
                    </span>
                    <PageButton tall testId="brickDeleteDownload" on:click={brick.files.download}
                        >{$LL.chat.brick.download()}</PageButton
                    >
                </div>
            {/if}
            <div class="bp-ask-actions">
                <PageButton tall disabled={deleting} testId="brickDeleteKeep" on:click={() => (askingDelete = false)}
                    >{page.about.keep()}</PageButton
                >
                <PageButton tall danger disabled={deleting} testId="brickDeleteConfirm" on:click={onDelete}
                    >{$LL.chat.brick.deleteBrick()}</PageButton
                >
            </div>
            <p class="bp-ask-undo" data-testid="brickDeleteUndoLine">{brick.undoLine}</p>
        </div>
    {:else if askingDelete}
        <div class="bp-ask" role="alert">
            <p>{page.about.deleteAsk({ name: bot.name || "" })}</p>
            <div class="bp-ask-actions">
                <PageButton on:click={() => (askingDelete = false)}>{page.about.keep()}</PageButton>
                <PageButton danger testId="bot-delete-confirm" on:click={onDelete}>{page.about.delete()}</PageButton>
            </div>
        </div>
    {:else}
        <div class="bp-delete">
            <PageButton danger testId={brick ? "brickDelete" : "bot-delete"} on:click={() => (askingDelete = true)}
                ><IconTrash font-size="16" />{brick ? $LL.chat.brick.deleteBrick() : page.about.delete()}</PageButton
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
    .bp-ask .bp-ask-t {
        font-weight: 700;
    }
    /* Its computer's files, offered before they go (mock d-2) */
    .bp-ask-files {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 10px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.05);
    }
    .bp-ask-files-tx {
        display: flex;
        flex-direction: column;
        min-width: 0;
        font-size: 13px;
    }
    .bp-ask-files-tx small {
        font-size: 12px;
        color: rgba(244, 242, 250, 0.64);
    }
    .bp-ask .bp-ask-undo {
        font-size: 12px;
        color: rgba(244, 242, 250, 0.64);
    }
    .bp-ask-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }
</style>
