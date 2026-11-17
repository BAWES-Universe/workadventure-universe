<script lang="ts">
    import type { Action } from "svelte/action";
    import { fly } from "svelte/transition";
    import { closeModal } from "svelte-modals";
    import LL from "../../../i18n/i18n-svelte";
    import { roomBricksStore } from "../../external-modules/bots/stores/RoomBricksStore";
    import PageButton from "../../external-modules/bots/components/page/PageButton.svelte";
    import BrickPicture from "./BrickPicture.svelte";
    import { IconX } from "@wa-icons";

    /**
     * "Add one of your Bricks" (game #2005, mock Part 16 picture 2): the person's own Bricks, each with "Add here", which
     * has them pick its spot on the map as for any room bot. It says where it would live and what stays between the two.
     */
    export let isOpen: boolean;
    export let onAddHere: (brick: {
        id: string;
        name: string;
        description: string | null;
        look: string | null;
    }) => void;

    $: choices = $roomBricksStore?.mine ?? [];
    $: roomName = $roomBricksStore?.roomName ?? "";

    function add(choice: (typeof choices)[number]) {
        closeModal();
        onAddHere({ id: choice.id, name: choice.name, description: choice.description, look: choice.look });
    }

    // A dialog keeps the keyboard inside it, and gives focus back to what had it when it closes
    const keepFocusInside: Action<HTMLElement> = (node) => {
        const before = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        const stops = () => Array.from(node.querySelectorAll<HTMLElement>("button:not([disabled])"));
        stops()[0]?.focus();

        function onKeydown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                event.preventDefault();
                closeModal();
                return;
            }
            if (event.key !== "Tab") return;
            const all = stops();
            const first = all[0];
            const last = all[all.length - 1];
            if (!first || !last) return;
            if (!node.contains(document.activeElement)) {
                event.preventDefault();
                first.focus();
            } else if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
        document.addEventListener("keydown", onKeydown);
        return {
            destroy() {
                document.removeEventListener("keydown", onKeydown);
                before?.focus();
            },
        };
    };
</script>

{#if isOpen}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="abs-scrim" on:click|self={closeModal}>
        <div
            class="abs u-surface"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-brick-title"
            data-testid="addBrickSheet"
            use:keepFocusInside
            transition:fly={{ y: 16, duration: 200 }}
        >
            <button
                type="button"
                class="u-close absolute top-2 end-2"
                aria-label={$LL.chat.brick.closeCard()}
                data-testid="addBrickClose"
                on:click={closeModal}
            >
                <IconX font-size="20" />
            </button>
            <h2 id="add-brick-title" class="u-display abs-title">{$LL.chat.brick.addOwn()}</h2>
            <p class="abs-line">
                {roomName ? $LL.chat.brick.addSheetLine({ room: roomName }) : $LL.chat.brick.addSheetLineNoRoom()}
            </p>

            {#if choices.length === 0}
                <p class="abs-line" data-testid="addBrickNone">{$LL.chat.brick.noOtherBricks()}</p>
            {:else}
                <div class="abs-list">
                    {#each choices as choice (choice.id)}
                        <div class="abs-row" data-testid="addBrickRow">
                            <span class="abs-look"><BrickPicture look={choice.look} size={36} /></span>
                            <span class="abs-tx">
                                <span class="abs-t">{choice.name}</span>
                                {#if choice.description}<span class="abs-m">{choice.description}</span>{/if}
                            </span>
                            <PageButton testId="addBrickHere" on:click={() => add(choice)}
                                >{choice.homeElsewhere
                                    ? $LL.chat.brick.moveHere()
                                    : $LL.chat.brick.addHere()}</PageButton
                            >
                        </div>
                    {/each}
                </div>
            {/if}
            <p class="abs-line abs-foot">{$LL.chat.brick.addFoot()}</p>
        </div>
    </div>
{/if}

<style>
    .abs-scrim {
        position: fixed;
        inset: 0;
        z-index: 2001;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 12px;
        background: rgba(10, 8, 20, 0.45);
        pointer-events: auto;
    }
    .abs {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
        max-width: 400px;
        max-height: 100%;
        overflow-y: auto;
        box-sizing: border-box;
        margin: 0;
        padding: 16px;
        border-radius: 16px;
        color: #fff;
        text-align: start;
        font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    @media (max-width: 600px) {
        .abs-scrim {
            align-items: flex-end;
            padding: 0;
        }
        .abs {
            max-width: none;
            border-radius: 20px 20px 0 0;
            padding-bottom: 24px;
        }
    }
    .abs-title {
        margin: 0;
        padding: 4px 48px 0 4px;
        font-size: 20px;
        line-height: 28px;
    }
    :global([dir="rtl"]) .abs-title {
        padding: 4px 4px 0 48px;
    }
    .abs-line {
        margin: 0;
        padding: 0 4px;
        font-size: 13.5px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.64);
    }
    .abs-foot {
        padding-top: 4px;
    }
    .abs-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 6px 0;
    }
    .abs-row {
        display: flex;
        align-items: center;
        gap: 14px;
        min-height: 72px;
        padding: 6px 8px 6px 10px;
    }
    /* The button is as big as the mock's; the row around it is the tap target */
    .abs-row :global(.bp-btn) {
        position: relative;
    }
    .abs-row :global(.bp-btn)::after {
        content: "";
        position: absolute;
        inset: -6px -4px;
    }
    .abs-look {
        display: grid;
        place-items: center;
        flex: none;
        width: 44px;
        height: 44px;
    }
    .abs-tx {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
    }
    .abs-t {
        font-size: 15px;
        font-weight: 650;
    }
    .abs-m {
        font-size: 13px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
    }
</style>
