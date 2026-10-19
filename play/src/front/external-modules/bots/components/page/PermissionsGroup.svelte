<script lang="ts">
    // Permissions: who may use the bot. Private bot closes it to everyone but the roles and people listed; each row
    // opens that role's or person's No / Default / Yes screen; the line under them is what a person the owner has
    // refused hears. Changes save on their own.
    import { onDestroy } from "svelte";
    import LL from "../../../../../i18n/i18n-svelte";
    import type { BotData } from "../../types";
    import {
        botPermissionsStore,
        loadBotPermissions,
        setPrivateBot,
        setRefusalReply,
    } from "../../stores/BotPermissionsStore";
    import { REFUSAL_REPLY_MAX, ruleName, ruleSummary, type BotPermissions, type BotRule } from "../../accessModel";
    import PageGroup from "./PageGroup.svelte";
    import PageField from "./PageField.svelte";
    import PageSwitch from "./PageSwitch.svelte";
    import { IconChevronRight, IconLock, IconPlus, IconUser } from "@wa-icons";

    export let bot: BotData;
    export let open: boolean;
    export let onToggle: (id: string) => void;
    /** A row was tapped: its screen opens in place of the page */
    export let onOpenRule: (rule: BotRule) => void;
    export let onAdd: () => void;

    $: page = $LL.mapEditor.edit.bots.page;
    $: access = page.access;
    $: state = $botPermissionsStore;
    $: data = state && state.botId === bot.id ? state.data : undefined;
    $: failed = state?.botId === bot.id && state.status === "failed";
    $: saveError = state?.botId === bot.id ? state.saveError : undefined;

    let loadedFor: string | undefined;
    $: if (bot.id !== loadedFor) {
        loadedFor = bot.id;
        void loadBotPermissions(bot.id);
    }

    function briefOf(permissions: BotPermissions | undefined, loadFailed: boolean): string {
        if (loadFailed) return access.briefFailed();
        if (!permissions) return access.briefLoading();
        const count = permissions.rules.length;
        if (permissions.privateBot) {
            return count > 0 ? access.briefPrivateRules({ count }) : access.briefPrivate();
        }
        return count > 0 ? access.briefOpenRules({ count }) : access.briefOpen();
    }
    $: brief = briefOf(data, failed);

    $: privateHint = !data?.privateBot
        ? access.privateOffHint()
        : data.rules.length === 0
        ? access.privateOnEmptyHint()
        : access.privateOnHint();

    function summaryOf(rule: BotRule): string {
        return ruleSummary(rule, {
            blocked: access.blocked(),
            follows: access.follows(),
            action: {
                chat: access.actions.chat(),
                summon: access.actions.summon(),
                manage: access.actions.manage(),
            },
            allowsAndBlocks: (allows, blocks) => access.allowsAndBlocks({ allows, blocks }),
            blocksOnly: (blocks) => access.blocksOnly({ blocks }),
        });
    }

    // The line refused people hear: saved once typing stops, when the box is left, and when the page moves on
    let replyDraft: string | undefined;
    let replyTimeout: ReturnType<typeof setTimeout> | null = null;
    $: replyShown = replyDraft ?? data?.refusalReply ?? "";

    function typeReply(event: Event) {
        replyDraft = (event.currentTarget as HTMLTextAreaElement).value;
        if (replyTimeout) clearTimeout(replyTimeout);
        replyTimeout = setTimeout(saveReply, 800);
    }

    function saveReply() {
        if (replyTimeout) {
            clearTimeout(replyTimeout);
            replyTimeout = null;
        }
        if (replyDraft === undefined || !data) return;
        const botId = bot.id;
        const text = replyDraft;
        replyDraft = undefined;
        if (text.trim() === (data.refusalReply ?? "")) return;
        void setRefusalReply(botId, text);
    }

    onDestroy(saveReply);
</script>

