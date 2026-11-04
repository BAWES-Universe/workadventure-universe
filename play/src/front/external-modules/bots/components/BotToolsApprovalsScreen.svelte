<script lang="ts">
    // Asking for approvals (game #1655, mock approved 3 Nov): before a bot changes, deletes or sends something with its
    // tools it shows the person a card and waits for their tap. These set how long it waits, how many things it may make
    // in one request before asking, and how often it asks which way to go. BotEditor puts the title and back circle up.
    import LL from "../../../../i18n/i18n-svelte";
    import type { BotData } from "../types";
    import { botToolsStore, loadBotToolSettings, saveBotToolSettings } from "../stores/BotToolsStore";
    import {
        ASK_BEFORE_MAKING_CHOICES,
        ASK_WHICH_WAY_CHOICES,
        CARD_WAIT_CHOICES,
        type BotToolSettings,
    } from "../toolsModel";
    import PageChips from "./page/PageChips.svelte";
    import PageField from "./page/PageField.svelte";

    export let bot: BotData;

    $: text = $LL.mapEditor.edit.bots.page.tools.approvals;
    $: held = $botToolsStore && $botToolsStore.botId === bot.id ? $botToolsStore : undefined;
    $: settings = held?.settings;

    // Read when the page opens: another person may have changed them since the bot page loaded
    let loadFailed = false;
    let loadedFor: string | undefined;
    function read(botId: string) {
        loadFailed = false;
        loadBotToolSettings(botId).catch((error) => {
            console.error("[BotToolsApprovalsScreen] Failed to load the settings:", error);
            loadFailed = true;
        });
    }
    $: if (bot.id !== loadedFor) {
        loadedFor = bot.id;
        read(bot.id);
    }

    let problem: string | null = null;
    async function save(change: Partial<BotToolSettings>) {
        problem = null;
        try {
            await saveBotToolSettings(bot.id, change);
        } catch (error) {
            problem =
                error instanceof Error && error.message
                    ? error.message
                    : $LL.mapEditor.edit.bots.page.tools.saveFailed();
        }
    }

    $: waitOptions = CARD_WAIT_CHOICES.map((minutes) => ({ value: minutes, label: text.waitChoice({ minutes }) }));
    $: makingOptions = ASK_BEFORE_MAKING_CHOICES.map((count) => ({
        value: count,
        label: count === null ? text.noLimit() : String(count),
    }));
    $: wayOptions = ASK_WHICH_WAY_CHOICES.map((way) => ({ value: way, label: text[way]() }));
</script>

<div class="ta-screen" data-testid="bot-tools-approvals">
    <p class="ta-line">{text.intro()}</p>
    {#if loadFailed && !settings}
        <p class="ta-fail" role="alert">{text.loadFailed()}</p>
    {:else if settings}
        <PageField title={text.waitTitle()} hint={text.waitHint()}>
            <PageChips
                label={text.waitTitle()}
                options={waitOptions}
                value={settings.cardWaitMinutes}
                onPick={(minutes) => save({ cardWaitMinutes: minutes })}
            />
        </PageField>
        <PageField title={text.makingTitle()} hint={text.makingHint()}>
            <PageChips
                label={text.makingTitle()}
                options={makingOptions}
                value={settings.askBeforeMaking}
                onPick={(count) => save({ askBeforeMaking: count })}
            />
        </PageField>
        <PageField title={text.wayTitle()} hint={text.wayHint()}>
            <PageChips
                label={text.wayTitle()}
                options={wayOptions}
                value={settings.askWhichWay}
                onPick={(way) => save({ askWhichWay: way })}
            />
        </PageField>
    {/if}
    {#if problem}<p class="ta-fail" role="alert">{problem}</p>{/if}
</div>

<style>
    .ta-screen {
        display: flex;
        flex-direction: column;
        gap: 14px;
        color: #fff;
    }
    .ta-line {
        margin: 0;
        font-size: 13px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.72);
    }
    .ta-fail {
        margin: 0;
        font-size: 12.5px;
        color: #ff8a7a;
    }
</style>
