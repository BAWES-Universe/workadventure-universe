<script lang="ts">
    import LL, { locale } from "../../../i18n/i18n-svelte";
    import PanelHeader from "../../Components/MapEditor/EditMode/PanelHeader.svelte";
    import BotDetailView from "../../external-modules/bots/components/BotDetailView.svelte";
    import BotFooter from "../../external-modules/bots/components/page/BotFooter.svelte";
    import { botApiService } from "../../external-modules/bots/services/BotApiService";
    import type { BotData, BrickChange, BrickPageWay } from "../../external-modules/bots/types";
    import { warningMessageStore } from "../../Stores/ErrorStore";
    import { openAppsPage } from "./Apps/OpenApps";
    import { brickPageBot, shortDay, type BrickCard } from "./Brick";
    import BrickDidPage from "./BrickDidPage.svelte";
    import BrickPicture from "./BrickPicture.svelte";
    import BrickVisitCard from "./BrickVisitCard.svelte";
    import { brickUndoDays, changeMyBrick, deleteMyBrick } from "./MyBricksStore";

    /**
     * A Brick's own page (game #1996), opened by a tap on its row on the Bricks page: the bot page every bot has (mock
     * d-2 and desktop 11), with "Bricks" to go back. Its look, name, line and switch on top, then its parts, then who
     * made it and Delete. Delete asks once and says what goes, what stays, and until when Undo works.
     *
     * A Brick has no room, so its changes go through its own route. Only the parts a Brick has so far are on it: its look,
     * Mind, Personality, Behavior and Companion, and Advanced settings. Usage, Voice, Apps, Computer, Goals and tasks,
     * Memory, Files, Permissions and Template come with their own issues.
     */
    export let brick: BrickCard;
    export let onBack: () => void;
    /** Opened from the Brick's chat: the header then says "Chat with {name}" and Back returns there. */
    export let backTitle: string | undefined = undefined;
    /** Called once the Brick is deleted: the Bricks page shows it under Deleted. */
    export let onDeleted: () => void;

    const DAY_MS = 24 * 60 * 60 * 1000;

    let bot: BotData | undefined;
    let failed = false;
    let deleting = false;
    let loadedFor: string | undefined;
    // "Everything Brick did" (#2002), open over the page: the page stays under it, so Back finds it as it was
    let didOpen = false;
    $: if (brick.id !== loadedFor) didOpen = false;

    $: if (brick.id !== loadedFor) load(brick);

    function load(card: BrickCard) {
        loadedFor = card.id;
        bot = undefined;
        failed = false;
        botApiService
            .getBot(card.id)
            .then((read) => {
                if (loadedFor === card.id) bot = brickPageBot(read, card);
            })
            .catch((error: unknown) => {
                console.warn("Could not read a Brick", error);
                if (loadedFor === card.id) failed = true;
            });
    }

    $: undoUntil = $brickUndoDays ? shortDay(Date.now() + $brickUndoDays * DAY_MS, $locale) : "";
    $: way = {
        save: (change: BrickChange) => changeMyBrick(brick.id, change),
        openApps: (search: string) => openAppsPage({ search }),
        openDid: () => {
            didOpen = true;
        },
        undoLine: undoUntil ? $LL.chat.brick.undoUntil({ day: undoUntil }) : $LL.chat.brick.undoLater(),
        // Its computer's files are offered here once a Brick has a computer (game #2000)
        files: undefined,
    } satisfies BrickPageWay;

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

{#if didOpen}
    <BrickDidPage botId={brick.id} name={brick.name} onBack={() => (didOpen = false)} />
{/if}
<div class="bkp flex h-full min-h-0 flex-col" class:hidden={didOpen} data-testid="brickPage">
    <PanelHeader
        title={backTitle ?? $LL.chat.brick.bricks()}
        {onBack}
        backLabel={backTitle ?? $LL.chat.brick.backToBricks()}
        canHide={false}
    />
    <div class="bkp-scroll">
        {#if bot}
            <BotDetailView {bot} brick={way} {deleting} onSave={() => {}} {onDelete}>
                <BrickPicture slot="look" let:look {look} size={44} />
                <BrickVisitCard slot="visit" {brick} />
            </BotDetailView>
        {:else if failed}
            <p class="bkp-note bkp-bad" data-testid="brickPageFailed">{$LL.chat.brick.brickLoadFailed()}</p>
            <button type="button" class="bkp-pill" data-testid="brickPageTryAgain" on:click={() => load(brick)}>
                {$LL.chat.brick.tryAgain()}
            </button>
            <!-- What the card knows is enough to delete it: a Brick that can't be read can still go -->
            <BotFooter bot={brickPageBot(undefined, brick)} brick={way} {deleting} {onDelete} />
        {:else}
            <p class="bkp-note" data-testid="brickPageLoading">{$LL.chat.brick.loading()}</p>
        {/if}
    </div>
</div>

<style>
    .bkp {
        gap: 10px;
        padding: 12px 14px 14px;
        color: #fff;
    }
    .bkp.hidden {
        display: none;
    }
    .bkp-scroll {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 0 2px 8px;
    }
    .bkp-note {
        margin: 0;
        padding: 4px 8px;
        font-size: 13.5px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.64);
    }
    .bkp-bad {
        color: #ff8a7a;
    }
    .bkp-pill {
        align-self: flex-start;
        height: 40px;
        margin: 4px 8px;
        padding: 0 18px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
    }
</style>
