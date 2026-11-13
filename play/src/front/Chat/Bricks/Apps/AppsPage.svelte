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
    import { appsSearchStart } from "./AppsSearch";
    import { loadMyApps, myAppsFailed, myAppsSettled, myAppsStore } from "./AppsStore";
    import { connectApp } from "./ConnectApp";
    import {
        isConnectedApp,
        matchesSearch,
        parseCatalog,
        parseReadyMade,
        toConnectAnother,
        type Connectable,
    } from "./Connectable";
    import TeamAppsPage from "./TeamAppsPage.svelte";
    import { IconPlanet, IconSearch, IconSparkles } from "@wa-icons";

    /**
     * The Apps page (game #2001), opened from the Apps row of the Bricks page: the apps the person connected, each with the
     * Bricks that use it, "Connect another" (the apps they can connect with one tap, each with its Connect button), and under
     * them "Your universes", the universes where they manage bots, each with the apps that belong to it rather than to one
     * person. "Search apps" narrows both lists by name. A tap on a row opens that app's page, or that universe's apps, in place.
     */
    export let onBack: () => void;

    $: text = $LL.chat.brick.apps;
    $: apps = $myAppsStore;
    let universes: MyUniverse[] = [];
    let openAppId: string | undefined;
    let openUniverseId: string | undefined;
    $: openUniverse = universes.find((universe) => universe.id === openUniverseId);

    // What Connect another holds: both lists Orbit keeps, read once and narrowed here by what the person types
    let connectable: Connectable[] | undefined;
    let connectListFailed = false;
    let query = "";
    let connectingKey: string | undefined;
    let connectNote: "stopped" | "blocked" | undefined;
    // A card in a chat that opens the Apps page with a word already in Search apps ("calendar"): taken once
    $: if ($appsSearchStart !== undefined) {
        query = $appsSearchStart;
        appsSearchStart.set(undefined);
    }
    $: mine = apps ?? [];
    $: connectedApps = mine.filter(isConnectedApp);
    $: another = connectable ? toConnectAnother(connectable, mine) : [];
    $: searching = query.trim() !== "";
    $: shownConnected = connectedApps.filter((app) => matchesSearch(query, app.name));
    $: shownAnother = another.filter((app) => matchesSearch(query, app.name, app.blurb));

    // Both lists may hold the same key: the kind tells them apart
    const keyOf = (app: Connectable) => `${app.kind}:${app.key}`;

    async function loadConnectable() {
        connectListFailed = false;
        const [listed, readyMade] = await Promise.all([
            botApiService
                .getAppCatalog()
                .then(parseCatalog)
                .catch((error: unknown) => {
                    console.warn("Could not read the apps to connect", error);
                    return undefined;
                }),
            // A 404 (none to offer) comes back as an empty list; any other failure is said below the list
            botApiService
                .getReadyMadeApps()
                .then(parseReadyMade)
                .catch((error: unknown) => {
                    console.warn("Could not read the ready-made apps", error);
                    return undefined;
                }),
        ]);
        connectListFailed = !listed || !readyMade;
        connectable = listed ? [...listed, ...(readyMade ?? [])] : undefined;
    }

    async function connect(app: Connectable) {
        if (connectingKey) return;
        connectingKey = keyOf(app);
        connectNote = undefined;
        const result = await connectApp(app);
        // eslint-disable-next-line require-atomic-updates
        connectingKey = undefined;
        if (result.status !== "connected") {
            connectNote = result.status;
            return;
        }
        // It is theirs now: its own page opens to choose which of their Bricks use it
        await loadMyApps(true);
        openAppId = result.appId;
    }

    function load() {
        loadConnectable().catch((error) => console.error(error));
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
            <label class="ap-search" data-testid="appsSearch">
                <IconSearch font-size="18" />
                <input
                    type="search"
                    bind:value={query}
                    placeholder={text.searchApps()}
                    aria-label={text.searchApps()}
                    data-testid="appsSearchInput"
                />
            </label>
            {#if searching}
                <AppSection
                    title={text.appsCount({ count: shownConnected.length + shownAnother.length })}
                    testId="appsFound"
                />
            {:else if connectedApps.length > 0}
                <AppSection title={text.connected()} />
            {/if}
            {#each shownConnected as app (app.id)}
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
            {#if !searching && another.length > 0}
                <AppSection
                    title={connectedApps.length > 0 ? text.connectAnother() : text.connectAnApp()}
                    testId="appsAnother"
                />
            {/if}
            {#each shownAnother as app (keyOf(app))}
                <AppRow title={app.name} hint={app.blurb || undefined} icon={appIcon(app.name)} testId="appsConnectRow">
                    <PageButton
                        disabled={connectingKey !== undefined}
                        testId="appsConnect"
                        on:click={() => void connect(app)}
                        >{connectingKey === keyOf(app) ? text.connecting() : text.connect()}</PageButton
                    >
                </AppRow>
            {/each}
            {#if connectNote}
                <p class="ap-bad" data-testid="appsConnectNote">
                    {connectNote === "blocked" ? text.connectBlocked() : text.connectStopped()}
                </p>
            {/if}
            {#if connectListFailed}
                <p class="ap-bad" data-testid="appsConnectListFailed">{text.connectListFailed()}</p>
                <div class="ap-try">
                    <PageButton tall testId="appsConnectListTryAgain" on:click={() => void loadConnectable()}
                        >{text.tryAgain()}</PageButton
                    >
                </div>
            {:else if searching && shownConnected.length + shownAnother.length === 0}
                <p class="ap-none" data-testid="appsNoMatch">{text.noAppMatches({ query: query.trim() })}</p>
            {/if}
            <!-- "Add your own app" goes here (its own sheet): "Not here? Add your own app" while `searching` -->
            <p class="ap-note" data-testid="appsSignInNote">
                <IconSparkles font-size="14" /><span>{text.signInNote()}</span>
            </p>
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
    .ap-none {
        margin: 0;
        padding: 6px 8px;
        font-size: 14px;
        color: rgba(244, 242, 250, 0.64);
    }
    .ap-note {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin: 8px 0 0;
        padding: 0 4px;
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
    }
    .ap-note :global(svg) {
        flex: none;
        margin-top: 1px;
    }
    /* The bot page's own search field (ModelList.svelte, .ml-search) */
    .ap-search {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 44px;
        margin: 0 4px 2px;
        padding: 0 12px;
        border-radius: 12px;
        background: #0a0814;
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        color: rgba(244, 242, 250, 0.64);
    }
    .ap-search:focus-within {
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.6);
    }
    .ap-search input {
        flex: 1;
        min-width: 0;
        height: 42px;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        font: inherit;
        font-size: 14px;
        color: #fff;
        outline: none;
        box-shadow: none;
    }
    .ap-search input::-webkit-search-cancel-button {
        display: none;
    }
</style>
