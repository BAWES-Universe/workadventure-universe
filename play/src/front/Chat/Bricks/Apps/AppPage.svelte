<script lang="ts">
    import { onMount } from "svelte";
    import LL, { locale } from "../../../../i18n/i18n-svelte";
    import ConfirmSheet from "../../../external-modules/bots/components/page/ConfirmSheet.svelte";
    import PageButton from "../../../external-modules/bots/components/page/PageButton.svelte";
    import PageNote from "../../../external-modules/bots/components/page/PageNote.svelte";
    import { botApiService } from "../../../external-modules/bots/services/BotApiService";
    import { warningMessageStore } from "../../../Stores/ErrorStore";
    import { dayOf, parseMyAppPage, THINGS, type Lend, type MyAppPage, type Thing } from "./Apps";
    import { appIcon } from "./AppIcon";
    import AppRow from "./AppRow.svelte";
    import AppSection from "./AppSection.svelte";
    import AppsShell from "./AppsShell.svelte";
    import { loadMyApps } from "./AppsStore";
    import { mayLine, thingLabel } from "./AppWords";
    import LendSheet from "./LendSheet.svelte";
    import { reconnectApp } from "./Reconnect";
    import { IconAlertTriangle, IconLock, IconPlanet, IconPlus, IconX } from "@wa-icons";

    /**
     * One of the person's own apps (game #2001): who it is connected as, the Bricks that can use it (Remove, or Let it use),
     * and, for an app added with a link and a key, "Lent to": the universes where bots may use it, with what they may do and how
     * many uses a day, and a way to lend it to another. An app signed in as the person says "Only for you" and has no
     * "Lent to" at all: nothing in it is safe to hand to other people. Disconnect stops every Brick and bot at once.
     */
    export let appId: string;
    export let onBack: () => void;

    $: text = $LL.chat.brick.apps;
    let page: MyAppPage | undefined;
    let loadFailed = false;
    let busy = false;
    // The sheet that is open over the page: lending, changing a lend, taking one back, disconnecting
    let sheet:
        | { kind: "lend" }
        | { kind: "change"; lend: Lend }
        | { kind: "takeBack"; lend: Lend }
        | { kind: "disconnect" }
        | undefined;
    let signingIn = false;

    $: app = page?.app;

    async function load() {
        try {
            const parsed = parseMyAppPage(await botApiService.getMyApp(appId));
            if (parsed) page = parsed;
            loadFailed = !parsed;
        } catch (error) {
            console.warn("Could not read the app", error);
            loadFailed = true;
        }
    }

    /** One change, then the page and the list read again. On a refusal nothing is changed and the person is told. */
    async function change(work: () => Promise<unknown>): Promise<boolean> {
        if (busy) return false;
        busy = true;
        try {
            await work();
        } catch (error) {
            console.warn("An app change did not go through", error);
            warningMessageStore.addWarningMessage(text.workFailed());
            return false;
        } finally {
            // eslint-disable-next-line require-atomic-updates
            busy = false;
        }
        await Promise.all([load(), loadMyApps(true)]);
        return true;
    }

    const letUse = (botId: string) => change(() => botApiService.letBrickUseApp(appId, botId));
    const remove = (botId: string) => change(() => botApiService.removeBrickFromApp(appId, botId));

    async function lend(choice: {
        universeId: string;
        things: Thing[] | null;
        usesPerDay: number | null;
    }): Promise<boolean> {
        const current = sheet?.kind === "change" ? sheet.lend : undefined;
        const done = await change(() =>
            current
                ? botApiService.changeAppLend(appId, choice.universeId, {
                      things: choice.things,
                      usesPerDay: choice.usesPerDay,
                  })
                : botApiService.lendApp(appId, choice)
        );
        // eslint-disable-next-line require-atomic-updates
        if (done) sheet = undefined;
        return done;
    }

    async function takeBack(lendOf: Lend) {
        sheet = undefined;
        await change(() => botApiService.takeAppBack(appId, lendOf.universeId));
    }

    async function disconnect() {
        sheet = undefined;
        if (await change(() => botApiService.disconnectMyApp(appId))) onBack();
    }

    async function reconnect() {
        if (signingIn) return;
        signingIn = true;
        const result = await reconnectApp(appId);
        // eslint-disable-next-line require-atomic-updates
        signingIn = false;
        if (result === "blocked") warningMessageStore.addWarningMessage(text.reconnectFailed());
        await Promise.all([load(), loadMyApps(true)]);
    }

    function mayOf(lend: Lend): string {
        return lend.things === null
            ? text.botsMayDoAll({ count: THINGS.length })
            : text.botsMayDoSome({
                  things: lend.things.map((thing) => thingLabel($LL, thing).toLowerCase()).join(", "),
              });
    }

    onMount(() => {
        load().catch((error) => console.error(error));
    });
