<script lang="ts">
    import { onMount } from "svelte";
    import LL, { locale } from "../../../../i18n/i18n-svelte";
    import ConfirmSheet from "../../../external-modules/bots/components/page/ConfirmSheet.svelte";
    import PageButton from "../../../external-modules/bots/components/page/PageButton.svelte";
    import PageNote from "../../../external-modules/bots/components/page/PageNote.svelte";
    import { botApiService } from "../../../external-modules/bots/services/BotApiService";
    import { warningMessageStore } from "../../../Stores/ErrorStore";
    import { refusalWords } from "./AppWords";
    import { dayOf, parseTeamAppPage, type Person, type TeamAppPage } from "./Apps";
    import { appIcon } from "./AppIcon";
    import AddManagerSheet from "./AddManagerSheet.svelte";
    import AppBrickScreen from "./AppBrickScreen.svelte";
    import AppRow from "./AppRow.svelte";
    import AppSection from "./AppSection.svelte";
    import AppsShell from "./AppsShell.svelte";
    import { reconnectApp } from "./Reconnect";
    import { IconAlertTriangle, IconCrown, IconPlus } from "@wa-icons";

    /**
     * One app that belongs to a universe (game #2001): who connected it and when, a warning with one Reconnect button when its
     * sign-in ended or the person who connected it no longer manages it (nothing is handed over silently), the bots that use
     * it, its managers (Add a manager, Remove), this month's uses counted for the universe, and Disconnect. Only a manager
     * sees it; anyone else gets nothing from Orbit.
     */
    export let appId: string;
    export let onBack: () => void;

    $: text = $LL.chat.brick.apps;
    let page: TeamAppPage | undefined;
    let loadFailed = false;
    let busy = false;
    let sheet: "add" | "disconnect" | undefined;
    let signingIn = false;
    // A bot of the universe whose way of using this app is open (right away, asks first or off), over the page
    let botScreen: { botId: string; botName: string; serverId: string } | undefined;

    $: app = page?.app;
    $: universe = app?.universeName ?? "";
    // The person who connected it left, or lost the right to manage bots there, and the sign-in on it is theirs
    $: dependsOnConnector = !!app && app.authType === "oauth" && !!app.connectedBy && !app.connectedBy.stillManages;
    $: managerNames = app ? app.managers.map((person) => person.name) : [];

    async function load() {
        try {
            const parsed = parseTeamAppPage(await botApiService.getTeamApp(appId));
            if (parsed) page = parsed;
            loadFailed = !parsed;
        } catch (error) {
            console.warn("Could not read the universe's app", error);
            loadFailed = true;
        }
    }

    async function change(work: () => Promise<unknown>): Promise<boolean> {
        if (busy) return false;
        busy = true;
        try {
            try {
                await work();
            } catch (error) {
                console.warn("A change to the universe's app did not go through", error);
                warningMessageStore.addWarningMessage(text.workFailed());
                return false;
            }
            // Nothing else can be changed until the page is read again, so an older answer never lands over a newer one
            await load();
            return true;
        } finally {
            // eslint-disable-next-line require-atomic-updates
            busy = false;
        }
    }

    async function addManager(person: Person): Promise<boolean> {
        const done = await change(() => botApiService.addTeamAppManager(appId, person.id));
        if (done) sheet = undefined;
        return done;
    }

    async function letUse(botId: string) {
        if (busy) return;
        busy = true;
        try {
            try {
                await botApiService.letBotUseApp(botId, appId);
            } catch (error) {
                console.warn("Could not let the bot use the universe's app", error);
                warningMessageStore.addWarningMessage(refusalWords(error, text.workFailed()));
                return;
            }
            await load();
        } finally {
            // eslint-disable-next-line require-atomic-updates
            busy = false;
        }
    }

    const removeManager = (person: Person) => change(() => botApiService.removeTeamAppManager(appId, person.id));

    async function disconnect() {
        // The confirmation stays open while another change is on its way: it is not dropped without being done
        if (busy) return;
        sheet = undefined;
        if (await change(() => botApiService.disconnectTeamApp(appId))) onBack();
    }

    async function reconnect() {
        if (signingIn) return;
        signingIn = true;
        let result: Awaited<ReturnType<typeof reconnectApp>>;
        try {
            result = await reconnectApp(appId);
        } catch (error) {
            console.warn("The sign-in did not finish", error);
            result = "blocked";
        } finally {
            // eslint-disable-next-line require-atomic-updates
            signingIn = false;
        }
        if (result === "blocked") warningMessageStore.addWarningMessage(text.reconnectFailed());
        await load();
    }

    onMount(() => {
        load().catch((error) => console.error(error));
    });
