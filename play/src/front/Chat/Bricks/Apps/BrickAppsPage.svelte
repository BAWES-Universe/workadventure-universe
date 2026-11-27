<script lang="ts">
    import { onMount } from "svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import PageButton from "../../../external-modules/bots/components/page/PageButton.svelte";
    import PageNote from "../../../external-modules/bots/components/page/PageNote.svelte";
    import { appIcon } from "./AppIcon";
    import AppBrickScreen from "./AppBrickScreen.svelte";
    import AppRow from "./AppRow.svelte";
    import AppsShell from "./AppsShell.svelte";
    import ShowAppUseRow from "./ShowAppUseRow.svelte";
    import { loadMyApps, myAppsFailed, myAppsSettled, myAppsStore } from "./AppsStore";
    import { appsOfBrick, type BrickAppUse } from "./BrickApps";
    import { mayLine } from "./AppWords";
    import { requestAppPage } from "./AppLink";
    import { openAppsPage } from "./OpenApps";
    import { IconPlus } from "@wa-icons";

    /**
     * The Apps of one Brick, from its own page: each app it can use, with what it may do in one line, and a tap opens that
     * app's screen for this Brick (right away, asks first or off, action by action); an app whose sign-in ended opens its page on the Apps page, where Reconnect is. The same words and screens as the Apps
     * page: this is only a second way in, so a person who looks on the Brick's page finds them. "Connect an app" goes to the
     * Apps page, where apps are connected.
     */
    export let botId: string;
    export let botName: string;
    export let onBack: () => void;

    $: text = $LL.chat.brick.apps;
    $: mine = appsOfBrick($myAppsStore, botId);
    // The app whose screen is open over this one
    let screen: { serverId: string; appName: string } | undefined;

    onMount(() => {
        loadMyApps().catch((error) => console.error(error));
    });

    // An app whose sign-in ended has nothing to choose until it is signed in again: its page on the Apps page has Reconnect
    function open(one: BrickAppUse) {
        if (one.app.reconnectRequired) {
            requestAppPage(one.app.id);
            openAppsPage();
            return;
        }
        screen = { serverId: one.brick.serverId, appName: one.app.name };
    }

    function back() {
        screen = undefined;
        // What the person changed there shows here and on the row of the Brick's page
        loadMyApps(true).catch((error) => console.error(error));
    }
</script>

{#if screen}
    <AppBrickScreen {botId} {botName} serverId={screen.serverId} appName={screen.appName} onBack={back} />
{:else}
    <AppsShell title={text.onBrick.title()} backLabel={botName} {onBack} testId="brickAppsPage">
        {#if mine === undefined}
            <PageNote>{$myAppsSettled && $myAppsFailed ? text.loadFailed() : text.loading()}</PageNote>
            {#if $myAppsSettled && $myAppsFailed}
                <PageButton testId="brickAppsTryAgain" on:click={() => void loadMyApps(true)}
                    >{text.tryAgain()}</PageButton
                >
            {/if}
        {:else}
            <ShowAppUseRow {botId} />
            {#if mine.length === 0}
                <PageNote>{text.onBrick.noneNote({ brick: botName })}</PageNote>
            {:else}
                {#each mine as one (one.app.id)}
                    <AppRow
                        title={one.app.name}
                        hint={one.app.reconnectRequired
                            ? text.signInEnded()
                            : mayLine($LL, one.app.name, one.brick.settings, one.brick.enabled)}
                        warn={one.app.reconnectRequired}
                        icon={appIcon(one.app.name)}
                        onTap={() => open(one)}
                        testId="brickAppRow"
                    />
                {/each}
                <PageNote>{text.onBrick.top({ brick: botName })}</PageNote>
            {/if}
            <PageButton testId="brickAppsConnect" on:click={() => openAppsPage()}>
                <IconPlus font-size="16" />{text.connectAnApp()}
            </PageButton>
        {/if}
    </AppsShell>
{/if}
