<script lang="ts">
    // About: the bot's name, looks and description, who made it and when, and Delete.
    import LL from "../../../../../i18n/i18n-svelte";
    import type { BotData } from "../../types";
    import PageGroup from "./PageGroup.svelte";
    import PageRow from "./PageRow.svelte";
    import PageField from "./PageField.svelte";
    import PageButton from "./PageButton.svelte";
    import { IconInfoCircle, IconTrash } from "@wa-icons";

    export let bot: BotData;
    export let open: boolean;
    export let onToggle: (id: string) => void;
    /** Typing: the page saves once typing stops. */
    export let onChange: (bot: BotData, typing: boolean) => void;
    export let onRename: (name: string) => void;
    export let onChangeLooks: () => void;
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

    function longDate(value?: string): string {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        return date.toLocaleString(undefined, {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
        });
    }

    $: page = $LL.mapEditor.edit.bots.page;
    $: madeBy = bot.createdBy?.name ?? undefined;
    $: brief = madeBy
        ? page.about.createdBy({ name: madeBy, date: shortDate(bot.createdAt) })
        : bot.createdAt
        ? page.about.created({ date: shortDate(bot.createdAt) })
        : bot.description || page.about.delete();
    $: updatedBy = bot.updatedBy?.name && bot.updatedBy.id !== bot.createdBy?.id ? ` · ${bot.updatedBy.name}` : "";
</script>

<PageGroup id="about" icon={IconInfoCircle} title={page.about.title()} {brief} {open} {onToggle}>
    <PageField title={page.about.name()}>
        <input
            class="bp-input"
            type="text"
            value={bot.name ?? ""}
            maxlength="64"
            aria-label={page.about.name()}
            data-testid="bot-name"
            on:input={(e) => onRename(e.currentTarget.value)}
        />
    </PageField>
    <PageRow title={page.about.looks()} hint={page.changeLooks()}>
        <PageButton testId="bot-change-looks" on:click={onChangeLooks}>{page.about.change()}</PageButton>
    </PageRow>
    <PageField title={page.about.description()}>
        <textarea
            class="bp-input bp-area"
            rows="3"
            value={bot.description ?? ""}
            placeholder={page.about.descriptionPlaceholder()}
            aria-label={page.about.description()}
            data-testid="bot-description"
            on:input={(e) => onChange({ ...bot, description: e.currentTarget.value }, true)}
        />
    </PageField>
    {#if bot.createdAt || bot.updatedAt}
        <div class="bp-meta">
            {#if bot.createdAt}
                <div>
                    {madeBy
                        ? page.about.createdBy({ name: madeBy, date: longDate(bot.createdAt) })
                        : page.about.created({ date: longDate(bot.createdAt) })}
                </div>
            {/if}
            {#if bot.updatedAt}
                <div>{page.about.updated({ date: longDate(bot.updatedAt) })}{updatedBy}</div>
            {/if}
        </div>
    {/if}
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
</PageGroup>

<style>
    .bp-input {
        width: 100%;
        height: 38px;
        margin: 0;
        padding: 0 12px;
        border: 0;
        border-radius: 12px;
        background: rgba(0, 0, 0, 0.25);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        font: inherit;
        font-size: 14px;
        color: #fff;
        outline: none;
    }
    .bp-area {
        height: auto;
        min-height: 72px;
        padding: 9px 12px;
        line-height: 1.45;
        resize: vertical;
    }
    .bp-input::placeholder {
        color: rgba(244, 242, 250, 0.42);
    }
    .bp-input:focus-visible {
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.6);
    }
    .bp-meta {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 0 4px;
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
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
