<script lang="ts">
    import { onMount } from "svelte";
    import LL, { locale } from "../../../i18n/i18n-svelte";
    import PanelHeader from "../../Components/MapEditor/EditMode/PanelHeader.svelte";
    import PageButton from "../../external-modules/bots/components/page/PageButton.svelte";
    import { warningMessageStore } from "../../Stores/ErrorStore";
    import { brickDidList, sayRun, type DidRun } from "./BrickDid";
    import { IconAlertTriangle, IconCircleCheck, IconClock, IconMessage } from "@wa-icons";
    import "./BrickGroups.css";

    /**
     * "Everything Brick did" (game #2002, mock t-5-closed): every run this Brick made by itself for its owner, newest
     * first, failed runs and quiet checks included. Opened from the row under Done on its Goals and tasks. Only reads:
     * nothing here changes a goal; that is on its Goals and tasks.
     */
    export let botId: string;
    export let name: string;
    export let onBack: () => void;

    const list = brickDidList(botId);
    const { runs, state, more, loadingMore } = list;

    onMount(() => {
        list.load().catch((error) => console.error(error));
    });

    function showMore() {
        list.loadMore()
            .then((read) => {
                if (!read) warningMessageStore.addWarningMessage($LL.chat.brick.goals.didLoadFailed({ name }));
            })
            .catch((error) => console.error(error));
    }

    // A failed run says so first; a run that said something or needed the person has its own look
    const iconOf = (run: DidRun) =>
        run.state === "failed"
            ? IconAlertTriangle
            : run.state === "done" && run.outcome === "spoke"
            ? IconMessage
            : run.state === "done" && run.outcome !== "waiting"
            ? IconCircleCheck
            : IconClock;
</script>

<div class="dp flex h-full min-h-0 flex-col" data-testid="brickDidPage">
    <PanelHeader
        title={$LL.chat.brick.goals.didRow({ name })}
        {onBack}
        backLabel={$LL.chat.brick.goals.didBack({ name })}
        canHide={false}
    />
    <div class="body bkg">
        {#if $state === "failed"}
            <div class="bkg-retry">
                <p class="bkg-lead" data-testid="brickDidFailed">{$LL.chat.brick.goals.didLoadFailed({ name })}</p>
                <PageButton testId="brickDidRetry" on:click={() => list.load()}
                    >{$LL.chat.brick.goals.retry()}</PageButton
                >
            </div>
        {:else if $state === "loading"}
            <p class="bkg-lead" data-testid="brickDidLoading">{$LL.chat.brick.loading()}</p>
        {:else if $runs.length === 0}
            <p class="bkg-lead" data-testid="brickDidNone">{$LL.chat.brick.goals.didNone({ name })}</p>
        {:else}
            {#each $runs as run (run.runId)}
                <div class="bkg-tap" data-testid="brickDidRun" data-state={run.state}>
                    <span class="bkg-ico" class:bad={run.state === "failed"}>
                        <svelte:component this={iconOf(run)} font-size="20" />
                    </span>
                    <span class="bkg-mtx"
                        ><span class="bkg-t">{run.words}</span><span class="bkg-cn"
                            >{sayRun(run, Date.now(), $LL, $locale)}</span
                        ></span
                    >
                </div>
            {/each}
        {/if}
        <!-- Older runs are reached from here even when the first page held none that could be read -->
        {#if $more && $state === "ready"}
            <button
                type="button"
                class="bkg-tap"
                data-testid="brickDidMore"
                disabled={$loadingMore}
                on:click={showMore}
            >
                <span class="bkg-mtx"><span class="bkg-t">{$LL.chat.brick.goals.didMore()}</span></span>
            </button>
        {/if}
    </div>
</div>

<style>
    .dp {
        box-sizing: border-box;
        gap: 10px;
        padding: 12px 14px 14px;
        color: #fff;
    }
    .body {
        min-height: 0;
        overflow-y: auto;
        padding: 0;
    }
    .bad {
        color: #ff8a7a;
    }
</style>
