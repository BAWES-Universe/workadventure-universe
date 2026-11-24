<script lang="ts">
    // What the map editor's list of a room's bots adds for Bricks (game #2005, mock Part 16): the Bricks placed here by
    // other people, each with Take out, and "Add one of your Bricks". Nothing shows when Orbit does not answer.
    import { onMount } from "svelte";
    import { openModal } from "svelte-modals";
    import LL, { locale } from "../../../../i18n/i18n-svelte";
    import AddBrickSheet from "../../../Chat/Bricks/AddBrickSheet.svelte";
    import BrickPicture from "../../../Chat/Bricks/BrickPicture.svelte";
    import { shortDay } from "../../../Chat/Bricks/Brick";
    import { warningMessageStore } from "../../../Stores/ErrorStore";
    import { placedByOthers } from "../roomBricksModel";
    import { loadRoomBricks, roomBricksStore, takeBrickOut } from "../stores/RoomBricksStore";
    import PageButton from "./page/PageButton.svelte";
    import { IconChevronRight, IconPlus } from "@wa-icons";

    /** Where "Add here" starts the person picking a spot on the map. */
    export let onAddHere: (brick: {
        id: string;
        name: string;
        description: string | null;
        look: string | null;
    }) => void;

    let taking = new Set<string>();

    $: bricks = $roomBricksStore;
    $: others = placedByOthers(bricks);

    function takeOut(id: string, name: string) {
        if (taking.has(id)) return;
        taking = new Set(taking).add(id);
        takeBrickOut(id)
            .then((done) => {
                if (!done) warningMessageStore.addWarningMessage($LL.chat.brick.takeOutFailed({ name }));
            })
            .catch((error) => console.error(error))
            .finally(() => {
                const next = new Set(taking);
                next.delete(id);
                taking = next;
            });
    }

    function openSheet() {
        openModal(AddBrickSheet, { onAddHere });
    }

    onMount(() => {
        loadRoomBricks().catch((error) => console.error(error));
    });
</script>

{#if bricks}
    {#if others.length > 0}
        <div class="rb-sec" data-testid="roomBricksOthers">
            <span>{$LL.chat.brick.placedByOthers()} · {others.length}</span>
        </div>
        {#each others as row (row.id)}
            <div class="rb-row" data-testid="roomBrickRow">
                <span class="rb-look"><BrickPicture look={row.look} size={36} /></span>
                <span class="rb-tx">
                    <span class="rb-t">{row.name}</span>
                    <span class="rb-m">
                        {row.since
                            ? $LL.chat.brick.ownedBySince({
                                  name: row.ownerName ?? "",
                                  day: shortDay(row.since, $locale),
                              })
                            : $LL.chat.brick.ownedBy({ name: row.ownerName ?? "" })}
                    </span>
                </span>
                <PageButton
                    disabled={taking.has(row.id)}
                    testId="roomBrickTakeOut"
                    on:click={() => takeOut(row.id, row.name)}>{$LL.chat.brick.takeOut()}</PageButton
                >
            </div>
        {/each}
    {/if}
    <button type="button" class="rb-add" data-testid="roomBricksAdd" on:click={openSheet}>
        <span class="rb-plus"><IconPlus font-size="22" /></span>
        <span class="rb-tx">
            <span class="rb-t">{$LL.chat.brick.addOwn()}</span>
            <span class="rb-m">{$LL.chat.brick.addOwnLine()}</span>
        </span>
        <span class="rb-chev"><IconChevronRight font-size="18" /></span>
    </button>
{/if}

<style>
    .rb-sec {
        display: flex;
        align-items: center;
        min-height: 44px;
        margin: 4px 0 0;
        padding: 0 8px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(244, 242, 250, 0.5);
    }
    .rb-row,
    .rb-add {
        display: flex;
        align-items: center;
        gap: 14px;
        width: 100%;
        min-height: 64px;
        margin: 0;
        padding: 6px 8px 6px 10px;
        border: 0;
        border-radius: 14px;
        background: transparent;
        font: inherit;
        color: #fff;
        text-align: start;
    }
    .rb-add {
        cursor: pointer;
    }
    .rb-row :global(.bp-btn) {
        position: relative;
    }
    .rb-row :global(.bp-btn)::after {
        content: "";
        position: absolute;
        inset: -6px -4px;
    }
    @media (hover: hover) {
        .rb-add:hover {
            background: rgba(255, 255, 255, 0.05);
        }
    }
    .rb-add:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: -2px;
    }
    .rb-look {
        display: grid;
        place-items: center;
        flex: none;
        width: 44px;
        height: 44px;
    }
    .rb-plus {
        display: grid;
        place-items: center;
        flex: none;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        box-shadow: inset 0 0 0 1.5px rgba(244, 242, 250, 0.4);
        color: rgba(244, 242, 250, 0.8);
    }
    .rb-tx {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
    }
    .rb-t {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 14px;
        font-weight: 600;
    }
    .rb-m {
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
    }
    .rb-chev {
        display: grid;
        place-items: center;
        flex: none;
        color: rgba(244, 242, 250, 0.6);
    }
</style>
