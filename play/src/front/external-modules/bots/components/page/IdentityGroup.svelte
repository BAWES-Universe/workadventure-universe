<script lang="ts">
    // Identity: who the bot is, its name and what it's for.
    import LL from "../../../../../i18n/i18n-svelte";
    import type { BotData } from "../../types";
    import PageGroup from "./PageGroup.svelte";
    import PageField from "./PageField.svelte";
    import { IconId } from "@wa-icons";

    export let bot: BotData;
    export let open: boolean;
    export let onToggle: (id: string) => void;
    /** Typing: the page saves once typing stops. */
    export let onChange: (bot: BotData, typing: boolean) => void;
    export let onRename: (name: string) => void;

    $: page = $LL.mapEditor.edit.bots.page;
    $: brief = bot.description?.trim() || page.identity.none();
</script>

<PageGroup id="identity" icon={IconId} title={page.identity.title()} {brief} {open} {onToggle}>
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
</style>
