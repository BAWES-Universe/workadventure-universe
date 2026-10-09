<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import type { Unsubscriber } from "svelte/store";
    import { get } from "svelte/store";
    import { fly } from "svelte/transition";
    import { connectionManager } from "../../Connection/ConnectionManager";
    import { showReportScreenStore, userReportEmpty } from "../../Stores/ShowReportScreenStore";
    import { currentWorldNameStore, worldSlugFromRoomUrl } from "../../Stores/WorldNameStore";
    import { LL } from "../../../i18n/i18n-svelte";
    import ReportSubMenu from "./ReportSubMenu.svelte";
    import BlockSubMenu from "./BlockSubMenu.svelte";
    import { IconX } from "@wa-icons";

    let disableReport = false;
    let userUUID: string | undefined = get(showReportScreenStore).userUuid;
    let userName = "No name";
    let unsubscriber: Unsubscriber;

    // The world's name from the Explore list, else its slug in the room URL.
    $: worldName =
        $currentWorldNameStore ||
        worldSlugFromRoomUrl(connectionManager.currentRoom?.key) ||
        $LL.report.popup.thisWorld();

    onMount(() => {
        unsubscriber = showReportScreenStore.subscribe((reportScreenStore) => {
            if (reportScreenStore != null) {
                userName = reportScreenStore.userName;
                userUUID = reportScreenStore.userUuid;
                if (userUUID === undefined && reportScreenStore !== userReportEmpty) {
                    console.error("Could not find UUID for user with ID " + reportScreenStore.userUuid);
                }
            }
        });
        disableReport = !connectionManager.currentRoom?.canReport;
    });

    onDestroy(() => {
        if (unsubscriber) {
            unsubscriber();
        }
    });

    function close() {
        showReportScreenStore.set(userReportEmpty);
    }

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            close();
        }
    }
</script>

<svelte:window on:keydown={onKeyDown} />

<!-- Block or report: one popup under the bar, the player's name on top. -->
<div
    class="report-menu-main u-surface pointer-events-auto absolute left-0 right-0 top-3 md:top-16 z-[650] mx-auto flex w-[min(400px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl text-white"
    transition:fly={{ y: -50, duration: 300 }}
    role="dialog"
    aria-labelledby="report-title"
>
    <header class="flex items-center gap-3 px-5 pt-4">
        <h2 id="report-title" class="m-0 flex-1 truncate text-base font-bold normal-case tracking-normal">
            {userName}
        </h2>
        <button type="button" class="u-close -mr-2" aria-label={$LL.report.popup.close()} on:click={close}
            ><IconX font-size="20" /></button
        >
    </header>

    <BlockSubMenu {userUUID} {userName} />
    {#if !disableReport}
        <div class="mx-5 h-px bg-white/[0.08]" aria-hidden="true" />
        <ReportSubMenu {userUUID} {userName} {worldName} />
    {/if}
</div>
