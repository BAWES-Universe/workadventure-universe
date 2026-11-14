<script lang="ts">
    import { onMount } from "svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import PageButton from "../../../external-modules/bots/components/page/PageButton.svelte";
    import PageNote from "../../../external-modules/bots/components/page/PageNote.svelte";
    import { botApiService } from "../../../external-modules/bots/services/BotApiService";
    import { namesLine, parseMyUniverses, type MyUniverse } from "./Apps";
    import { appIcon } from "./AppIcon";
    import AppPage from "./AppPage.svelte";
    import AppRow from "./AppRow.svelte";
    import AppSection from "./AppSection.svelte";
    import AppsShell from "./AppsShell.svelte";
    import { loadMyApps, myAppsFailed, myAppsSettled, myAppsStore } from "./AppsStore";
    import TeamAppsPage from "./TeamAppsPage.svelte";
    import { IconPlanet } from "@wa-icons";

    /**
     * The Apps page (game #2001), opened from the Apps row of the Bricks page: the apps the person connected, each with the
     * Bricks that use it, and under them "Your universes", the universes where they manage bots, each with the apps that
     * belong to it rather than to one person. A tap on a row opens that app's page, or that universe's apps, in place.
     */
    export let onBack: () => void;

    $: text = $LL.chat.brick.apps;
    $: apps = $myAppsStore;
    let universes: MyUniverse[] = [];
    let openAppId: string | undefined;
    let openUniverseId: string | undefined;
    $: openUniverse = universes.find((universe) => universe.id === openUniverseId);

    function load() {
        loadMyApps().catch((error) => console.error(error));
        // "Your universes" shows only when Orbit says the person manages bots somewhere; a failed read just hides it
        botApiService
            .getMyAppUniverses()
            .then((answer) => {
                universes = parseMyUniverses(answer) ?? [];
            })
            .catch((error) => console.warn("Could not read your universes", error));
    }

    function usedBy(names: string[]): string {
        return names.length === 0
            ? text.usedByNone()
            : text.usedBy({ names: namesLine(names, text.and(), (count) => text.more({ count })) });
    }

    // Read again each time the page opens: an app connected on another device shows
    onMount(load);
</script>

{#if openAppId}
    <AppPage appId={openAppId} onBack={() => (openAppId = undefined)} />
{:else if openUniverse}
    <TeamAppsPage universe={openUniverse} onBack={() => (openUniverseId = undefined)} />
{:else}
    <AppsShell title={text.title()} backLabel={text.backToBricks()} {onBack} testId="appsPage">
        <p class="ap-lead">{text.lead()}</p>
        {#if apps === undefined}
            {#if !$myAppsSettled}
                <PageNote>{text.loading()}</PageNote>
            {:else}
                <p class="ap-bad" data-testid="appsLoadFailed">{text.loadFailed()}</p>
                <div class="ap-try">
                    <PageButton tall testId="appsTryAgain" on:click={load}>{text.tryAgain()}</PageButton>
                </div>
            {/if}
        {:else}
            {#if apps.length > 0}
                <AppSection title={text.connected()} />
                {#each apps as app (app.id)}
                    <AppRow
                        title={app.name}
                        icon={appIcon(app.name)}
                        hint={app.reconnectRequired
                            ? text.signInEnded()
                            : [
                                  app.source === "link" ? text.addedByYou() : "",
                                  usedBy(app.bricks.map((brick) => brick.botName)),
                              ]
                                  .filter(Boolean)
                                  .join(" · ")}
                        warn={app.reconnectRequired}
                        testId="appsRow"
                        onTap={() => (openAppId = app.id)}
                    />
                {/each}
            {/if}
            {#if $myAppsFailed}
                <p class="ap-bad" data-testid="appsStale">{text.loadFailed()}</p>
            {/if}
        {/if}
        {#if universes.length > 0}
            <AppSection title={text.yourUniverses()} testId="appsUniverses" />
            {#each universes as universe (universe.id)}
                <AppRow
                    title={universe.name}
                    icon={IconPlanet}
                    hint={universe.apps > 0 ? text.universeApps({ count: universe.apps }) : text.universeNoApps()}
                    testId="appsUniverseRow"
                    onTap={() => (openUniverseId = universe.id)}
                />
            {/each}
        {/if}
    </AppsShell>
{/if}

<style>
    .ap-lead {
        margin: 0 4px 6px;
        font-size: 14px;
        line-height: 1.45;
        color: rgba(244, 242, 250, 0.86);
    }
    .ap-bad {
        margin: 0;
        padding: 0 4px;
        font-size: 13px;
        color: #ff8a7a;
    }
    .ap-try {
        padding: 0 4px;
    }
</style>
