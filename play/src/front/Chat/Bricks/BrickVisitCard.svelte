<script lang="ts">
    import LL from "../../../i18n/i18n-svelte";
    import { botApiService } from "../../external-modules/bots/services/BotApiService";
    import { livesHere } from "../../external-modules/bots/roomBricksModel";
    import PageButton from "../../external-modules/bots/components/page/PageButton.svelte";
    import { warningMessageStore } from "../../Stores/ErrorStore";
    import { brickHomeStore, loadBrickHome, showBrickOnMap, takeBrickOutOfHome } from "./BrickHomeStore";
    import { canOfferBringAlong } from "./BrickVisit";
    import { bringBrickAlong, brickVisitStore, endBrickVisit, loadBrickVisit } from "./BrickVisitStore";
    import { changeMyBrick } from "./MyBricksStore";
    import { IconCurrentLocation, IconWalk } from "@wa-icons";

    /**
     * What a Brick's own page and its profile in the chat both say about visiting (game #2005): End visit while it walks
     * with the person, Bring along when it can, why it can't (a place that does not take visits, a home in a room), and,
     * on the profile, that it is off, with Turn on. One piece, so the two never differ.
     *
     * On the Brick's page it sits unframed under the name, as it always did. On the profile (`framed`) each state is a
     * card of its own.
     */
    export let brick: { id: string; name: string; enabled: boolean };
    export let framed = false;
    /** Says that a Brick is off, with Turn on (the profile does: the Brick's page has its own switch for that). */
    export let showOff = false;

    let visitBusy = false;
    let homeBusy = false;
    let turningOn = false;

    // What it says about visiting, for the room the person is in: read again for each Brick it opens on. The read comes
    // first: it clears the last Brick's answer at once, and the line after it must see that, not the old one.
    $: loadBrickVisit(brick.id).catch((error) => console.error(error));
    $: visit = $brickVisitStore;

    // Where it lives (#2005): "Show on map" and "Take it out" when it lives in the room the person is in. The read comes
    // first for the same reason: a read that fails must not leave the last Brick's home here.
    $: loadBrickHome(brick.id).catch((error) => console.error(error));
    $: home = $brickHomeStore;
    $: here = livesHere(home, botApiService.getRoomId());

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

    function turnOn() {
        if (turningOn) return;
        turningOn = true;
        changeMyBrick(brick.id, { enabled: true })
            .then((saved) => {
                if (!saved) warningMessageStore.addWarningMessage($LL.chat.brick.switchFailed());
            })
            .catch((error) => console.error(error))
            .finally(() => {
                turningOn = false;
            });
    }
</script>

<!-- A Brick that is off walks nowhere, so the profile says that instead of offering Bring along -->
{#if showOff && !brick.enabled}
    <div class="bvc-block" class:framed data-testid="brickOff">
        <div class="bvc-row">
            <span class="bvc-off">{$LL.chat.brick.isOff({ name: brick.name })}</span>
            <PageButton tall disabled={turningOn} testId="brickTurnOn" on:click={turnOn}
                >{$LL.chat.brick.turnOn()}</PageButton
            >
        </div>
        <p class="bvc-line">{$LL.chat.brick.offLine()}</p>
    </div>
{/if}
{#if visit?.state === "visiting"}
    <div class="bvc-block" class:framed class:violet={framed}>
        <div class="bvc-row" data-testid="brickVisiting">
            <span class="bvc-state">
                <span class="bvc-dot" aria-hidden="true" />
                {visit.place ? $LL.chat.brick.visitingPlace({ place: visit.place }) : $LL.chat.brick.visiting()}
            </span>
            <PageButton tall disabled={visitBusy} testId="brickEndVisit" on:click={endVisit}
                >{$LL.chat.brick.endVisit()}</PageButton
            >
        </div>
        <p class="bvc-line">{$LL.chat.brick.endVisitLine()}</p>
    </div>
{:else if visit?.state === "blocked"}
    <div class="bvc-block" class:framed>
        <p class="bvc-line bvc-blocked" data-testid="brickVisitBlocked">
            {$LL.chat.brick.notTaken({ place: visit.place, name: brick.name })}
        </p>
    </div>
{:else if canOfferBringAlong(brick, visit) && home === null}
    <div class="bvc-block" class:framed>
        <div class="bvc-row" class:bvc-wide={framed}>
            <PageButton tall go={framed} disabled={visitBusy} testId="brickBringAlong" on:click={bringAlong}
                ><IconWalk font-size="18" />{$LL.chat.brick.bringAlong()}</PageButton
            >
        </div>
        <p class="bvc-line">
            {visit?.place
                ? $LL.chat.brick.bringAlongLine({ name: brick.name, place: visit.place })
                : $LL.chat.brick.bringAlongLineNoPlace({ name: brick.name })}
        </p>
    </div>
{/if}
{#if home}
    <div class="bvc-block" class:framed>
        <div class="bvc-row bvc-home">
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
        <p class="bvc-line" data-testid="brickHomeLine">
            {$LL.chat.brick.homeLine({ room: home.roomName })}
        </p>
    </div>
{/if}

<style>
    /* On the Brick's page the pieces sit straight in its column, as they always did */
    .bvc-block {
        display: contents;
    }
    .bvc-block.framed {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 12px 14px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .bvc-block.framed.violet {
        background: rgba(134, 41, 252, 0.1);
        border-color: rgba(167, 139, 250, 0.35);
    }
    .bvc-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }
    /* Bring along on the profile is the one big button of its card */
    .bvc-wide :global(.bp-btn) {
        flex: 1 1 auto;
    }
    .bvc-state {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        font-size: 14px;
        font-weight: 650;
        color: #c4b5fd;
    }
    .bvc-off {
        font-size: 15px;
        font-weight: 650;
        color: #fff;
    }
    .bvc-dot {
        flex: none;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #34d399;
    }
    .bvc-line {
        margin: -5px 0 0;
        padding: 0 4px 12px;
        font-size: 12.5px;
        line-height: 1.45;
        color: rgba(244, 242, 250, 0.64);
    }
    .framed .bvc-line {
        margin: 0;
        padding: 0;
        font-size: 13.5px;
    }
    .bvc-home {
        justify-content: flex-start;
        flex-wrap: wrap;
        gap: 2px;
    }
    /* As in the mock: Show on map is as wide as its words, Take it out fills the rest of the row */
    .bvc-home :global(.bp-btn:last-child) {
        flex: 1 1 auto;
    }
    .bvc-blocked {
        margin-top: 0;
        padding-top: 4px;
        font-size: 13.5px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.78);
    }
    .framed .bvc-blocked {
        padding: 0;
    }
</style>
