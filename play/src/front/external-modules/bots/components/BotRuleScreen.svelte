<script lang="ts">
    // One role's or person's rules for this bot: for each thing people do with it, No / Default / Yes. A choice saves
    // on its own. Default says what it comes to, so nobody has to guess what the role gives.
    import LL from "../../../../i18n/i18n-svelte";
    import { botPermissionsStore, removeRule, setRuleValue } from "../stores/BotPermissionsStore";
    import { SHOWN_ACTIONS, defaultFor, ruleName, type RuleAction, type RuleValue } from "../accessModel";
    import PageSegment from "./page/PageSegment.svelte";
    import { IconUser } from "@wa-icons";

    export let botId: string;
    export let ruleId: string;
    /** The rule is gone (removed here, or by someone else): the page it came from is shown again */
    export let onClose: () => void;

    $: access = $LL.mapEditor.edit.bots.page.access;
    $: state = $botPermissionsStore;
    $: data = state && state.botId === botId ? state.data : undefined;
    $: rule = data?.rules.find((r) => r.id === ruleId);
    $: saveError = state?.botId === botId ? state.saveError : undefined;
    $: name = rule ? ruleName(rule, access.someone()) : "";
    // The page held an answer when it opened this screen, so a missing rule means it was removed
    $: if (data && !rule) onClose();

    $: options = [
        { value: "no" as RuleValue, label: access.valueNo(), testId: "bot-rule-no" },
        { value: "default" as RuleValue, label: access.valueDefault(), testId: "bot-rule-default" },
        { value: "yes" as RuleValue, label: access.valueYes(), testId: "bot-rule-yes" },
    ];

    function titleOf(action: RuleAction): string {
        return action === "chat"
            ? access.actions.chat()
            : action === "dm"
            ? access.actions.dm()
            : action === "summon"
            ? access.actions.summon()
            : action === "change"
            ? "Have it change things"
            : action === "send"
            ? "Have it delete or send"
            : access.actions.manage();
    }

    function hintOf(action: RuleAction): string {
        return action === "chat"
            ? access.actions.chatHint()
            : action === "dm"
            ? access.actions.dmHint()
            : action === "summon"
            ? access.actions.summonHint()
            : action === "change"
            ? "Create or edit things with its tools, like a Linear issue or a post"
            : action === "send"
            ? "Delete things, or send email and messages outside Universe, with its tools"
            : access.actions.manageHint();
    }

    /** What Default comes to for this row, under its choices */
    function defaultLine(action: RuleAction): string {
        if (!rule || !data) return "";
        const found = defaultFor(action, rule, data.roles);
        if (!found) return access.defaultPerson();
        return found.allowed && found.from ? access.defaultYes({ from: found.from }) : access.defaultNo();
    }

    let removing = false;
    async function remove() {
        if (!rule || removing) return;
        removing = true;
        await removeRule(botId, rule).finally(() => {
            removing = false;
        });
    }
</script>

{#if rule}
    <div class="br" data-testid="bot-rule-screen">
        <div class="br-hd">
            {#if rule.role}
                <span class="br-dot" style="background: {rule.role.color || '#A3A3B5'}" aria-hidden="true" />
            {:else}
                <span class="br-ico" aria-hidden="true"><IconUser font-size="20" /></span>
            {/if}
            <span class="br-name">{access.ruleFor({ name })}</span>
        </div>

        {#each SHOWN_ACTIONS as action (action)}
            <div class="br-field">
                <span class="br-t">{titleOf(action)}</span>
                <span class="br-m">{hintOf(action)}</span>
                <PageSegment
                    label={titleOf(action)}
                    {options}
                    value={rule[action]}
                    onPick={(value) => setRuleValue(botId, rule, action, value)}
                />
                <span class="br-m" data-testid="bot-rule-default-line">{defaultLine(action)}</span>
            </div>
        {/each}

        {#if saveError}
            <p class="br-error" role="alert" data-testid="bot-access-error">{saveError}</p>
        {/if}

        <div class="br-remove">
            <button type="button" class="br-btn" disabled={removing} data-testid="bot-rule-remove" on:click={remove}>
                {access.remove({ name })}
            </button>
            <span class="br-m">{access.removeHint()}</span>
        </div>
    </div>
{/if}

<style>
    .br {
        display: flex;
        flex-direction: column;
        gap: 18px;
        color: #fff;
    }
    .br-hd {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 44px;
    }
    .br-dot {
        flex: none;
        width: 10px;
        height: 10px;
        margin: 0 11px;
        border-radius: 50%;
    }
    /* Plain white icon, like the menu: no tile behind it. */
    .br-ico {
        display: grid;
        place-items: center;
        flex: none;
        width: 32px;
        height: 32px;
        color: rgba(255, 255, 255, 0.85);
    }
    .br-name {
        min-width: 0;
        font-size: 16px;
        font-weight: 650;
        overflow-wrap: anywhere;
    }
    .br-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .br-t {
        font-size: 13px;
        font-weight: 600;
    }
    .br-m {
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
    }
    .br-error {
        margin: 0;
        font-size: 12.5px;
        color: #ff8a7a;
    }
    .br-remove {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
    }
    /* Red only for removing */
    .br-btn {
        height: 44px;
        margin: 0;
        padding: 0 18px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 87, 87, 0.14);
        box-shadow: inset 0 0 0 1px rgba(255, 138, 122, 0.5);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #ff8a7a;
        cursor: pointer;
    }
    .br-btn:disabled {
        opacity: 0.5;
        cursor: default;
    }
    @media (hover: hover) {
        .br-btn:not(:disabled):hover {
            background: rgba(255, 87, 87, 0.24);
        }
    }
    .br-btn:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
</style>
