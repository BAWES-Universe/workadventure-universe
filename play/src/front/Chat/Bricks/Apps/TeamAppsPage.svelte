<script lang="ts">
    import { onMount } from "svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import PageButton from "../../../external-modules/bots/components/page/PageButton.svelte";
    import PageNote from "../../../external-modules/bots/components/page/PageNote.svelte";
    import { botApiService } from "../../../external-modules/bots/services/BotApiService";
    import { namesLine, parseTeamApps, type MyUniverse, type TeamApp } from "./Apps";
    import { appIcon } from "./AppIcon";
    import AppRow from "./AppRow.svelte";
    import AppSection from "./AppSection.svelte";
    import AppsShell from "./AppsShell.svelte";
    import TeamAppPage from "./TeamAppPage.svelte";

    /**
     * The apps that belong to one universe (game #2001), not to one person: they stay when someone leaves. The page is the
     * person's own Apps page for a team: the apps connected here, each with the bots that use it, and a warning on one whose
     * sign-in ended or whose connector no longer manages it. A tap opens that app's page.
     */
    export let universe: MyUniverse;
    export let onBack: () => void;

    $: text = $LL.chat.brick.apps;
    let apps: TeamApp[] | undefined;
    let failed = false;
    let openAppId: string | undefined;

    async function load() {
        try {
            const parsed = parseTeamApps(await botApiService.getUniverseApps(universe.id));
            if (parsed) apps = parsed;
            failed = !parsed;
        } catch (error) {
            console.warn("Could not read the universe's apps", error);
            failed = true;
        }
    }

    function hintOf(app: TeamApp): string {
        if (app.reconnectRequired) return text.signInEnded();
        if (app.authType === "oauth" && app.connectedBy && !app.connectedBy.stillManages) {
            return text.teamLeft({ name: app.connectedBy.name });
        }
        return app.bots.length === 0
            ? text.teamNoBots()
            : text.teamUsedBy({
                  names: namesLine(
                      app.bots.map((bot) => bot.botName),
                      text.and(),
                      (count) => text.more({ count })
                  ),
              });
    }

    const needsAttention = (app: TeamApp) =>
        app.reconnectRequired || (app.authType === "oauth" && !!app.connectedBy && !app.connectedBy.stillManages);

    // Read again each time the page opens, and when the app's own page closes: it may have been disconnected there
    onMount(() => {
        load().catch((error) => console.error(error));
    });
</script>

{#if openAppId}
    <TeamAppPage
        appId={openAppId}
        onBack={() => {
            openAppId = undefined;
            load().catch((error) => console.error(error));
        }}
    />
{:else}
    <AppsShell title={universe.name} backLabel={text.backToApps()} {onBack} testId="teamAppsPage">
        <p class="ta-lead">{text.universeLead({ universe: universe.name })}</p>
        {#if apps === undefined}
            {#if !failed}
                <PageNote>{text.loading()}</PageNote>
            {:else}
                <p class="ta-bad" data-testid="teamAppsLoadFailed">{text.loadFailed()}</p>
                <div class="ta-pad">
                    <PageButton tall testId="teamAppsTryAgain" on:click={() => void load()}
                        >{text.tryAgain()}</PageButton
                    >
                </div>
            {/if}
        {:else}
            {#if apps.length > 0}
                <AppSection title={text.connected()} />
                {#each apps as app (app.id)}
                    <AppRow
                        title={app.name}
                        icon={appIcon(app.name)}
                        hint={hintOf(app)}
                        warn={needsAttention(app)}
                        testId="teamAppRow"
                        onTap={() => (openAppId = app.id)}
                    />
                {/each}
            {:else}
                <PageNote>{text.teamNone()}</PageNote>
            {/if}
            {#if failed}<p class="ta-bad" data-testid="teamAppsStale">{text.loadFailed()}</p>{/if}
        {/if}
        <PageNote>{text.teamNote({ universe: universe.name })}</PageNote>
    </AppsShell>
{/if}

<style>
    .ta-lead {
        margin: 0 4px 4px;
        font-size: 14px;
        line-height: 1.45;
        color: rgba(244, 242, 250, 0.86);
    }
    .ta-bad {
        margin: 0;
        padding: 0 4px;
        font-size: 13px;
        color: #ff8a7a;
    }
    .ta-pad {
        padding: 0 4px;
    }
</style>
