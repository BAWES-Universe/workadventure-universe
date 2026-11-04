<script lang="ts">
    // Asking for approvals (game #1655, mock approved 3 Nov): before a bot changes, deletes or sends something with its
    // tools it shows the person a card and waits for their tap. These set how long it waits, how many things it may make
    // in one request before asking, and how often it asks which way to go. BotEditor puts the title and back circle up.
    import LL from "../../../../i18n/i18n-svelte";
    import type { BotData } from "../types";
    import {
        botToolsStore,
        endAllowedMore,
        loadAllowedMore,
        loadBotToolSettings,
        saveBotToolSettings,
    } from "../stores/BotToolsStore";
    import {
        ALLOW_MORE_IDLE_CHOICES,
        ALLOW_MORE_MAX_CHOICES,
        ASK_BEFORE_MAKING_CHOICES,
        ASK_WHICH_WAY_CHOICES,
        CARD_WAIT_CHOICES,
        type AllowedMore,
        type BotToolSettings,
    } from "../toolsModel";
    import PageButton from "./page/PageButton.svelte";
    import PageChips from "./page/PageChips.svelte";
    import PageField from "./page/PageField.svelte";

    export let bot: BotData;

    $: text = $LL.mapEditor.edit.bots.page.tools.approvals;
    $: held = $botToolsStore && $botToolsStore.botId === bot.id ? $botToolsStore : undefined;
    $: settings = held?.settings;

    // Read when the page opens: another person may have changed them since the bot page loaded
    let loadFailed = false;
    let loadedFor: string | undefined;
    // Who is allowed more right now: undefined until read, and left out of the page if Orbit can't say
    let allowed: AllowedMore[] | undefined;
    let ending = false;
    function read(botId: string) {
        loadFailed = false;
        allowed = undefined;
        loadBotToolSettings(botId).catch((error) => {
            console.error("[BotToolsApprovalsScreen] Failed to load the settings:", error);
            loadFailed = true;
        });
        loadAllowedMore(botId)
            .then((rows) => {
                if (loadedFor === botId) allowed = rows;
            })
            .catch((error) => console.error("[BotToolsApprovalsScreen] Failed to load who is allowed more:", error));
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

    async function endAll() {
        const botId = bot.id;
        problem = null;
        ending = true;
        try {
            await endAllowedMore(botId);
            if (loadedFor === botId) allowed = [];
        } catch (error) {
            problem =
                error instanceof Error && error.message
                    ? error.message
                    : $LL.mapEditor.edit.bots.page.tools.saveFailed();
        } finally {
            ending = false;
        }
    }

    function allowedLine(row: AllowedMore): string {
        const who = row.name ?? (row.isGuest ? text.guest() : text.someone());
        return row.fixed
            ? text.allowedRow({ who, tool: row.tool, fixed: row.fixed })
            : text.allowedRowPlain({ who, tool: row.tool });
    }

    $: idleOptions = withCurrent(ALLOW_MORE_IDLE_CHOICES, settings?.allowMoreIdleMinutes);
    $: maxOptions = withCurrent(ALLOW_MORE_MAX_CHOICES, settings?.allowMoreMaxMinutes);
    // A saved time that is none of the choices still shows, so the page never hides what the bot is set to
    function withCurrent(choices: readonly number[], current: number | undefined) {
        const values =
            current === undefined || choices.includes(current) ? choices : [...choices, current].sort((a, b) => a - b);
        return values.map((minutes) => ({ value: minutes, label: timeLabel(minutes) }));
    }
    function timeLabel(minutes: number): string {
        return minutes >= 60 && minutes % 60 === 0
            ? text.hoursChoice({ hours: minutes / 60 })
            : text.waitChoice({ minutes });
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
        <div class="ta-more">
            <PageField title={text.allowTitle()} hint={text.allowHint()}>
                <PageField title={text.idleTitle()} hint={text.idleHint()}>
                    <PageChips
                        label={text.idleTitle()}
                        options={idleOptions}
                        value={settings.allowMoreIdleMinutes}
                        onPick={(minutes) => save({ allowMoreIdleMinutes: minutes })}
                    />
                </PageField>
                <PageField title={text.maxTitle()} hint={text.maxHint()}>
                    <PageChips
                        label={text.maxTitle()}
                        options={maxOptions}
                        value={settings.allowMoreMaxMinutes}
                        onPick={(minutes) => save({ allowMoreMaxMinutes: minutes })}
                    />
                </PageField>
            </PageField>
            {#if allowed}
                <div class="ta-now" data-testid="bot-tools-allowed-more">
                    <div class="ta-now-text">
                        <div class="ta-now-title">{text.nowTitle()}</div>
                        <div class="ta-now-list">
                            {#if allowed.length === 0}
                                {text.nowNobody()}
                            {:else}
                                {#each allowed as row (row.id)}
                                    <div data-testid="bot-tools-allowed-row">{allowedLine(row)}</div>
                                {/each}
                            {/if}
                        </div>
                    </div>
                    {#if allowed.length > 0}
                        <PageButton danger tall disabled={ending} testId="bot-tools-end-all" on:click={endAll}
                            >{text.endAll()}</PageButton
                        >
                    {/if}
                </div>
            {/if}
        </div>
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
    .ta-more {
        display: flex;
        flex-direction: column;
        gap: 14px;
    }
    .ta-now {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }
    .ta-now-text {
        min-width: 0;
    }
    .ta-now-title {
        font-size: 13px;
        font-weight: 600;
    }
    .ta-now-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
        overflow-wrap: anywhere;
    }
    .ta-fail {
        margin: 0;
        font-size: 12.5px;
        color: #ff8a7a;
    }
</style>
