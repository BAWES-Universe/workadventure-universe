<script lang="ts">
    // The card an object opens when you click it, in the Look around card's look (PlaceCard.svelte): its picture, its
    // name, its description, and one row per thing it does, each with the editor's icon and words for that setting.
    // When it opens and how it closes are decided elsewhere (Entity.ts); this only draws it.
    import type { Unsubscriber } from "svelte/store";
    import { onDestroy } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import { actionsMenuStore } from "../../Stores/ActionsMenuStore";
    import { mobileLayoutStore } from "../../Stores/MobileLayoutStore";
    import VisitCard from "../VisitCard/VisitCard.svelte";

    import type { ActionsMenuAction, ActionsMenuData } from "../../Stores/ActionsMenuStore";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import ActionRows from "./ActionRows.svelte";
    import { IconX } from "@wa-icons";

    let actionsMenuData: ActionsMenuData | undefined;

    let actionsMenuStoreUnsubscriber: Unsubscriber | null;

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            closeActionsMenu();
        }
    }

    function closeActionsMenu() {
        actionsMenuStore.clear();
    }

    actionsMenuStoreUnsubscriber = actionsMenuStore.subscribe((value) => {
        actionsMenuData = value;
    });

    onDestroy(() => {
        if (actionsMenuStoreUnsubscriber) {
            actionsMenuStoreUnsubscriber();
        }
    });

    async function runAction(action: ActionsMenuAction) {
        analyticsClient.clickPropertyMapEditor(action.actionName, action.style);
        await action.callback();
    }
</script>

<svelte:window on:keydown={onKeyDown} />

{#if actionsMenuData}
    <div class="object-card u-surface pointer-events-auto" class:phone={$mobileLayoutStore} data-testid="actions-menu">
        <div class="object-card-head">
            {#if actionsMenuData.textureUrl}
                <span class="object-card-tile">
                    <img src={actionsMenuData.textureUrl} alt="" draggable="false" />
                </span>
            {/if}
            <div class="object-card-text">
                <h3 class="object-card-name">{actionsMenuData.menuName}</h3>
            </div>
            <button
                type="button"
                class="u-close"
                aria-label={$LL.mapEditor.lookAround.close()}
                data-testid="closeActionsMenuButton"
                on:click={closeActionsMenu}
            >
                <IconX font-size="18" />
            </button>
        </div>

        {#if actionsMenuData.visitCardUrl}
            <VisitCard visitCardUrl={actionsMenuData.visitCardUrl} isEmbedded={true} showSendMessageButton={false} />
        {/if}

        {#if actionsMenuData.menuDescription}
            <p class="object-card-desc">{actionsMenuData.menuDescription}</p>
        {/if}

        <ActionRows actions={actionsMenuData.actions} onSelect={runAction} />
    </div>
{/if}

<style>
    .object-card {
        width: 360px;
        max-width: calc(100vw - 24px);
        box-sizing: border-box;
        padding: 14px;
        border-radius: 24px;
        color: #fff;
    }
    /* Phones: the Look around card's rule, clear of the zoom column on the right. */
    .object-card.phone {
        /* 12px from the left and 68px from the right on a phone held upright. Sized from the screen, not the stack:
           on a phone turned sideways the stack only wraps its cards, so a long description must not widen it. */
        width: calc(100vw - 80px);
        max-width: 420px;
        margin-right: 68px;
    }
    .object-card-head {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    .object-card-tile {
        display: grid;
        place-items: center;
        flex: none;
        width: 44px;
        height: 44px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.08);
    }
    .object-card-tile img {
        max-width: 36px;
        max-height: 36px;
        object-fit: contain;
        image-rendering: pixelated;
    }
    .object-card-text {
        flex: 1;
        min-width: 0;
    }
    .object-card-name {
        margin: 0;
        padding: 0;
        text-transform: none;
        font-family: inherit;
        font-size: 18px;
        font-weight: 650;
        letter-spacing: -0.01em;
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .object-card-desc {
        margin: 10px 2px 0;
        font-size: 13.5px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.86);
    }
</style>
