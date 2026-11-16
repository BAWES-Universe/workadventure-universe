<script lang="ts">
    import { onMount } from "svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import PageButton from "../../../external-modules/bots/components/page/PageButton.svelte";
    import PageNote from "../../../external-modules/bots/components/page/PageNote.svelte";
    import { botApiService } from "../../../external-modules/bots/services/BotApiService";
    import { warningMessageStore } from "../../../Stores/ErrorStore";
    import BrickPicture from "../BrickPicture.svelte";
    import { parseShare, pickedTitles, shareRefusal, type Share, type ShareJobChoice } from "./AppShare";
    import AppRow from "./AppRow.svelte";
    import ShareSheet from "./ShareSheet.svelte";
    import { IconUsers } from "@wa-icons";

    /**
     * "Other people" for one Brick of the owner's on one of their apps (game #2006, mock Part 17): "Only you" with one button to
     * let people who chat with the Brick use it; then what they can ask for, the two limits, today's uses, a way to change them
     * and "Stop letting others use it", which takes effect at once with nothing to confirm. Whatever Orbit says is shown; the
     * app's link, key and account never reach this page.
     */
    export let appId: string;
    export let appName: string;
    export let botId: string;
    export let brickName: string;
    export let look: string | null = null;

    $: text = $LL.chat.brick.apps;
    $: words = $LL.chat.brick.apps.share;
    let share: Share | undefined;
    let loadFailed = false;
    let busy = false;
    let sheet: "start" | "change" | undefined;
    let refusal = "";
    let reading = 0;

    async function load() {
        const mine = ++reading;
        try {
            const parsed = parseShare(await botApiService.getAppShare(appId, botId));
            if (mine !== reading) return;
            if (parsed) share = parsed;
            loadFailed = !parsed;
        } catch (error) {
            if (mine !== reading) return;
            console.warn("Could not read what is shared", error);
            loadFailed = true;
        }
    }

    type Change = { jobs?: ShareJobChoice[]; usesPerDayEveryone?: number; usesPerDayPerson?: number };

    /** Starts or changes what is shared; the answer is the new state. False when Orbit would not (its words are kept for the sheet). */
    async function send(how: "start" | "change", change: Change): Promise<boolean> {
        if (busy) return false;
        busy = true;
        refusal = "";
        try {
            const answer =
                how === "start"
                    ? await botApiService.startAppShare(appId, botId, change)
                    : await botApiService.changeAppShare(appId, botId, change);
            const parsed = parseShare(answer);
            if (parsed) {
                share = parsed;
                loadFailed = false;
            } else {
                await load();
            }
            return true;
        } catch (error) {
            console.warn("What is shared was not changed", error);
            refusal = shareRefusal(error, text.workFailed());
            if (!sheet) warningMessageStore.addWarningMessage(refusal);
            return false;
        } finally {
            // eslint-disable-next-line require-atomic-updates
            busy = false;
        }
    }

    async function submit(change: Change & { jobs: ShareJobChoice[] }): Promise<boolean> {
        const done = await send(sheet === "start" ? "start" : "change", change);
        // eslint-disable-next-line require-atomic-updates
        if (done) sheet = undefined;
        return done;
    }

    /** "Let others use it": an app with one thing to ask for starts at once; with more, the owner picks first. */
    async function start() {
        if (!share || busy) return;
        if (share.jobs.length === 1) await send("start", {});
        else sheet = "start";
    }

    /** "Stop letting others use it": at once, with nothing to confirm; every later ask is refused, also in a chat already open. */
    async function stop() {
        if (busy) return;
        busy = true;
        try {
            await botApiService.stopAppShare(appId, botId);
        } catch (error) {
            console.warn("Sharing was not stopped", error);
            warningMessageStore.addWarningMessage(text.workFailed());
            return;
        } finally {
            // eslint-disable-next-line require-atomic-updates
            busy = false;
        }
        await load();
    }

    onMount(() => {
        load().catch((error) => console.error(error));
    });
</script>

<div class="sb" data-testid="appShare">
    {#if !share}
        {#if loadFailed}
            <p class="sb-bad" data-testid="appShareLoadFailed">{words.loadFailed()}</p>
            <div class="sb-pad">
                <PageButton testId="appShareTryAgain" on:click={() => void load()}>{text.tryAgain()}</PageButton>
            </div>
        {:else}
            <PageNote>{text.loading()}</PageNote>
        {/if}
    {:else if !share.shareable}
        <AppRow title={text.onlyYou()} hint={text.onlyYouLine()} icon={IconUsers} testId="appOnlyYou" />
    {:else if !share.shared}
        <AppRow title={text.onlyYou()} hint={words.offLine({ brick: brickName })} testId="appShareOff">
            <BrickPicture slot="picture" {look} size={32} />
            {#if share.reachable && share.jobs.length > 0}
                <PageButton disabled={busy} testId="appShareStart" on:click={() => void start()}
                    >{words.start()}</PageButton
                >
            {/if}
        </AppRow>
        {#if !share.reachable}
            <div data-testid="appShareUnreachable"><PageNote>{words.unreachable({ app: appName })}</PageNote></div>
        {:else if share.jobs.length === 0}
            <div data-testid="appShareNothing"><PageNote>{words.nothing({ app: appName })}</PageNote></div>
        {/if}
    {:else}
        <AppRow
            title={words.on({ brick: brickName })}
            hint={words.canAsk({ jobs: pickedTitles(share).join(", ") })}
            testId="appShareOn"
        >
            <BrickPicture slot="picture" {look} size={32} />
            <PageButton disabled={busy} testId="appShareChange" on:click={() => (sheet = "change")}
                >{text.change()}</PageButton
            >
        </AppRow>
        <p class="sb-cn" data-testid="appShareLimits">
            {words.limits({ everyone: share.usesPerDayEveryone, person: share.usesPerDayPerson })}
        </p>
        <p class="sb-cn" data-testid="appShareToday">
            {words.today({ used: share.usedToday, limit: share.usesPerDayEveryone })}
        </p>
        <div class="sb-pad sb-wide">
            <PageButton tall danger disabled={busy} testId="appShareStop" on:click={() => void stop()}
                >{words.stop()}</PageButton
            >
        </div>
        <p class="sb-cn" data-testid="appShareStopLine">{words.stopLine({ app: appName })}</p>
    {/if}
</div>

{#if share && sheet}
    <ShareSheet
        app={appName}
        brick={brickName}
        {share}
        starting={sheet === "start"}
        {refusal}
        onSubmit={submit}
        onClose={() => (sheet = undefined)}
    />
{/if}

<style>
    .sb {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .sb-bad {
        margin: 0;
        padding: 0 4px;
        font-size: 13px;
        color: #ff8a7a;
    }
    .sb-pad {
        padding: 0 4px;
    }
    .sb-wide :global(.bp-btn) {
        width: 100%;
    }
    .sb-cn {
        margin: 0;
        padding: 0 8px;
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
    }
</style>
