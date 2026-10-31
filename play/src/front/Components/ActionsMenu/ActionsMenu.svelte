<script lang="ts">
    // The card an object opens when you click it, in the Look around card's look (PlaceCard.svelte): its picture, its
    // name, its description, and one row per thing it does, each with the editor's icon and words for that setting.
    // When it opens and how it closes are decided elsewhere (Entity.ts); this only draws it.
    import type { ComponentType } from "svelte";
    import type { Unsubscriber } from "svelte/store";
    import { onDestroy } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import { actionsMenuStore } from "../../Stores/ActionsMenuStore";
    import { mobileLayoutStore } from "../../Stores/MobileLayoutStore";
    import VisitCard from "../VisitCard/VisitCard.svelte";
    import { getSettingTitle } from "../LookAround/placeInfo";
    import { connectionManager } from "../../Connection/ConnectionManager";
    import youtubeSvg from "../images/applications/icon_youtube.svg";
    import klaxoonSvg from "../images/applications/icon_klaxoon.svg";
    import googleDriveSvg from "../images/applications/icon_google_drive.svg";
    import googleDocsSvg from "../images/applications/icon_google_docs.svg";
    import googleSheetsSvg from "../images/applications/icon_google_sheets.svg";
    import googleSlidesSvg from "../images/applications/icon_google_slides.svg";
    import eraserSvg from "../images/applications/icon_eraser.svg";
    import excalidrawSvg from "../images/applications/icon_excalidraw.svg";
    import cardsSvg from "../images/applications/icon_cards.svg";
    import tldrawJpeg from "../images/applications/icon_tldraw.jpeg";

    import type { ActionsMenuAction, ActionsMenuData } from "../../Stores/ActionsMenuStore";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { IconChevronRight, IconExternalLink, IconFile, IconFileMusic, IconLink, IconX } from "@wa-icons";

    let actionsMenuData: ActionsMenuData | undefined;
    let sortedActions: ActionsMenuAction[] | undefined;

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
        if (actionsMenuData) {
            sortedActions = [...actionsMenuData.actions.values()].sort((a, b) => {
                const ap = a.priority ?? 0;
                const bp = b.priority ?? 0;
                if (ap > bp) {
                    return -1;
                }
                if (ap < bp) {
                    return 1;
                } else {
                    return 0;
                }
            });
        }
    });

    onDestroy(() => {
        if (actionsMenuStoreUnsubscriber) {
            actionsMenuStoreUnsubscriber();
        }
    });

    // The same icons the editor shows for each setting.
    const SETTING_ICONS: Record<string, ComponentType> = {
        openWebsite: IconLink,
        openFile: IconFile,
        playAudio: IconFileMusic,
    };
    const APP_IMAGES: Record<string, string> = {
        youtube: youtubeSvg,
        klaxoon: klaxoonSvg,
        googleDrive: googleDriveSvg,
        googleDocs: googleDocsSvg,
        googleSheets: googleSheetsSvg,
        googleSlides: googleSlidesSvg,
        eraser: eraserSvg,
        excalidraw: excalidrawSvg,
        cards: cardsSvg,
        tldraw: tldrawJpeg,
    };

    /** An app of "Open a website" shows the app's own picture, as in the editor; a room's own app too. */
    function appImage(action: ActionsMenuAction): string | undefined {
        if (action.propertyType !== "openWebsite" || !action.application || action.application === "website") {
            return undefined;
        }
        return (
            APP_IMAGES[action.application] ??
            connectionManager.applications.find((app) => app.name === action.application)?.image
        );
    }

    /** The line under the label: what the row does, in the editor's words ("Open a website"), and if in a new tab. */
    function hintOf(action: ActionsMenuAction): string {
        const title = action.propertyType ? getSettingTitle(action.propertyType, $LL, action.application) : undefined;
        const parts: string[] = [];
        if (title) parts.push(title);
        if (action.newTab) parts.push($LL.mapEditor.objectCard.newTab());
        return parts.join(" · ");
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

        {#if sortedActions && sortedActions.length > 0}
            <div class="object-card-rows">
                {#each sortedActions as action (action.uuid)}
                    {@const image = appImage(action)}
                    {@const hint = hintOf(action)}
                    <button
                        type="button"
                        class="u-menu-row {action.style ?? ''}"
                        on:click={() => analyticsClient.clickPropertyMapEditor(action.actionName, action.style)}
                        on:click|preventDefault={async () => {
                            await action.callback();
                        }}
                    >
                        <span class="u-menu-tile">
                            {#if image}
                                <img src={image} alt="" draggable="false" />
                            {:else if action.actionIcon}
                                <span
                                    class="object-card-mask"
                                    style="background-color: {action.iconColor ?? 'white'};
                                        -webkit-mask: url({action.actionIcon}) no-repeat center;
                                        mask: url({action.actionIcon}) no-repeat center;"
                                />
                            {:else}
                                <svelte:component this={SETTING_ICONS[action.propertyType ?? ""] ?? IconLink} />
                            {/if}
                        </span>
                        <span class="u-menu-label">
                            {action.actionName}
                            {#if hint}<span class="u-menu-hint">{hint}</span>{/if}
                        </span>
                        <span class="u-menu-go">
                            {#if action.newTab}
                                <IconExternalLink font-size="18" />
                            {:else}
                                <IconChevronRight font-size="18" />
                            {/if}
                        </span>
                    </button>
                {/each}
            </div>
        {/if}
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
        align-self: stretch;
        width: auto;
        max-width: none;
        margin-left: 12px;
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
    .object-card-rows {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 12px;
    }
    .object-card-rows .u-menu-row {
        min-height: 52px;
        margin: 0;
        padding: 6px 10px 6px 8px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 14px;
        color: #fff;
        text-align: start;
    }
    .object-card-rows .u-menu-row:hover {
        background: rgba(255, 255, 255, 0.1);
    }
    .object-card-rows .u-menu-hint {
        color: rgba(244, 242, 250, 0.6);
    }
    .object-card-mask {
        display: block;
        width: 20px;
        height: 20px;
    }
</style>
