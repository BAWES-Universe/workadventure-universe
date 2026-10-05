<script lang="ts">
    // One bot in the list: its WOKA in a circle, its name, one line on what it does, and its on/off switch.
    // Tapping the row opens its page.
    import LL from "../../../../i18n/i18n-svelte";
    import { ABSOLUTE_PUSHER_URL } from "../../../Enum/ComputedConst";
    import type { BotData } from "../types";
    import WokaImage from "../../../Components/Woka/WokaImage.svelte";
    import { botWokaCatalogStore } from "../stores/BotWokaCatalogStore";
    import { botModel } from "../behaviorModel";
    import PageSwitch from "./page/PageSwitch.svelte";

    export let bot: BotData;
    export let toggling = false;
    export let onSelect: () => void;
    export let onToggle: (bot: BotData, enabled: boolean) => void;
    export let onHover: (botId: string | undefined) => void;

    $: page = $LL.mapEditor.edit.bots.page;
    $: model = botModel(bot);
    $: brief = `${page.moves[model.moves]()} · ${
        model.goesToPeople ? page.behavior.goesToPeople() : page.behavior.waitsForPeople()
    }`;

    function getTextureUrl(relativeUrl: string): string {
        if (relativeUrl.startsWith("http://") || relativeUrl.startsWith("https://")) {
            return relativeUrl;
        }
        return `${ABSOLUTE_PUSHER_URL}${relativeUrl}`;
    }

    function onKey(e: KeyboardEvent) {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
        }
    }
</script>

<div
    class="bl-row"
    class:off={bot.enabled === false}
    role="button"
    tabindex="0"
    data-testid="bot-row"
    on:click={onSelect}
    on:keydown={onKey}
    on:mouseenter={() => onHover(bot.id)}
    on:mouseleave={() => onHover(undefined)}
>
    <span class="bl-woka">
        {#if bot.characterTexture && $botWokaCatalogStore}
            <WokaImage
                selectedTextures={{ woka: bot.characterTexture }}
                wokaData={$botWokaCatalogStore}
                {getTextureUrl}
                canvasSize={36}
                direction={0}
            />
        {/if}
    </span>
    <span class="bl-tx">
        <span class="bl-t">{bot.name || "Bot"}</span>
        <span class="bl-m">{bot.description?.trim() || brief}</span>
    </span>
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <span on:click|stopPropagation>
        <PageSwitch
            checked={bot.enabled !== false}
            label={page.switchOn()}
            disabled={toggling}
            testId="bot-row-switch"
            onChange={(enabled) => onToggle(bot, enabled)}
        />
    </span>
</div>

<style>
    .bl-row {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 56px;
        padding: 6px 8px;
        border-radius: 14px;
        color: #fff;
        cursor: pointer;
    }
    @media (hover: hover) {
        .bl-row:hover {
            background: rgba(255, 255, 255, 0.05);
        }
    }
    .bl-row:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: -2px;
    }
    .bl-woka {
        display: grid;
        place-items: center;
        flex: none;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: radial-gradient(
            circle at 50% 42%,
            rgba(134, 41, 252, 0.35),
            rgba(65, 86, 246, 0.12) 58%,
            rgba(255, 255, 255, 0.03) 72%
        );
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.28);
    }
    .off .bl-woka {
        filter: grayscale(1);
        opacity: 0.6;
    }
    .bl-tx {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
    }
    .bl-t {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .bl-m {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
    }
    .bl-t {
        font-size: 14px;
        font-weight: 600;
    }
    .off .bl-t {
        color: rgba(244, 242, 250, 0.7);
    }
    .bl-m {
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
    }
</style>
