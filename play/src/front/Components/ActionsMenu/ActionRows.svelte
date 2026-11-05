<script lang="ts">
    // One row per thing an object does when you click it: the editor's icon (or the app's picture), the Button Label,
    // a hint line in the editor's words ("Open a website · new tab") and a chevron, or a new-tab arrow. Shared by the
    // object card (ActionsMenu.svelte) and the Look around card (PlaceCard.svelte), so both show the same rows.
    // What a tap on a row does is decided by the card: it gets the tapped action.
    import type { ComponentType } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
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
    import type { ActionsMenuAction } from "../../Stores/ActionsMenuStore";
    import { IconChevronRight, IconExternalLink, IconFile, IconFileMusic, IconLink } from "@wa-icons";

    export let actions: ActionsMenuAction[];
    export let onSelect: (action: ActionsMenuAction) => void | Promise<void>;

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

    // Highest priority first; actions of the same priority keep their order.
    $: sortedActions = [...actions].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
</script>

{#if sortedActions.length > 0}
    <div class="object-card-rows">
        {#each sortedActions as action, index (action.uuid ?? index)}
            {@const image = appImage(action)}
            {@const hint = hintOf(action)}
            <button
                type="button"
                class="u-menu-row {action.style ?? ''}"
                on:click|preventDefault={async () => {
                    await onSelect(action);
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

<style>
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
