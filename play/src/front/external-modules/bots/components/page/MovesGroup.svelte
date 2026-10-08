<script lang="ts">
    // Moves: whether the bot stays on its spot, wanders inside its circle, or walks a route, and how it walks it.
    import LL from "../../../../../i18n/i18n-svelte";
    import type { BotData } from "../../types";
    import { botModel, routeStops, withModel, type BotMoves } from "../../behaviorModel";
    import PageGroup from "./PageGroup.svelte";
    import PageSegment from "./PageSegment.svelte";
    import PageRow from "./PageRow.svelte";
    import PageField from "./PageField.svelte";
    import PageChips from "./PageChips.svelte";
    import { durationChips } from "./duration";
    import PageButton from "./PageButton.svelte";
    import PageNote from "./PageNote.svelte";
    import { IconCircleDashed, IconMapPin, IconRoute } from "@wa-icons";

    export let bot: BotData;
    export let open: boolean;
    export let onToggle: (id: string) => void;
    export let onChange: (bot: BotData) => void;
    /** Shown inside Behavior, without its own row */
    export let bare = false;
    export let onEditRoute: () => void;

    const MOVES: BotMoves[] = ["stay", "wander", "route"];
    const PAUSES = [0, 5, 30, 60];

    $: page = $LL.mapEditor.edit.bots.page;
    $: model = botModel(bot);
    $: stops = routeStops(bot).length;
    $: loops = bot.behaviorConfig.loop !== false;
    $: pause = typeof bot.behaviorConfig.pauseAtWaypoints === "number" ? bot.behaviorConfig.pauseAtWaypoints : 0;
    $: brief =
        model.moves === "route"
            ? page.moves.briefRoute({
                  count: stops,
                  direction: loops ? page.moves.loops() : page.moves.backAndForthBrief(),
              })
            : model.moves === "wander"
            ? page.moves.briefWander()
            : page.moves.briefStay();
    $: icon = model.moves === "route" ? IconRoute : model.moves === "wander" ? IconCircleDashed : IconMapPin;

    function pickMoves(moves: BotMoves) {
        onChange(withModel(bot, { moves }));
    }

    function setConfig(change: Record<string, unknown>) {
        onChange({ ...bot, behaviorConfig: { ...bot.behaviorConfig, ...change } });
    }
</script>

<PageGroup id="moves" {icon} title={page.moves.title()} {brief} {open} {onToggle} {bare}>
    <PageSegment
        label={page.moves.title()}
        options={[
            { value: MOVES[0], label: page.moves.stay(), testId: "bot-moves-stay" },
            { value: MOVES[1], label: page.moves.wander(), testId: "bot-moves-wander" },
            { value: MOVES[2], label: page.moves.route(), testId: "bot-moves-route" },
        ]}
        value={model.moves}
        onPick={pickMoves}
    />
    {#if model.moves === "route"}
        <PageRow icon={IconRoute} on title={page.moves.stops({ count: stops })} hint={page.moves.stopsHint()}>
            <PageButton testId="bot-edit-route" on:click={onEditRoute}>{page.moves.editRoute()}</PageButton>
        </PageRow>
        <PageField title={page.moves.direction()} hint={page.moves.directionHint()}>
            <PageChips
                label={page.moves.direction()}
                options={[
                    { value: true, label: page.moves.loop() },
                    { value: false, label: page.moves.backAndForth() },
                ]}
                value={loops}
                onPick={(loop) => setConfig({ loop })}
            />
        </PageField>
        <PageField title={page.moves.pause()} hint={page.moves.pauseHint()}>
            <PageChips
                label={page.moves.pause()}
                options={durationChips(PAUSES, pause)}
                value={pause}
                onPick={(seconds) => setConfig({ pauseAtWaypoints: seconds })}
            />
        </PageField>
    {:else if model.moves === "wander"}
        <PageRow icon={IconCircleDashed} on title={page.moves.area()} hint={page.moves.areaHint()} />
        <PageNote>{page.moves.areaNote()}</PageNote>
    {:else}
        <PageRow icon={IconMapPin} on title={page.moves.spot()} hint={page.moves.spotHint()} />
        {#if model.goesToPeople}
            <PageNote>{page.moves.spotNote()}</PageNote>
        {/if}
    {/if}
</PageGroup>
