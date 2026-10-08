<script lang="ts">
    import { showReportScreenStore, userReportEmpty, reportSentToastStore } from "../../Stores/ShowReportScreenStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { LL } from "../../../i18n/i18n-svelte";
    import { IconFlag } from "@wa-icons";

    export let userUUID: string | undefined;
    export let userName: string | undefined;
    export let worldName: string;

    let reportMessage = "";
    let hiddenUuidError = true;

    function submitReport() {
        hiddenUuidError = true;

        if (reportMessage.trim() === "") return;
        if (userUUID === undefined) {
            hiddenUuidError = false;
            console.error("User UUID is not valid.");
            return;
        }
        const message = `
                -- Date: ${new Date().getTime()} -- \r
                -- Reporter: ${gameManager.getPlayerName()} -- \r
                -- Reported: ${userName} -- \n\r
                ${reportMessage}
            `;
        gameManager.getCurrentGameScene().connection?.emitReportPlayerMessage(userUUID, message);
        showReportScreenStore.set(userReportEmpty);
        reportSentToastStore.set(worldName);
    }
</script>

<section class="flex items-start gap-3 px-5 pb-5 pt-4">
    <span class="report-tile" aria-hidden="true"><IconFlag font-size="18" /></span>
    <form class="min-w-0 flex-1" on:submit|preventDefault={submitReport}>
        <p class="m-0 text-sm font-semibold">{$LL.report.popup.report.title({ worldName })}</p>
        <p class="m-0 mt-0.5 text-xs leading-5 text-white/65">{$LL.report.popup.report.content()}</p>
        <textarea
            bind:value={reportMessage}
            rows="3"
            placeholder={$LL.report.popup.report.placeholder()}
            aria-label={$LL.report.popup.report.placeholder()}
            data-testid="report-message"
            class="report-field m-0 mt-3 block w-full resize-none rounded-[12px] border-0 px-3 py-2.5 text-sm text-white placeholder:text-white/40 focus:outline-none"
        />
        {#if !hiddenUuidError}
            <p class="m-0 mt-2 text-xs text-pop-red">{$LL.report.message.error()}</p>
        {/if}
        <button
            type="submit"
            data-testid="report-send-button"
            class="u-cta m-0 mt-3 flex h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-bold disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none"
            disabled={reportMessage.trim() === ""}>{$LL.report.popup.report.send()}</button
        >
    </form>
</section>

<style>
    .report-tile {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: 2.25rem;
        height: 2.25rem;
        border-radius: 0.75rem;
        color: #fff;
        background: linear-gradient(135deg, #8629fc, #4156f6);
        box-shadow: 0 8px 20px -8px rgba(134, 41, 252, 0.8);
    }
    .report-field {
        font-family: inherit;
        background: rgba(0, 0, 0, 0.28);
        box-shadow: inset 0 0 0 1px var(--u-surface-edge);
    }
    .report-field:focus {
        box-shadow: inset 0 0 0 1px rgba(196, 181, 253, 0.7);
    }
</style>
