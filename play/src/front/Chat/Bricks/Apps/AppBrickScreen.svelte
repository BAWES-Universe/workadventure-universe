<script lang="ts">
    import { onMount } from "svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import BotToolsHeadingScreen from "../../../external-modules/bots/components/BotToolsHeadingScreen.svelte";
    import BotToolsServerScreen from "../../../external-modules/bots/components/BotToolsServerScreen.svelte";
    import PageNote from "../../../external-modules/bots/components/page/PageNote.svelte";
    import { botApiService } from "../../../external-modules/bots/services/BotApiService";
    import { beginBot, setServers } from "../../../external-modules/bots/stores/BotToolsStore";
    import type { BotData } from "../../../external-modules/bots/types";
    import type { Heading } from "../../../external-modules/bots/toolsModel";
    import AppsShell from "./AppsShell.svelte";

    /**
     * What one of the person's Bricks may do with one app (game #2001): today's screen for an app on a bot, right away, asks
     * first or off for each of the four things, and its tools under each. Opened from the arrow on the Brick's row on the app's
     * page; back goes to that page. The screens are the bot page's own, so a change here is the same change there.
     */
    export let botId: string;
    export let botName: string;
    export let serverId: string;
    export let appName: string;
    export let onBack: () => void;

    $: text = $LL.chat.brick.apps;
    let ready = false;
    let failed = false;
    let heading: Heading | "unsorted" | undefined;

    $: bot = { id: botId, name: botName } as BotData;

    onMount(() => {
        // Claim the tools store for this Brick before asking, so another page's slow answer never takes it back
        beginBot(botId);
        botApiService
            .getBotMcpServers(botId)
            .then((servers) => {
                setServers(botId, servers);
                ready = true;
            })
            .catch((error) => {
                console.warn("Could not read the apps of a Brick", error);
                failed = true;
            });
    });
</script>

<AppsShell
    title={heading ? appName : botName}
    backLabel={heading ? botName : appName}
    onBack={heading ? () => (heading = undefined) : onBack}
    testId="appBrickScreen"
>
    {#if ready}
        {#if heading}
            <BotToolsHeadingScreen {bot} {serverId} {heading} />
        {:else}
            <BotToolsServerScreen {bot} {serverId} onOpenHeading={(next) => (heading = next)} onGone={onBack} />
        {/if}
    {:else if failed}
        <PageNote>{text.loadFailed()}</PageNote>
    {:else}
        <PageNote>{text.loading()}</PageNote>
    {/if}
</AppsShell>