</script>

{#if botScreen && app}
    <AppBrickScreen
        botId={botScreen.botId}
        botName={botScreen.botName}
        serverId={botScreen.serverId}
        appName={app.name}
        onBack={() => {
            botScreen = undefined;
            load().catch((error) => console.error(error));
        }}
    />
{:else}
    <AppsShell title={app?.name ?? ""} backLabel={universe || text.backToApps()} {onBack} testId="teamAppPage">
        {#if !page || !app}
            {#if !loadFailed}
                <PageNote>{text.loading()}</PageNote>
            {:else}
                <p class="tp-bad" data-testid="teamAppLoadFailed">{text.loadFailed()}</p>
                <div class="tp-pad">
                    <PageButton tall testId="teamAppTryAgain" on:click={() => void load()}>{text.tryAgain()}</PageButton
                    >
                </div>
            {/if}
        {:else}
            {#if loadFailed}
                <!-- A change went through but reading the page again did not: what is shown may be out of date -->
                <p class="tp-bad" data-testid="teamAppLoadFailed">{text.loadFailed()}</p>
                <div class="tp-pad">
                    <PageButton tall testId="teamAppTryAgain" on:click={() => void load()}>{text.tryAgain()}</PageButton
                    >
                </div>
            {/if}
            <div class="tp-card">
                <span class="tp-ico"><svelte:component this={appIcon(app.name)} font-size="24" /></span>
                <div class="tp-tx">
                    <span class="tp-cap">{text.belongsTo({ universe })}</span>
                    <span class="tp-mid"
                        >{app.connectedBy
                            ? text.connectedBy({ name: app.connectedBy.name })
                            : text.connectedByGone()}</span
                    >
                    {#if app.connectedAt}<span class="tp-cn"
                            >{text.since({ day: dayOf(app.connectedAt, $locale) })}</span
                        >{/if}
                </div>
            </div>
            {#if app.reconnectRequired}
                <div class="tp-alert" data-testid="teamAppEnded">
                    <IconAlertTriangle font-size="20" />
                    <div class="tp-tx">
                        <span class="tp-t"
                            >{app.signInLostAt
                                ? text.endedOn({ day: dayOf(app.signInLostAt, $locale) })
                                : text.reconnectEndedTitle()}</span
                        >
                        <span class="tp-cn"
                            >{text.endedLine({
                                app: app.name,
                                names: managerNames.join(` ${text.and()} `),
                            })}</span
                        >
                    </div>
                </div>
            {:else if dependsOnConnector && app.connectedBy}
                <div class="tp-alert" data-testid="teamAppLeft">
                    <IconAlertTriangle font-size="20" />
                    <div class="tp-tx">
                        <span class="tp-t">{text.managerLeftTitle({ name: app.connectedBy.name, app: app.name })}</span>
                        <span class="tp-cn">{text.managerLeftLine({ name: app.connectedBy.name })}</span>
                    </div>
                </div>
            {/if}
            {#if app.authType === "oauth" && (app.reconnectRequired || dependsOnConnector)}
                <div class="tp-pad tp-wide">
                    <PageButton tall go disabled={signingIn} testId="teamAppReconnect" on:click={() => void reconnect()}
                        >{signingIn ? text.reconnecting() : text.reconnect({ app: app.name })}</PageButton
                    >
                </div>
            {/if}

            <AppSection title={text.botsThatCanUse()} />
            {#each app.bots as bot (bot.botId)}
                <AppRow
                    title={bot.botName}
                    hint={bot.enabled ? text.botUsesIt() : text.botOff()}
                    openLabel={text.changeWhatItMay({ name: bot.botName, app: app.name })}
                    onOpen={() => (botScreen = { botId: bot.botId, botName: bot.botName, serverId: bot.serverId })}
                    testId="teamAppBot"
                />
            {/each}
            {#each page.canLetUse as bot (bot.id)}
                <AppRow title={bot.name} hint={text.cantUse({ app: app.name })} testId="teamAppBotOff">
                    <PageButton disabled={busy} testId="teamAppLetUse" on:click={() => void letUse(bot.id)}
                        >{text.letUse({ app: app.name })}</PageButton
                    >
                </AppRow>
            {/each}
            <PageNote>{text.botsThatCanUseNote({ universe })}</PageNote>

            <AppSection title={text.managers()} testId="teamAppManagers" />
            {#each app.managers as person (person.id)}
                <AppRow
                    title={person.you ? text.you({ name: person.name }) : person.name}
                    hint={person.owner ? text.ownsUniverse({ universe }) : undefined}
                    testId="teamAppManager"
                >
                    {#if person.owner === false}
                        <PageButton
                            disabled={busy}
                            testId="teamAppRemoveManager"
                            on:click={() => void removeManager(person)}>{text.removeManager()}</PageButton
                        >
                    {:else if person.owner}
                        <IconCrown font-size="16" />
                    {/if}
                </AppRow>
            {/each}
            <div class="tp-off nob">
                <PageButton tall testId="teamAppAddManager" on:click={() => (sheet = "add")}
                    ><IconPlus font-size="18" />{text.addManager()}</PageButton
                >
                <span class="tp-cn">{text.managersLine({ universe })}</span>
            </div>

            <AppSection title={text.thisMonth()} />
            <p class="tp-wh" data-testid="teamAppUses">{text.usesThisMonth({ count: app.usesThisMonth })}</p>
            <PageNote>{text.countedForUniverse({ universe })}</PageNote>

            <div class="tp-off">
                <PageButton
                    tall
                    danger
                    disabled={busy}
                    testId="teamAppDisconnect"
                    on:click={() => (sheet = "disconnect")}>{text.disconnect({ app: app.name })}</PageButton
                >
                <span class="tp-cn">{text.teamDisconnectLine({ app: app.name })}</span>
            </div>
        {/if}
    </AppsShell>
{/if}

{#if app && sheet === "add"}
    <AddManagerSheet
        app={app.name}
        {universe}
        people={page?.canAddAsManager ?? []}
        onAdd={addManager}
        onClose={() => (sheet = undefined)}
    />
{:else if app && sheet === "disconnect"}
    <ConfirmSheet
        title={text.teamDisconnectTitle({ app: app.name, universe })}
        lines={[{ text: text.teamDisconnectLines({ app: app.name, universe }), bold: [text.atOnce()] }]}
        note={text.disconnectNote({ app: app.name })}
        cancelLabel={text.cancel()}
        confirmLabel={text.disconnectConfirm()}
        onCancel={() => (sheet = undefined)}
        onConfirm={() => void disconnect()}
        testId="teamAppDisconnectSheet"
    />
{/if}

<style>
    .tp-bad {
        margin: 0;
        padding: 0 4px;
        font-size: 13px;
        color: #ff8a7a;
    }
    .tp-pad {
        padding: 0 4px;
    }
    .tp-wide :global(.bp-btn) {
        width: 100%;
        height: 48px;
        font-size: 15px;
        font-weight: 700;
    }
    .tp-card {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px;
        border-radius: 14px;
        background: #0a0814;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    }
    .tp-ico {
        display: grid;
        place-items: center;
        flex: none;
        width: 32px;
        height: 32px;
        color: #fff;
    }
    .tp-tx {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }
    .tp-cap {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(244, 242, 250, 0.64);
        overflow-wrap: anywhere;
    }
    .tp-mid {
        font-size: 15px;
        font-weight: 700;
        overflow-wrap: anywhere;
    }
    .tp-t {
        font-size: 14px;
        font-weight: 600;
    }
    .tp-cn {
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
    }
    .tp-wh {
        margin: 0;
        padding: 0 4px;
        font-size: 14px;
        color: #fff;
    }
    .tp-alert {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        margin-top: 8px;
        padding: 12px;
        border-radius: 14px;
        background: rgba(245, 196, 81, 0.08);
        box-shadow: inset 0 0 0 1px rgba(245, 196, 81, 0.45);
        color: #f5c451;
    }
    .tp-alert :global(svg) {
        flex: none;
        margin-top: 1px;
    }
    .tp-alert .tp-t {
        color: #fff;
    }
    .tp-off {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
        margin-top: 8px;
        padding: 10px 4px 0;
        border-top: 1px solid rgb(255 255 255 / 0.06);
    }
    .tp-off.nob {
        margin-top: 2px;
        padding-top: 2px;
        border-top: 0;
    }
</style>
