<script lang="ts">
    import { onMount } from "svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import PageGroup from "../../../external-modules/bots/components/page/PageGroup.svelte";
    import { loadMyApps, myAppsStore } from "./AppsStore";
    import { appsBrief, appsOfBrick } from "./BrickApps";
    import { shownIn, showAppUseStates } from "./BrickShowAppUse";
    import { IconApps } from "@wa-icons";

    /**
     * "Apps" on a Brick's own page (game #2001): which apps this Brick can use, and whether chat shows which app it used, in one line, after Computer. A tap opens the Brick's Apps screen (the page keeps it, like "Everything Brick did").
     */
    export let botId: string;
    export let onOpen: () => void;

    $: brief = appsBrief(appsOfBrick($myAppsStore, botId), $LL, shownIn($showAppUseStates, botId));

    onMount(() => {
        loadMyApps().catch((error) => console.error(error));
    });
</script>

<PageGroup id="apps" icon={IconApps} title={$LL.chat.brick.apps.onBrick.title()} {brief} link onToggle={onOpen} />
