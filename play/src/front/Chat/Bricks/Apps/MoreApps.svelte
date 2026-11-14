<script lang="ts">
    import { onMount } from "svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import PageButton from "../../../external-modules/bots/components/page/PageButton.svelte";
    import PageNote from "../../../external-modules/bots/components/page/PageNote.svelte";
    import { botApiService } from "../../../external-modules/bots/services/BotApiService";
    import { warningMessageStore } from "../../../Stores/ErrorStore";
    import { parseAvailableApps, type AvailableApp } from "./Apps";
    import { appIcon } from "./AppIcon";
    import AppRow from "./AppRow.svelte";
    import { refusalWords } from "./AppWords";

    /**
     * "More apps it can use here" (game #2001), inside a room bot's Apps group, under the bot's own apps: the apps lent to its
     * universe by the person looking (shown only to them) and the universe's own apps they manage, that this bot does not use
     * yet. "Let Guide use it" is the only way a bot starts using one: lending moves no bot. Shows nothing for a Brick, for
     * someone who cannot manage this bot, and while there is nothing to offer.
     */
    export let botId: string;
    export let botName: string;
    /** Told after a bot started using an app, so the bot's own list of apps reads again */
    export let onLet: () => void;

    $: text = $LL.chat.brick.apps;
    let apps: AvailableApp[] = [];
    let busyId: string | undefined;

    async function load() {
        const asked = botId;
        try {
            const parsed = parseAvailableApps(await botApiService.getAppsABotCouldUse(asked));
            if (asked === botId) apps = parsed ?? [];
        } catch {
            // A Brick, or a person who cannot manage this bot, is answered 404: nothing to offer
            if (asked === botId) apps = [];
        }
    }

    async function letUse(app: AvailableApp) {
        if (busyId) return;
        busyId = app.connectionId;
        try {
            await botApiService.letBotUseApp(botId, app.connectionId);
            onLet();
        } catch (error) {
            console.warn("Could not let the bot use the app", error);
            warningMessageStore.addWarningMessage(refusalWords(error, text.workFailed()));
        } finally {
            // eslint-disable-next-line require-atomic-updates
            busyId = undefined;
        }
        await load();
    }

    // The group is shown for one bot at a time: it is made again for the next one
    onMount(() => {
        if (botApiService.isInitialized()) load().catch((error) => console.error(error));
    });
</script>

{#if apps.length > 0}
    <div class="ma" data-testid="moreApps">
        <div class="ma-sec">{text.moreApps()}</div>
        {#each apps as app (app.connectionId)}
            <AppRow
                title={app.name}
                icon={appIcon(app.name)}
                hint={app.kind === "lent" ? text.lentByYou() : text.belongsToUniverse()}
                testId="moreAppsRow"
            >
                <PageButton disabled={busyId !== undefined} testId="moreAppsLet" on:click={() => void letUse(app)}
                    >{text.letBotUse({ name: botName })}</PageButton
                >
            </AppRow>
        {/each}
        <PageNote>{text.moreAppsNote()}</PageNote>
    </div>
{/if}

<style>
    .ma {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin: 4px 0 8px;
        padding-top: 4px;
        border-top: 1px solid rgb(255 255 255 / 0.06);
    }
    .ma-sec {
        padding: 0 4px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(244, 242, 250, 0.5);
        min-height: 36px;
        display: flex;
        align-items: center;
    }
</style>
