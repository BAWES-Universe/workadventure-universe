<script lang="ts">
    import { fly } from "svelte/transition";
    import { closeModal } from "svelte-modals";
    import LL from "../../../i18n/i18n-svelte";
    import PageButton from "../../external-modules/bots/components/page/PageButton.svelte";
    import { canTakeBack, type BrickReport } from "./BrickReport";
    import {
        readReportStatus,
        sendReportWords,
        sentReportWords,
        takeBackReport,
        takenBackReports,
    } from "./BrickReportStore";
    import { keepFocusInside } from "./keepFocusInside";
    import { IconX } from "@wa-icons";
    import "./BrickGroups.css";

    /**
     * What a Brick sent to the Universe team (mock "Brick reports inbox", screen 7): the note exactly as Orbit kept it (product-only), what
     * is never sent, the person's own words when they asked to tell the team something (shown exactly as they would go, sent only when they
     * press Send), and Take it back for 24 hours. Anyone in the chat can. Opening it reads from Orbit what became of the note, so a note
     * taken back or words sent on another device show here. These are the only controls, and they are per note, not settings.
     */
    export let isOpen: boolean;
    export let report: BrickReport;
    export let messageAt: number | null = null;

    let busy = false;
    let problem: "failed" | "too_late" | null = null;
    let sendingWords = false;
    let wordsProblem: "failed" | "too_late" | null = null;

    $: taken = $takenBackReports.has(report.id);
    $: offerTakeBack = !taken && canTakeBack(report, messageAt, Date.now());
    $: wordsSent = $sentReportWords.get(report.id);
    $: offerWords = !taken && !wordsSent && !!report.wordsDraft && canTakeBack(report, messageAt, Date.now());

    // What became of the note, from Orbit: nothing changes when it can't say
    void readReportStatus(report.id, report.key).catch(() => undefined);

    function sendWords() {
        if (sendingWords) return;
        sendingWords = true;
        wordsProblem = null;
        sendReportWords(report.id, report.key, report.wordsDraft)
            .then((outcome) => {
                if (outcome === "failed" || outcome === "too_late") wordsProblem = outcome;
            })
            .catch(() => (wordsProblem = "failed"))
            .finally(() => (sendingWords = false));
    }

    function takeBack() {
        if (busy) return;
        busy = true;
        problem = null;
        takeBackReport(report.id, report.key)
            .then((outcome) => {
                if (outcome === "taken") closeModal();
                else problem = outcome;
            })
            .catch(() => (problem = "failed"))
            .finally(() => (busy = false));
    }
</script>

{#if isOpen}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="rs-scrim" on:click|self={closeModal}>
        <div
            class="rs u-surface"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-sheet-title"
            data-testid="brickReportSheet"
            use:keepFocusInside={closeModal}
            transition:fly={{ y: 16, duration: 200 }}
        >
            <button
                type="button"
                class="u-close absolute top-2 end-2"
                aria-label={$LL.chat.brick.report.close()}
                data-testid="brickReportClose"
                on:click={closeModal}
            >
                <IconX font-size="20" />
            </button>
            <h2 id="report-sheet-title" class="u-display rs-title">{$LL.chat.brick.report.sheetTitle()}</h2>
            <dl class="rs-fields">
                <div>
                    <dt>{$LL.chat.brick.report.kind()}</dt>
                    <dd data-testid="brickReportKind">
                        {$LL.chat.brick.report.kinds[report.kind]()} · {$LL.chat.brick.report.areas[report.area]()}
                    </dd>
                </div>
                <div>
                    <dt>{$LL.chat.brick.report.title()}</dt>
                    <dd data-testid="brickReportTitle">{report.title}</dd>
                </div>
                {#if report.retried}
                    <div>
                        <dt>{$LL.chat.brick.report.retried()}</dt>
                        <dd data-testid="brickReportRetried">{$LL.chat.brick.report.retriedYes()}</dd>
                    </div>
                {/if}
                {#if !taken && wordsSent}
                    <div>
                        <dt>{$LL.chat.brick.report.words()}</dt>
                        <dd data-testid="brickReportWordsSent">{wordsSent}</dd>
                    </div>
                {:else if offerWords}
                    <div>
                        <dt>{$LL.chat.brick.report.wordsNotSent()}</dt>
                        <dd data-testid="brickReportWordsDraft">{report.wordsDraft}</dd>
                    </div>
                {/if}
            </dl>
            <p class="rs-never">{$LL.chat.brick.report.never()}</p>
            {#if taken}
                <p class="rs-note" data-testid="brickReportSheetTakenBack">{$LL.chat.brick.report.takenBack()}</p>
            {/if}
            {#if offerWords}
                <p class="rs-note">{$LL.chat.brick.report.wordsExact()}</p>
            {/if}
            {#if wordsProblem}
                <p class="rs-note" role="alert" data-testid="brickReportWordsProblem">
                    {wordsProblem === "too_late"
                        ? $LL.chat.brick.report.tooLateWords()
                        : $LL.chat.brick.report.wordsFailed()}
                </p>
            {/if}
            {#if problem}
                <p class="rs-note" role="alert" data-testid="brickReportProblem">
                    {problem === "too_late" ? $LL.chat.brick.report.tooLate() : $LL.chat.brick.report.takeBackFailed()}
                </p>
            {/if}
            <div class="rs-btns">
                {#if offerWords && wordsProblem !== "too_late"}
                    <PageButton tall go disabled={sendingWords} testId="brickReportSendWords" on:click={sendWords}
                        >{$LL.chat.brick.report.sendWords()}</PageButton
                    >
                {/if}
                <PageButton tall go={!offerWords} testId="brickReportDone" on:click={closeModal}
                    >{$LL.chat.brick.report.done()}</PageButton
                >
                {#if offerTakeBack && problem !== "too_late"}
                    <PageButton tall danger disabled={busy} testId="brickReportTakeBack" on:click={takeBack}
                        >{$LL.chat.brick.report.takeBack()}</PageButton
                    >
                {/if}
            </div>
        </div>
    </div>
{/if}

<style>
    .rs-scrim {
        position: fixed;
        inset: 0;
        z-index: 2001;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        background: rgba(0, 0, 0, 0.5);
        pointer-events: auto;
    }
    .rs {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 12px;
        box-sizing: border-box;
        width: 100%;
        max-width: 428px;
        max-height: 100%;
        margin: 0;
        padding: 20px;
        overflow-y: auto;
        border-radius: 20px;
        color: #fff;
        text-align: start;
        font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    @media (max-width: 640px) {
        .rs-scrim {
            align-items: flex-end;
            padding: 0;
        }
        .rs {
            max-width: none;
            padding-bottom: calc(20px + env(safe-area-inset-bottom));
            border-radius: 20px 20px 0 0;
        }
    }
    .rs-title {
        margin: 0;
        padding-inline-end: 40px;
        font-size: 1.25rem;
        line-height: 1.15;
        font-weight: 800;
        text-transform: none;
        letter-spacing: normal;
        font-family: inherit;
    }
    .rs-fields {
        display: grid;
        gap: 10px;
        margin: 0;
    }
    .rs-fields dt {
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: rgba(244, 242, 250, 0.64);
    }
    .rs-fields dd {
        margin: 2px 0 0;
        font-size: 14px;
        line-height: 1.4;
        overflow-wrap: anywhere;
    }
    .rs-never,
    .rs-note {
        margin: 0;
        font-size: 12.5px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.64);
    }
    .rs-btns {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-start;
        gap: 10px;
        margin-top: 4px;
    }
</style>
