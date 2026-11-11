<script lang="ts">
    import LL, { locale } from "../../../i18n/i18n-svelte";
    import PanelHeader from "../../Components/MapEditor/EditMode/PanelHeader.svelte";
    import PageButton from "../../external-modules/bots/components/page/PageButton.svelte";
    import { warningMessageStore } from "../../Stores/ErrorStore";
    import { shortDay, type BrickCard } from "./Brick";
    import { openBrickChat } from "./BrickChat";
    import BrickPicture from "./BrickPicture.svelte";
    import { brickUndoDays, deleteMyBrick } from "./MyBricksStore";
    import { IconChevronRight, IconMessage, IconTrash } from "@wa-icons";

    /**
     * A Brick's own page (game #1996), opened from the Bricks page: its chat one tap away, when it was made, and Delete
     * with its question in place, as on today's bot page. Delete asks once and says what goes, what stays and until
     * when Undo works. What a Brick can use (apps, a computer, goals) gets its rows here with the issues that build them.
     */
    export let brick: BrickCard;
    export let onBack: () => void;
    /** Called once the Brick is deleted: the Bricks page shows it under Deleted. */
    export let onDeleted: () => void;

    const DAY_MS = 24 * 60 * 60 * 1000;

    let asking = false;
    let deleting = false;

    $: made = shortDay(brick.createdAt, $locale);
    $: undoUntil = $brickUndoDays ? shortDay(Date.now() + $brickUndoDays * DAY_MS, $locale) : "";

    function openChat() {
        openBrickChat(brick.id).catch((error) => console.error(error));
    }

    function onDelete() {
        if (deleting) return;
        deleting = true;
        deleteMyBrick(brick.id)
            .then((gone) => {
                if (gone) onDeleted();
                else warningMessageStore.addWarningMessage($LL.chat.brick.deleteFailed());
            })
            .catch((error) => console.error(error))
            .finally(() => {
                deleting = false;
            });
    }
</script>

<div class="bkp flex h-full min-h-0 flex-col" data-testid="brickPage">
    <PanelHeader title={brick.name} {onBack} backLabel={$LL.chat.brick.backToBricks()} canHide={false} />
    <div class="bkp-scroll">
        <div class="bkp-top">
            <span class="bkp-pic"><BrickPicture look={brick.characterTextureId} size={44} /></span>
            <span class="bkp-tx">
                <span class="bkp-name">{brick.name}</span>
                {#if brick.description}<span class="bkp-line">{brick.description}</span>{/if}
            </span>
        </div>
        <button type="button" class="bkp-row" data-testid="brickPageChat" on:click={openChat}>
            <span class="bkp-ic"><IconMessage font-size="22" /></span>
            <span class="bkp-row-t">{$LL.chat.brick.openItsChat()}</span>
            <span class="bkp-go"><IconChevronRight font-size="18" /></span>
        </button>

        <footer class="bkp-foot">
            {#if made}<p class="bkp-meta">{$LL.mapEditor.edit.bots.page.about.created({ date: made })}</p>{/if}
            {#if asking}
                <div class="bkp-ask" role="alert" data-testid="brickDeleteAsk">
                    <p class="bkp-ask-t">{$LL.chat.brick.deleteAsk({ name: brick.name })}</p>
                    <p>{$LL.chat.brick.deleteWhat()}</p>
                    <div class="bkp-ask-actions">
                        <PageButton tall disabled={deleting} testId="brickDeleteKeep" on:click={() => (asking = false)}
                            >{$LL.mapEditor.edit.bots.page.about.keep()}</PageButton
                        >
                        <PageButton tall danger disabled={deleting} testId="brickDeleteConfirm" on:click={onDelete}
                            >{$LL.chat.brick.deleteBrick()}</PageButton
                        >
                    </div>
                    <p class="bkp-undo" data-testid="brickDeleteUndoLine">
                        {undoUntil ? $LL.chat.brick.undoUntil({ day: undoUntil }) : $LL.chat.brick.undoLater()}
                    </p>
                </div>
            {:else}
                <div class="bkp-delete">
                    <PageButton tall danger testId="brickDelete" on:click={() => (asking = true)}
                        ><IconTrash font-size="16" />{$LL.chat.brick.deleteBrick()}</PageButton
                    >
                </div>
            {/if}
        </footer>
    </div>
</div>

<style>
    .bkp {
        gap: 10px;
        padding: 12px 14px 14px;
        color: #fff;
    }
    .bkp-scroll {
        display: flex;
        flex-direction: column;
        gap: 6px;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
    }
    .bkp-top {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 6px 8px 10px;
    }
    .bkp-pic {
        display: grid;
        place-items: center;
        flex: none;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: radial-gradient(
            circle at 50% 42%,
            rgba(134, 41, 252, 0.35),
            rgba(65, 86, 246, 0.12) 58%,
            rgba(255, 255, 255, 0.03) 72%
        );
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.28);
    }
    .bkp-tx {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }
    .bkp-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 17px;
        font-weight: 650;
    }
    .bkp-line {
        font-size: 13px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
    }
    .bkp-row {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 52px;
        margin: 0;
        padding: 6px 8px;
        border: 0;
        border-radius: 14px;
        background: transparent;
        font: inherit;
        font-size: 15px;
        color: #fff;
        text-align: start;
        cursor: pointer;
    }
    @media (hover: hover) {
        .bkp-row:hover {
            background: rgba(255, 255, 255, 0.05);
        }
    }
    .bkp-row:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: -2px;
    }
    .bkp-ic {
        display: grid;
        place-items: center;
        flex: none;
        width: 32px;
        color: rgba(244, 242, 250, 0.9);
    }
    .bkp-row-t {
        flex: 1;
        min-width: 0;
    }
    .bkp-go {
        display: grid;
        place-items: center;
        flex: none;
        color: rgba(244, 242, 250, 0.56);
    }
    :global([dir="rtl"]) .bkp-go {
        transform: scaleX(-1);
    }
    .bkp-foot {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 6px;
        padding: 12px 4px 4px;
        border-top: 1px solid rgba(255, 255, 255, 0.07);
    }
    .bkp-meta {
        margin: 0;
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.56);
    }
    .bkp-delete {
        display: flex;
    }
    .bkp-ask {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        border-radius: 12px;
        background: rgba(255, 112, 92, 0.1);
        box-shadow: inset 0 0 0 1px rgba(255, 112, 92, 0.3);
    }
    .bkp-ask p {
        margin: 0;
        font-size: 13px;
        line-height: 1.4;
    }
    .bkp-ask .bkp-ask-t {
        font-weight: 700;
    }
    .bkp-ask-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }
    .bkp-ask .bkp-undo {
        font-size: 12.5px;
        color: rgba(244, 242, 250, 0.64);
    }
</style>
