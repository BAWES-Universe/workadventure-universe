<script lang="ts">
    // Behavior: how the bot gets around (stays, wanders or walks a route) and what it does when it sees someone.
    import LL from "../../../../../i18n/i18n-svelte";
    import type { BotData } from "../../types";
    import { botModel } from "../../behaviorModel";
    import PageGroup from "./PageGroup.svelte";
    import MovesGroup from "./MovesGroup.svelte";
    import PeopleGroup from "./PeopleGroup.svelte";
    import { IconCircleDashed, IconMapPin, IconRoute } from "@wa-icons";

    export let bot: BotData;
    export let open: boolean;
    export let onToggle: (id: string) => void;
    export let onChange: (bot: BotData) => void;
    export let onEditRoute: () => void;

    $: page = $LL.mapEditor.edit.bots.page;
    $: model = botModel(bot);
    $: icon = model.moves === "route" ? IconRoute : model.moves === "wander" ? IconCircleDashed : IconMapPin;
    $: brief = `${page.moves[model.moves]()} · ${
        model.goesToPeople ? page.behavior.goesToPeople() : page.behavior.waitsForPeople()
    }`;
</script>

<PageGroup id="behavior" {icon} title={page.behavior.title()} {brief} {open} {onToggle}>
    <div class="bp-sec">{page.behavior.getsAround()}</div>
    <MovesGroup {bot} open onToggle={() => {}} {onChange} {onEditRoute} bare />
    <div class="bp-sec bp-sec-gap">{page.behavior.withPeople()}</div>
    <PeopleGroup {bot} open onToggle={() => {}} {onChange} bare />
</PageGroup>

<style>
    .bp-sec {
        padding: 0 4px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(244, 242, 250, 0.5);
    }
    .bp-sec-gap {
        margin-top: 6px;
        padding-top: 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
</style>