</script>

<AppsShell title={app?.name ?? ""} backLabel={text.backToApps()} {onBack} testId="appPage">
    {#if !page || !app}
        {#if !loadFailed}
            <PageNote>{text.loading()}</PageNote>
        {:else}
            <p class="pg-bad" data-testid="appLoadFailed">{text.loadFailed()}</p>
            <div class="pg-pad">
                <PageButton tall testId="appTryAgain" on:click={() => void load()}>{text.tryAgain()}</PageButton>
            </div>
        {/if}
    {:else}
        <div class="pg-card">
            <span class="pg-ico"><svelte:component this={appIcon(app.name)} font-size="24" /></span>
            <div class="pg-tx">
                <span class="pg-cap">{app.reconnectRequired ? text.reconnectEndedTitle() : text.connected()}</span>
                <span class="pg-mid">{app.source === "link" ? text.addedByYouCard() : text.signedInAsYou()}</span>
                {#if app.connectedAt}<span class="pg-cn">{text.since({ day: dayOf(app.connectedAt, $locale) })}</span
                    >{/if}
            </div>
        </div>
        {#if app.reconnectRequired}
            <div class="pg-alert" data-testid="appSignInEnded">
                <IconAlertTriangle font-size="20" />
                <div class="pg-tx">
                    <span class="pg-t">{text.reconnectEndedTitle()}</span>
                    <span class="pg-cn">{text.reconnectEndedLine({ app: app.name })}</span>
                </div>
            </div>
            <div class="pg-pad pg-wide">
                <PageButton tall go disabled={signingIn} testId="appReconnect" on:click={() => void reconnect()}
                    >{signingIn ? text.reconnecting() : text.reconnect({ app: app.name })}</PageButton
                >
            </div>
        {/if}

        <AppSection title={text.bricksThatCanUse()} />
        {#each app.bricks as brick (brick.botId)}
            <AppRow
                title={brick.botName}
                hint={mayLine($LL, app.name, brick.settings, brick.enabled)}
                testId="appBrickRow"
            >
                <PageButton disabled={busy} testId="appBrickRemove" on:click={() => void remove(brick.botId)}
                    >{text.remove()}</PageButton
                >
            </AppRow>
        {/each}
        {#each page.canLetUse as brick (brick.id)}
            <AppRow title={brick.name} hint={text.cantUse({ app: app.name })} testId="appBrickOff">
                <PageButton disabled={busy} testId="appBrickLetUse" on:click={() => void letUse(brick.id)}
                    >{text.letUse({ app: app.name })}</PageButton
                >
            </AppRow>
        {/each}

        {#if !app.lendable}
            <AppSection title={text.otherPeople()} />
            <AppRow
                title={text.onlyForYou()}
                hint={text.onlyForYouLine({ app: app.name })}
                icon={IconLock}
                testId="appOnlyForYou"
            />
        {:else}
            <AppSection title={text.lentTo()} testId="appLentTo" />
            {#each page.lentTo as lend (lend.universeId)}
                <div class="pg-lent" data-testid="appLent">
                    <div class="pg-lent-h">
                        <span class="pg-ico sm"><IconPlanet font-size="20" /></span>
                        <span class="pg-t grow">{lend.universeName}</span>
                        <button
                            type="button"
                            class="pg-x"
                            aria-label={text.takeBackLabel({ app: app.name, universe: lend.universeName })}
                            data-testid="appTakeBack"
                            on:click={() => (sheet = { kind: "takeBack", lend })}><IconX font-size="18" /></button
                        >
                    </div>
                    <div class="pg-lent-r">
                        <span class="pg-tx">
                            <span class="pg-lab">{text.botsMay()}</span>
                            <span class="pg-cn wh"
                                >{mayOf(lend)} · {lend.usesPerDay === null
                                    ? text.noLimit()
                                    : text.usesADay({ count: lend.usesPerDay })}</span
                            >
                        </span>
                        <PageButton testId="appLendChange" on:click={() => (sheet = { kind: "change", lend })}
                            >{text.change()}</PageButton
                        >
                    </div>
                    {#if lend.bots.length === 0}
                        <p class="pg-cn pad">{text.noBotUsesIt({ app: app.name })}</p>
                    {:else}
                        {#each lend.bots as bot (bot.botId)}
                            <div class="pg-bot" data-testid="appLentBot">
                                <span class="pg-cn wh"
                                    >{text.botUses({ name: bot.botName, count: bot.usesThisMonth })}</span
                                >
                            </div>
                        {/each}
                        <p class="pg-cn pad">
                            {lend.usesPerDay === null
                                ? text.todayNoLimit({ used: lend.usedToday })
                                : text.todayOf({ used: lend.usedToday, limit: lend.usesPerDay })}
                        </p>
                    {/if}
                </div>
            {/each}
            {#if page.lentTo.length === 0}
                <PageNote>
                    {page.canLendTo.length > 0
                        ? text.noUniverseYet({ app: app.name })
                        : text.noUniverseToLend({ app: app.name })}
                </PageNote>
            {/if}
            {#if page.canLendTo.length > 0}
                <div class="pg-pad">
                    <PageButton tall testId="appLendGo" on:click={() => (sheet = { kind: "lend" })}
                        ><IconPlus font-size="18" />{text.lendTo()}</PageButton
                    >
                </div>
            {/if}
        {/if}

        <div class="pg-off">
            <PageButton tall danger testId="appDisconnect" on:click={() => (sheet = { kind: "disconnect" })}
                >{text.disconnect({ app: app.name })}</PageButton
            >
            <span class="pg-cn">{text.disconnectLine({ app: app.name })}</span>
        </div>
    {/if}
</AppsShell>

{#if app && sheet?.kind === "lend"}
    <LendSheet app={app.name} universes={page?.canLendTo ?? []} onSubmit={lend} onClose={() => (sheet = undefined)} />
{:else if app && sheet?.kind === "change"}
    <LendSheet app={app.name} current={sheet.lend} onSubmit={lend} onClose={() => (sheet = undefined)} />
{:else if app && sheet?.kind === "takeBack"}
    {@const lendOf = sheet.lend}
    <ConfirmSheet
        title={text.takeBackTitle({ app: app.name, universe: lendOf.universeName })}
        lines={[
            {
                text:
                    lendOf.bots.length === 1
                        ? text.takeBackBots({ bots: lendOf.bots[0].botName, app: app.name })
                        : text.takeBackBotsNone({ app: app.name }),
                bold: [text.atOnce()],
            },
            { text: text.takeBackAgain(), bold: [] },
        ]}
        note={text.takeBackNote({ app: app.name })}
        cancelLabel={text.cancel()}
        confirmLabel={text.takeBack()}
        onCancel={() => (sheet = undefined)}
        onConfirm={() => void takeBack(lendOf)}
        testId="appTakeBackSheet"
    />
{:else if app && sheet?.kind === "disconnect"}
    <ConfirmSheet
        title={text.disconnectTitle({ app: app.name })}
        lines={[{ text: text.disconnectLines({ app: app.name }), bold: [text.atOnce()] }]}
        note={text.disconnectNote({ app: app.name })}
        cancelLabel={text.cancel()}
        confirmLabel={text.disconnectConfirm()}
        onCancel={() => (sheet = undefined)}
        onConfirm={() => void disconnect()}
        testId="appDisconnectSheet"
    />
{/if}

<style>
    .pg-bad {
        margin: 0;
        padding: 0 4px;
        font-size: 13px;
        color: #ff8a7a;
    }
    .pg-pad {
        padding: 0 4px;
    }
    .pg-wide :global(.bp-btn) {
        width: 100%;
        height: 48px;
        font-size: 15px;
        font-weight: 700;
    }
    .pg-card {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px;
        border-radius: 14px;
        background: #0a0814;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    }
    .pg-ico {
        display: grid;
        place-items: center;
        flex: none;
        width: 32px;
        height: 32px;
        color: #fff;
    }
    .pg-ico.sm {
        width: 24px;
        height: 24px;
        color: rgba(167, 139, 250, 0.95);
    }
    .pg-tx {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }
    .pg-cap {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(244, 242, 250, 0.64);
    }
    .pg-mid {
        font-size: 15px;
        font-weight: 700;
    }
    .pg-t {
        font-size: 14px;
        font-weight: 600;
    }
    .pg-t.grow {
        flex: 1;
        font-size: 15px;
        overflow-wrap: anywhere;
    }
    .pg-cn {
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
    }
    .pg-cn.wh {
        color: #fff;
        font-size: 13.5px;
    }
    .pad {
        margin: 0;
        padding: 0 4px;
    }
    .pg-alert {
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
    .pg-alert :global(svg) {
        flex: none;
        margin-top: 1px;
    }
    .pg-alert .pg-t {
        color: #fff;
    }
    .pg-lent {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 0 2px;
        padding: 10px 10px 12px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.04);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
    }
    .pg-lent-h {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .pg-x {
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        margin: -8px -6px -8px 0;
        padding: 0;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: #fff;
        cursor: pointer;
    }
    .pg-x:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: -2px;
    }
    .pg-lent-r {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 6px 6px 12px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.04);
    }
    .pg-lab {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(244, 242, 250, 0.6);
    }
    .pg-bot {
        padding: 0 4px;
    }
    .pg-off {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
        margin-top: 8px;
        padding: 10px 4px 0;
        border-top: 1px solid rgb(255 255 255 / 0.06);
    }
</style>
