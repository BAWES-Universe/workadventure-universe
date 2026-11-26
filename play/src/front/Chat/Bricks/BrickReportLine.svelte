<script lang="ts">
    import { onMount } from "svelte";
    import { openModal } from "svelte-modals";
    import LL from "../../../i18n/i18n-svelte";
    import { canTakeBack, type BrickReport } from "./BrickReport";
    import { readReportStatusOnce, takenBackReports } from "./BrickReportStore";
    import BrickReportSheet from "./BrickReportSheet.svelte";
    import { IconCheck } from "@wa-icons";

    /**
     * Under a Brick's answer that sent a note to the Universe team (mock "Brick reports inbox", screen 6): "Sent to the Universe team ·
     * See what was sent", one line per note. Taken back, here or on another device, it says so: a note still within its 24 hours is read
     * from Orbit once when its line is drawn.
     */
    export let reports: BrickReport[];
    /** When the answer was sent (ms), for a note that does not say. */
    export let messageAt: number | null;

    onMount(() => {
        for (const report of reports) {
            if (canTakeBack(report, messageAt, Date.now())) void readReportStatusOnce(report.id, report.key);
        }
    });

    function open(report: BrickReport) {
        openModal(BrickReportSheet, { report, messageAt });
    }
</script>

<div class="brl" data-testid="brickReportLines">
    {#each reports as report (report.id)}
        <div class="brl-row" data-testid="brickReportLine">
            <IconCheck font-size="14" aria-hidden="true" />
            {#if $takenBackReports.has(report.id)}
                <span data-testid="brickReportTakenBack">{$LL.chat.brick.report.takenBack()}</span>
            {:else}
                <span>{$LL.chat.brick.report.sent()}</span>
                <span aria-hidden="true">·</span>
                <button type="button" class="brl-see" data-testid="brickReportSee" on:click={() => open(report)}
                    >{$LL.chat.brick.report.seeWhat()}</button
                >
            {/if}
        </div>
    {/each}
</div>

<style>
    /* Under the answer, in line with its words */
    .brl {
        display: grid;
        gap: 2px;
        margin: 0 16px 8px 52px;
    }
    :global([dir="rtl"]) .brl {
        margin: 0 52px 8px 16px;
    }
    .brl-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.64);
    }
    .brl-see {
        min-height: 32px;
        margin: 0;
        padding: 0;
        border: 0;
        background: none;
        font: inherit;
        font-weight: 600;
        color: #9db0ff;
        cursor: pointer;
    }
    .brl-see:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
        border-radius: 4px;
    }
    @media (pointer: coarse) {
        .brl-see {
            min-height: 44px;
        }
    }
</style>
