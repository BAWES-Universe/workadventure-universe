<script lang="ts">
    import { onMount } from "svelte";
    import { fly } from "svelte/transition";
    import { closeModal } from "svelte-modals";
    import LL from "../../../i18n/i18n-svelte";
    import PageButton from "../../external-modules/bots/components/page/PageButton.svelte";
    import { warningMessageStore } from "../../Stores/ErrorStore";
    import { botMemoryList, type MemoryItem } from "./BotMemory";
    import { keepFocusInside } from "./keepFocusInside";
    import MemoryRows from "./MemoryRows.svelte";
    import { IconX } from "@wa-icons";
    import "./BrickGroups.css";

    /**
     * What a bot remembers about the person, opened from the bot's chat menu ("What Melody remembers about you"): the
     * same list as on a Brick's own page (game #2003). Only the person sees it. The bot's owner cannot, and the sheet
     * says so.
     */
    export let isOpen: boolean;
    export let botId: string;
    export let name: string;
    /** Who made the bot, when the chat knows. */
    export let owner: string | undefined = undefined;
    /** The bot is the person's own Brick: nobody else made it. */
    export let own = false;

    const list = botMemoryList(botId);
    const { items, state } = list;
    let asking = false;
    let busy = false;

    onMount(() => {
        list.load().catch((error) => console.error(error));
    });

    function forget(item: MemoryItem) {
        list.forget(item.id)
            .then((gone) => {
                if (!gone) warningMessageStore.addWarningMessage($LL.chat.brick.memory.forgotFailed());
            })
            .catch((error) => console.error(error));
    }

    function forgetEverything() {
        if (busy) return;
        busy = true;
        list.forgetEverything()
            .then((gone) => {
                if (gone) asking = false;
                else warningMessageStore.addWarningMessage($LL.chat.brick.memory.forgotFailed());
            })
            .catch((error) => console.error(error))
            .finally(() => {
                busy = false;
            });
    }
</script>

{#if isOpen}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="ms-scrim" on:click|self={closeModal}>
        <div
            class="ms u-surface"
            role="dialog"
            aria-modal="true"
            aria-labelledby="memory-sheet-title"
            data-testid="memorySheet"
            use:keepFocusInside={closeModal}
            transition:fly={{ y: 16, duration: 200 }}
        >
            <button
                type="button"
                class="u-close absolute top-2 end-2"
                aria-label={$LL.chat.brick.memory.close()}
                data-testid="memorySheetClose"
                on:click={closeModal}
            >
                <IconX font-size="20" />
            </button>
            <h2 id="memory-sheet-title" class="u-display ms-title">{$LL.chat.brick.memory.sheetTitle({ name })}</h2>
            <p class="ms-sub">
                {own
                    ? $LL.chat.brick.memory.sheetOnlyYouOwn()
                    : owner
                    ? $LL.chat.brick.memory.sheetOnlyYou({ owner, name })
                    : $LL.chat.brick.memory.sheetOnlyYouNoOwner({ name })}
            </p>
            <div class="ms-list">
                {#if $state === "failed"}
                    <div class="bkg-retry">
                        <p class="bkg-lead">{$LL.chat.brick.memory.loadFailed({ name })}</p>
                        <PageButton testId="memoryRetry" on:click={() => list.load()}
                            >{$LL.chat.brick.memory.retry()}</PageButton
                        >
                    </div>
                {:else if $state === "ready" && $items.length === 0}
                    <p class="bkg-lead" data-testid="memoryEmpty">{$LL.chat.brick.memory.leadNone({ name })}</p>
                {:else if $state === "ready"}
                    <MemoryRows items={$items} onForget={forget} />
                {/if}
            </div>
            {#if asking}
                <p class="ms-ask" role="alert" data-testid="memoryAsk">{$LL.chat.brick.memory.startsFresh({ name })}</p>
            {/if}
            <div class="ms-btns">
                {#if $items.length > 0}
                    {#if asking}
                        <PageButton tall disabled={busy} testId="memoryKeep" on:click={() => (asking = false)}
                            >{$LL.mapEditor.edit.bots.page.about.keep()}</PageButton
                        >
                        <PageButton
                            tall
                            danger
                            disabled={busy}
                            testId="memoryForgetEverythingConfirm"
                            on:click={forgetEverything}>{$LL.chat.brick.memory.forgetEverything()}</PageButton
                        >
                    {:else}
                        <PageButton tall danger testId="memoryForgetEverything" on:click={() => (asking = true)}
                            >{$LL.chat.brick.memory.forgetEverything()}</PageButton
                        >
                    {/if}
                {/if}
                <PageButton tall go testId="memoryDone" on:click={closeModal}>{$LL.chat.brick.memory.done()}</PageButton
                >
            </div>
        </div>
    </div>
{/if}

<style>
    .ms-scrim {
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
    .ms {
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
        .ms-scrim {
            align-items: flex-end;
            padding: 0;
        }
        .ms {
            max-width: none;
            padding-bottom: calc(20px + env(safe-area-inset-bottom));
            border-radius: 20px 20px 0 0;
        }
    }
    .ms-title {
        margin: 0;
        padding-inline-end: 40px;
        font-size: 1.25rem;
        line-height: 1.15;
        font-weight: 800;
        text-transform: none;
        letter-spacing: normal;
        font-family: inherit;
    }
    .ms-sub {
        margin: -6px 0 0;
        font-size: 13.5px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.64);
    }
    .ms-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .ms-ask {
        margin: 0;
        font-size: 13px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.8);
    }
    .ms-btns {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 4px;
    }
</style>