<PageGroup id="access" icon={IconLock} title={access.title()} {brief} {open} {onToggle}>
    {#if failed}
        <p class="bp-m" role="alert">{access.loadFailed()}</p>
        <button
            type="button"
            class="bp-pill"
            data-testid="bot-access-retry"
            on:click={() => loadBotPermissions(bot.id)}
        >
            {access.tryAgain()}
        </button>
    {:else if !data}
        <p class="bp-m">{access.briefLoading()}</p>
    {:else}
        <label class="bp-set" for="bot-private-{bot.id}">
            <span class="bp-tx">
                <span class="bp-t">{access.privateBot()}</span>
                <span class="bp-m">{privateHint}</span>
            </span>
            <PageSwitch
                checked={data.privateBot}
                label={access.privateBot()}
                id="bot-private-{bot.id}"
                testId="bot-private"
                onChange={(on) => setPrivateBot(bot.id, on)}
            />
        </label>

        {#each data.rules as rule (rule.id)}
            <button type="button" class="bp-rule" data-testid="bot-access-rule" on:click={() => onOpenRule(rule)}>
                {#if rule.role}
                    <span class="bp-dot" style="background: {rule.role.color || '#A3A3B5'}" aria-hidden="true" />
                {:else}
                    <span class="bp-ico" aria-hidden="true"><IconUser font-size="20" /></span>
                {/if}
                <span class="bp-tx">
                    <span class="bp-t">{ruleName(rule, access.someone())}</span>
                    <span class="bp-m">{summaryOf(rule)}</span>
                </span>
                <span class="bp-chev" aria-hidden="true"><IconChevronRight font-size="18" /></span>
            </button>
        {/each}

        <button type="button" class="bp-add" data-testid="bot-access-add" on:click={onAdd}>
            <IconPlus font-size="18" />
            {access.add()}
        </button>

        <PageField title={access.reply()} hint={access.replyHint()}>
            <textarea
                class="bp-text"
                rows="2"
                maxlength={REFUSAL_REPLY_MAX}
                value={replyShown}
                placeholder={access.replyPlaceholder()}
                aria-label={access.reply()}
                data-testid="bot-access-reply"
                on:input={typeReply}
                on:blur={saveReply}
            />
        </PageField>
    {/if}
    {#if saveError}
        <p class="bp-error" role="alert" data-testid="bot-access-error">{saveError}</p>
    {/if}
</PageGroup>

<style>
    /* A setting with a switch: the whole row is the tap area, 44 px tall like the bot page's other rows */
    .bp-set {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 44px;
        cursor: pointer;
    }
    .bp-tx {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        text-align: left;
    }
    :global([dir="rtl"]) .bp-tx {
        text-align: right;
    }
    .bp-t {
        font-size: 13px;
        font-weight: 600;
    }
    .bp-m {
        margin: 0;
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
    }
    /* A role or person with its own rules: opens their screen */
    .bp-rule {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        min-height: 52px;
        margin: 0;
        padding: 6px 8px;
        border: 0;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.04);
        font: inherit;
        color: #fff;
        cursor: pointer;
    }
    @media (hover: hover) {
        .bp-rule:hover {
            background: rgba(255, 255, 255, 0.09);
        }
    }
    .bp-rule:focus-visible,
    .bp-add:focus-visible,
    .bp-pill:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .bp-dot {
        flex: none;
        width: 10px;
        height: 10px;
        margin: 0 11px;
        border-radius: 50%;
    }
    /* Plain white icon, like the menu: no tile behind it. */
    .bp-ico {
        display: grid;
        place-items: center;
        flex: none;
        width: 32px;
        height: 32px;
        color: rgba(255, 255, 255, 0.85);
    }
    .bp-chev {
        display: grid;
        place-items: center;
        flex: none;
        color: rgba(244, 242, 250, 0.64);
    }
    :global([dir="rtl"]) .bp-chev {
        transform: scaleX(-1);
    }
    .bp-add,
    .bp-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        align-self: flex-start;
        height: 44px;
        margin: 0;
        padding: 0 18px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
    }
    @media (hover: hover) {
        .bp-add:hover,
        .bp-pill:hover {
            background: rgba(255, 255, 255, 0.14);
        }
    }
    .bp-text {
        box-sizing: border-box;
        width: 100%;
        min-height: 64px;
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
    .bp-error {
        margin: 0;
        font-size: 12.5px;
        color: #ff8a7a;
    }
</style>
