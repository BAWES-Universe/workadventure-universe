<script lang="ts">
    // People: whether the bot goes over to people it notices, how far it notices them (the soft ring on the map) and
    // how long before it goes to the same person again.
    import LL from "../../../../../i18n/i18n-svelte";
    import type { BotData } from "../../types";
    import {
        DEFAULT_PEOPLE_COOLDOWN_MS,
        NOTICE_RANGE_MAX,
        NOTICE_RANGE_MIN,
        botModel,
        noticeRange,
        withModel,
    } from "../../behaviorModel";
    import PageGroup from "./PageGroup.svelte";
    import PageRow from "./PageRow.svelte";
    import PageField from "./PageField.svelte";
    import PageChips from "./PageChips.svelte";
    import PageSwitch from "./PageSwitch.svelte";
    import { durationChips } from "./duration";
    import { IconUsers } from "@wa-icons";

    export let bot: BotData;
    export let open: boolean;
    export let onToggle: (id: string) => void;
    export let onChange: (bot: BotData) => void;

    const COOLDOWNS = [60, 300, 900];

    $: page = $LL.mapEditor.edit.bots.page;
    $: model = botModel(bot);
    $: range = Math.min(NOTICE_RANGE_MAX, Math.max(NOTICE_RANGE_MIN, noticeRange(bot)));
    $: cooldownMs = bot.behaviorConfig.minTimeBetweenConversations;
    $: cooldown = Math.round((typeof cooldownMs === "number" ? cooldownMs : DEFAULT_PEOPLE_COOLDOWN_MS) / 1000);
    $: brief = !model.goesToPeople
        ? page.people.briefOff()
        : model.moves === "stay"
        ? page.people.briefStay()
        : page.people.briefMoving();
    $: goesHint =
        model.moves === "route"
            ? page.people.goesRoute()
            : model.moves === "wander"
            ? page.people.goesWander()
            : page.people.goesStay();

    function setConfig(change: Record<string, unknown>) {
        onChange({ ...bot, behaviorConfig: { ...bot.behaviorConfig, ...change } });
    }

    function onRange(event: Event) {
        setConfig({ conversationRadius: Number((event.currentTarget as HTMLInputElement).value) });
    }
</script>

<PageGroup id="people" icon={IconUsers} title={page.people.title()} {brief} {open} {onToggle}>
    <PageRow
        on={model.goesToPeople}
        title={page.people.goesToPeople()}
        hint={model.goesToPeople ? goesHint : page.people.waits()}
    >
        <PageSwitch
            checked={model.goesToPeople}
            label={page.people.goesToPeople()}
            testId="bot-goes-to-people"
            onChange={(goesToPeople) => onChange(withModel(bot, { goesToPeople }))}
        />
    </PageRow>
    {#if model.goesToPeople}
        <PageField title={page.people.notices()} hint={page.people.noticesHint()}>
            <div class="bp-range">
                <span>{page.people.near()}</span>
                <input
                    type="range"
                    min={NOTICE_RANGE_MIN}
                    max={NOTICE_RANGE_MAX}
                    step="4"
                    value={range}
                    aria-label={page.people.notices()}
                    style="--fill: {((range - NOTICE_RANGE_MIN) / (NOTICE_RANGE_MAX - NOTICE_RANGE_MIN)) * 100}%"
                    data-testid="bot-notice-range"
                    on:input={onRange}
                />
                <span>{page.people.far()}</span>
            </div>
        </PageField>
        <PageField title={page.people.again()} hint={page.people.againHint()}>
            <PageChips
                label={page.people.again()}
                options={durationChips(COOLDOWNS, cooldown)}
                value={cooldown}
                onPick={(seconds) => setConfig({ minTimeBetweenConversations: seconds * 1000 })}
            />
        </PageField>
    {/if}
</PageGroup>

<style>
    .bp-range {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        color: rgba(244, 242, 250, 0.42);
    }
    .bp-range input {
        flex: 1;
        min-width: 0;
        height: 20px;
        margin: 0;
        background: transparent;
        appearance: none;
        cursor: pointer;
    }
    .bp-range input::-webkit-slider-runnable-track {
        height: 6px;
        border-radius: 3px;
        background: linear-gradient(90deg, #8629fc, #4156f6) 0 / var(--fill) 100% no-repeat, rgba(255, 255, 255, 0.12);
    }
    .bp-range input::-moz-range-track {
        height: 6px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.12);
    }
    .bp-range input::-moz-range-progress {
        height: 6px;
        border-radius: 3px;
        background: linear-gradient(90deg, #8629fc, #4156f6);
    }
    .bp-range input::-webkit-slider-thumb {
        appearance: none;
        width: 20px;
        height: 20px;
        margin-top: -7px;
        border: 0;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
    }
    .bp-range input::-moz-range-thumb {
        width: 20px;
        height: 20px;
        border: 0;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
    }
    .bp-range input:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 4px;
        border-radius: 4px;
    }
</style>
