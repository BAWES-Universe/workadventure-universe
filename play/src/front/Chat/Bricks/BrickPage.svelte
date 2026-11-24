<script lang="ts">
    import LL, { locale } from "../../../i18n/i18n-svelte";
    import PanelHeader from "../../Components/MapEditor/EditMode/PanelHeader.svelte";
    import BotDetailView from "../../external-modules/bots/components/BotDetailView.svelte";
    import BotFooter from "../../external-modules/bots/components/page/BotFooter.svelte";
    import { botApiService } from "../../external-modules/bots/services/BotApiService";
    import type { BotData, BrickChange, BrickPageWay } from "../../external-modules/bots/types";
    import { warningMessageStore } from "../../Stores/ErrorStore";
    import PageButton from "../../external-modules/bots/components/page/PageButton.svelte";
    import { livesHere } from "../../external-modules/bots/roomBricksModel";
    import { openAppsPage } from "./Apps/OpenApps";
    import { brickPageBot, shortDay, type BrickCard } from "./Brick";
    import BrickDidPage from "./BrickDidPage.svelte";
    import BrickPicture from "./BrickPicture.svelte";
    import { brickHomeStore, loadBrickHome, showBrickOnMap, takeBrickOutOfHome } from "./BrickHomeStore";
    import { canOfferBringAlong } from "./BrickVisit";
    import { bringBrickAlong, brickVisitStore, endBrickVisit, loadBrickVisit } from "./BrickVisitStore";
    import { brickUndoDays, changeMyBrick, deleteMyBrick } from "./MyBricksStore";
    import { IconCurrentLocation, IconWalk } from "@wa-icons";

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
    /** Called once the Brick is deleted: the Bricks page shows it under Deleted. */
    export let onDeleted: () => void;

    const DAY_MS = 24 * 60 * 60 * 1000;

    let bot: BotData | undefined;
    let failed = false;
    let deleting = false;
    let loadedFor: string | undefined;
    let visitBusy = false;
    // "Everything Brick did" (#2002), open over the page: the page stays under it, so Back finds it as it was
    let didOpen = false;
    $: if (brick.id !== loadedFor) didOpen = false;

    // What the page says about visiting (#2005), for the room the person is in: read again for each Brick it opens on.
    // The read comes first: it clears the last Brick's answer at once, and the line after it must see that, not the old one
    $: loadBrickVisit(brick.id).catch((error) => console.error(error));
    $: visit = $brickVisitStore;

    // Where it lives (#2005): "Show on map" and "Take it out" when it lives in the room the person is in
    let homeBusy = false;
    // The read comes first, for the same reason: a read that fails must not leave the last Brick's home on this page
    $: loadBrickHome(brick.id).catch((error) => console.error(error));
    $: home = $brickHomeStore;
    $: here = livesHere(home, botApiService.getRoomId());

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

    function bringAlong() {
        if (visitBusy) return;
        visitBusy = true;
        bringBrickAlong(brick.id)
            .then((refusal) => {
                if (refusal && typeof refusal === "object")
                    warningMessageStore.addWarningMessage(
                        refusal.livesIn
                            ? $LL.chat.brick.bringAlongLivesIn({ room: refusal.livesIn })
                            : $LL.chat.brick.bringAlongFailed({ name: brick.name })
                    );
                else if (refusal === "not_yet")
                    warningMessageStore.addWarningMessage($LL.chat.brick.bringAlongNotYet({ name: brick.name }));
                else if (refusal)
                    warningMessageStore.addWarningMessage($LL.chat.brick.bringAlongFailed({ name: brick.name }));
            })
            .catch((error) => console.error(error))
            .finally(() => {
                visitBusy = false;
            });
    }

    function showOnMap() {
        // It stands on the map of the room it lives in: not on this one (yet) says nothing the person can act on
        showBrickOnMap(brick.id).catch((error: unknown) => console.warn(error));
    }

    function takeOut() {
        if (homeBusy) return;
        homeBusy = true;
        takeBrickOutOfHome(brick.id)
            .then((done) => {
                if (!done) warningMessageStore.addWarningMessage($LL.chat.brick.takeOutFailed({ name: brick.name }));
            })
            .catch((error) => console.error(error))
            .finally(() => {
                homeBusy = false;
            });
    }

    function endVisit() {
        if (visitBusy) return;
        visitBusy = true;
        endBrickVisit(brick.id)
            .then((ended) => {
                if (!ended) warningMessageStore.addWarningMessage($LL.chat.brick.endVisitFailed());
            })
            .catch((error) => console.error(error))
            .finally(() => {
                visitBusy = false;
            });
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

{#if didOpen}
    <BrickDidPage botId={brick.id} name={brick.name} onBack={() => (didOpen = false)} />
{/if}
<div class="bkp flex h-full min-h-0 flex-col" class:hidden={didOpen} data-testid="brickPage">
    <PanelHeader title={$LL.chat.brick.bricks()} {onBack} backLabel={$LL.chat.brick.backToBricks()} canHide={false} />
    <div class="bkp-scroll">
        {#if bot}
            <BotDetailView {bot} brick={way} {deleting} onSave={() => {}} {onDelete}>
                <BrickPicture slot="look" let:look {look} size={44} />
                <svelte:fragment slot="visit">
                    {#if visit?.state === "visiting"}
                        <div class="bkp-visit" data-testid="brickVisiting">
                            <span class="bkp-visit-state">
                                <span class="bkp-dot" aria-hidden="true" />
                                {visit.place
                                    ? $LL.chat.brick.visitingPlace({ place: visit.place })
                                    : $LL.chat.brick.visiting()}
                            </span>
                            <PageButton tall disabled={visitBusy} testId="brickEndVisit" on:click={endVisit}
                                >{$LL.chat.brick.endVisit()}</PageButton
                            >
                        </div>
                        <p class="bkp-visit-line">{$LL.chat.brick.endVisitLine()}</p>
                    {:else if visit?.state === "blocked"}
                        <p class="bkp-visit-line bkp-blocked" data-testid="brickVisitBlocked">
                            {$LL.chat.brick.notTaken({ place: visit.place, name: brick.name })}
                        </p>
                    {:else if canOfferBringAlong(brick, visit) && home === null}
                        <div class="bkp-visit">
                            <PageButton tall disabled={visitBusy} testId="brickBringAlong" on:click={bringAlong}
                                ><IconWalk font-size="18" />{$LL.chat.brick.bringAlong()}</PageButton
                            >
                        </div>
                        <p class="bkp-visit-line">
                            {visit?.place
                                ? $LL.chat.brick.bringAlongLine({ name: brick.name, place: visit.place })
                                : $LL.chat.brick.bringAlongLineNoPlace({ name: brick.name })}
                        </p>
                    {/if}
                    {#if home}
                        <div class="bkp-visit bkp-home">
                            {#if here}
                                <PageButton tall testId="brickShowOnMap" on:click={showOnMap}
                                    ><IconCurrentLocation font-size="18" />{$LL.chat.brick.showOnMap()}</PageButton
                                >
                            {/if}
                            <PageButton tall disabled={homeBusy} testId="brickTakeOut" on:click={takeOut}
                                >{here
                                    ? $LL.chat.brick.takeItOutHere()
                                    : $LL.chat.brick.takeItOutOf({ room: home.roomName })}</PageButton
                            >
                        </div>
                        <p class="bkp-visit-line" data-testid="brickHomeLine">
                            {$LL.chat.brick.homeLine({ room: home.roomName })}
                        </p>
                    {/if}
                </svelte:fragment>
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
    .bkp-visit {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }
    .bkp-visit-state {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        font-size: 14px;
        font-weight: 650;
        color: #c4b5fd;
    }
    .bkp-dot {
        flex: none;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #34d399;
    }
    .bkp-visit-line {
        margin: -5px 0 0;
        padding: 0 4px 12px;
        font-size: 12.5px;
        line-height: 1.45;
        color: rgba(244, 242, 250, 0.64);
    }
    .bkp-home {
        justify-content: flex-start;
        flex-wrap: wrap;
        gap: 2px;
    }
    /* As in the mock: Show on map is as wide as its words, Take it out fills the rest of the row */
    .bkp-home :global(.bp-btn:last-child) {
        flex: 1 1 auto;
    }
    .bkp-blocked {
        margin-top: 0;
        padding-top: 4px;
        font-size: 13.5px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.78);
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
