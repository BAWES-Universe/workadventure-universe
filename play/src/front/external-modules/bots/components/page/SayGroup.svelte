<script lang="ts">
    // Chat instructions: what the bot is told before every chat.
    import LL from "../../../../../i18n/i18n-svelte";
    import type { BotData } from "../../types";
    import PageGroup from "./PageGroup.svelte";
    import { IconMessage } from "@wa-icons";

    export let bot: BotData;
    export let open: boolean;
    export let onToggle: (id: string) => void;
    /** Typing: the page saves once typing stops. */
    export let onChange: (bot: BotData, typing: boolean) => void;

    $: page = $LL.mapEditor.edit.bots.page;
    $: text = bot.chatInstructions?.trim() ?? "";
    $: brief = text ? `"${text.split("\n")[0]}"` : page.say.none();

    function type(event: Event) {
        onChange({ ...bot, chatInstructions: (event.currentTarget as HTMLTextAreaElement).value }, true);
    }
</script>

<PageGroup id="say" icon={IconMessage} title={page.say.title()} {brief} {open} {onToggle}>
    <textarea
        class="bp-text"
        rows="8"
        value={bot.chatInstructions ?? ""}
        placeholder={$LL.actionbar.botEditorModule.chatInstructionsPlaceholder()}
        aria-label={page.say.title()}
        data-testid="bot-chat-instructions"
        on:input={type}
    />
</PageGroup>

<style>
    .bp-text {
        width: 100%;
        min-height: 140px;
        margin: 0;
        padding: 10px 12px;
        border: 0;
        border-radius: 12px;
        background: rgba(0, 0, 0, 0.25);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        font: inherit;
        font-size: 14px;
        line-height: 1.45;
        color: #fff;
        resize: vertical;
        outline: none;
    }
    .bp-text::placeholder {
        color: rgba(244, 242, 250, 0.42);
    }
    .bp-text:focus-visible {
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.6);
    }
</style>
