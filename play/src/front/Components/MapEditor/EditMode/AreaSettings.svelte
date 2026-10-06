<script lang="ts">
    // The settings of one area as plain rows: its name, what is turned on (with a switch), and what can be added
    // (with a plus). A row opens the setting's own page; the engine's property editors are reused there.
    import { onDestroy } from "svelte";
    import type { AreaDataProperties, AreaDataProperty, PlayAudioPropertyData } from "@workadventure/map-editor";
    import type { KlaxoonEvent } from "@workadventure/shared-utils";
    import { KlaxoonService } from "@workadventure/shared-utils";
    import type { ApplicationDefinitionInterface } from "@workadventure/messages";
    import { v4 as uuid } from "uuid";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import type { AreaEditorTool } from "../../../Phaser/Game/MapEditor/Tools/AreaEditorTool";
    import { mapEditorSelectedAreaPreviewStore } from "../../../Stores/MapEditorStore";
    import type { AreaPreview } from "../../../Phaser/Components/MapEditor/AreaPreview";
    import { extensionModuleStore } from "../../../Stores/GameSceneStore";
    import type { ExtensionModule, ExtensionModuleAreaProperty } from "../../../ExternalModule/ExtensionModule";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import { connectionManager } from "../../../Connection/ConnectionManager";
    import JitsiRoomPropertyEditor from "../PropertyEditor/JitsiRoomPropertyEditor.svelte";
    import PlayAudioPropertyEditor from "../PropertyEditor/PlayAudioPropertyEditor.svelte";
    import OpenWebsitePropertyEditor from "../PropertyEditor/OpenWebsitePropertyEditor.svelte";
    import OpenFilePropertyEditor from "../PropertyEditor/OpenFilePropertyEditor.svelte";
    import FocusablePropertyEditor from "../PropertyEditor/FocusablePropertyEditor.svelte";
    import SilentPropertyEditor from "../PropertyEditor/SilentPropertyEditor.svelte";
    import SpeakerMegaphonePropertyEditor from "../PropertyEditor/SpeakerMegaphonePropertyEditor.svelte";
    import ListenerMegaphonePropertyEditor from "../PropertyEditor/ListenerMegaphonePropertyEditor.svelte";
    import StartPropertyEditor from "../PropertyEditor/StartPropertyEditor.svelte";
    import ExitPropertyEditor from "../PropertyEditor/ExitPropertyEditor.svelte";
    import PersonalAreaPropertyEditor from "../PropertyEditor/PersonalAreaPropertyEditor.svelte";
    import RightsPropertyEditor from "../PropertyEditor/RightsPropertyEditor.svelte";
    import MatrixRoomPropertyEditor from "../PropertyEditor/MatrixRoomPropertyEditor.svelte";
    import TooltipPropertyButton from "../PropertyEditor/TooltipPropertyButton.svelte";
    import LivekitRoomPropertyEditor from "../PropertyEditor/LivekitRoomPropertyEditor.svelte";
    import HighlightPropertyEditor from "../PropertyEditor/HighlightPropertyEditor.svelte";
    import youtubeSvg from "../../images/applications/icon_youtube.svg";
    import klaxoonSvg from "../../images/applications/icon_klaxoon.svg";
    import googleDriveSvg from "../../images/applications/icon_google_drive.svg";
    import googleDocsSvg from "../../images/applications/icon_google_docs.svg";
    import googleSheetsSvg from "../../images/applications/icon_google_sheets.svg";
    import googleSlidesSvg from "../../images/applications/icon_google_slides.svg";
    import eraserSvg from "../../images/applications/icon_eraser.svg";
    import excalidrawSvg from "../../images/applications/icon_excalidraw.svg";
    import cardsSvg from "../../images/applications/icon_cards.svg";
    import tldrawJpeg from "../../images/applications/icon_tldraw.jpeg";
    import PanelHeader from "./PanelHeader.svelte";
    import {
        WEB_APP_SUBTYPES,
        areaSettingRows,
        createAppProperty,
        createAreaProperty,
        describeAreaProperty,
        flagsOf,
    } from "./areaProperties";
    import { IconLink, IconPencil, IconPlus, IconSearch, IconTrash } from "@wa-icons";

    const TILE = 32;

    let properties: AreaDataProperties = [];
    let areaName = "";
    let areaDescription = "";
    let areaSearchable = false;
    let renaming = false;
    let nameInput: HTMLInputElement;
    let openProperty: AreaDataProperty | undefined;
    let showApps = false;

    let lastPreview: AreaPreview | undefined;
    const unsubscribe = mapEditorSelectedAreaPreviewStore.subscribe((preview) => {
        // The store re-emits the same area after every change to it: only another area closes the open page.
        if (preview !== lastPreview) {
            openProperty = undefined;
            renaming = false;
            lastPreview = preview;
        }
        if (!preview) return;
        properties = structuredClone(preview.getProperties());
        // The open page keeps showing the area's current copy of its setting: the server completes some of them
        // after they are added (a chat room gets its id), and the page is where that completion shows.
        if (openProperty) {
            const openId = openProperty.id;
            openProperty = properties.find((p) => p.id === openId);
        }
        areaName = preview.getAreaData().name;
        // Older areas have no description row; it is added when a description is first saved, so that picking the
        // area changes nothing (no undo entry, nothing sent).
        const description = preview.getProperties().find((p) => p.type === "areaDescriptionProperties");
        if (description?.type === "areaDescriptionProperties") {
            areaDescription = description.description ?? "";
            areaSearchable = description.searchable ?? false;
        } else {
            areaDescription = "";
            areaSearchable = false;
        }
    });
    onDestroy(unsubscribe);

    $: preview = $mapEditorSelectedAreaPreviewStore;
    $: data = preview?.getAreaData();
    $: flags = flagsOf(properties);
    $: rows = areaSettingRows($LL, flags).filter((row) => row.available || row.blocked);
    $: turnedOn = properties.filter((p) => p.type !== "areaDescriptionProperties");
    $: size = data
        ? $LL.mapEditor.edit.areas.tiles({
              width: Math.round((data.width / TILE) * 10) / 10,
              height: Math.round((data.height / TILE) * 10) / 10,
          })
        : "";

    let extensionRows = $extensionModuleStore.reduce(
        (acc: { [key: string]: ExtensionModuleAreaProperty }[], module: ExtensionModule) => {
            const areaProperty = module.areaMapEditor?.();
            if (areaProperty != undefined) acc.push(areaProperty);
            return acc;
        },
        []
    );

    function refresh() {
        if (!preview) return;
        // A copy, as in the store subscription above: a setting page binds its fields to the open property, and
        // updateProperty must see the area's live data unchanged to snapshot the old state for undo.
        properties = structuredClone(preview.getProperties());
    }

    function tool(): AreaEditorTool | undefined {
        return gameManager.getCurrentGameScene().getMapEditorModeManager().currentlyActiveTool as
            | AreaEditorTool
            | undefined;
    }

    function back() {
        if (openProperty) {
            openProperty = undefined;
            return;
        }
        tool()?.deselectArea?.();
    }

    // The app logos and the "integration is disabled" lines the old Add property list had.
    const APP_LOGOS: Record<(typeof WEB_APP_SUBTYPES)[number], string> = {
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
    function appActivated(subtype: (typeof WEB_APP_SUBTYPES)[number]): boolean {
        return connectionManager[`${subtype}ToolActivated`];
    }

    function add(type: AreaDataProperty["type"], subtype?: string, opensPage = true) {
        if (!preview) return;
        analyticsClient.addMapEditorProperty("area", type || "unknown");
        const property = createAreaProperty($LL, type, subtype);
        preview.addProperty(property);
        if (subtype === "klaxoon") openKlaxoonActivityPicker(property);
        if (type === "matrixRoomPropertyData" && flags.livekitRoomProperty) {
            const livekit = properties.find((p) => p.type === "livekitRoomProperty");
            if (livekit && livekit.type === "livekitRoomProperty") {
                const config = livekit.livekitRoomConfig ?? {
                    startWithAudioMuted: false,
                    startWithVideoMuted: false,
                    disableChat: false,
                };
                config.disableChat = true;
                livekit.livekitRoomConfig = config;
                update(livekit);
            }
        }
        refresh();
        showApps = false;
        if (opensPage) openProperty = properties.find((p) => p.id === property.id);
    }

    function addApp(app: ApplicationDefinitionInterface) {
        if (!preview) return;
        analyticsClient.addMapEditorProperty("area", app.name);
        const property = createAppProperty(app);
        preview.addProperty(property);
        refresh();
        showApps = false;
        openProperty = properties.find((p) => p.id === property.id);
    }

    function remove(id: string, removeAreaEntities?: boolean) {
        if (!preview) return;
        analyticsClient.removeMapEditorProperty("area", properties.find((p) => p.id === id)?.type || "unknown");
        preview.deleteProperty(id, removeAreaEntities);
        refresh();
        if (openProperty?.id === id) openProperty = undefined;
    }

    // The page has one title and one Remove; the property form's own header (a second title and ✕) is hidden.
    // Remove still goes through that form's own ✕, so anything it asked before removing (a personal area with
    // objects in it asks what to do with them) is still asked.
    let propertyPage: HTMLElement | undefined;
    function removeOpenProperty(id: string) {
        const formClose = propertyPage?.querySelector<HTMLButtonElement>(
            ":scope > .property-settings-container > .header button"
        );
        if (formClose) formClose.click();
        else remove(id);
    }

    function update(property: AreaDataProperty, removeAreaEntities?: boolean) {
        preview?.updateProperty(property, removeAreaEntities);
    }

    function openKlaxoonActivityPicker(app: AreaDataProperty) {
        if (!connectionManager.klaxoonToolClientId || app.type !== "openWebsite" || app.application !== "klaxoon") {
            return;
        }
        KlaxoonService.openKlaxoonActivityPicker(connectionManager.klaxoonToolClientId, (payload: KlaxoonEvent) => {
            app.link = KlaxoonService.getKlaxoonEmbedUrl(new URL(payload.url), connectionManager.klaxoonToolClientId);
            app.poster = payload.imageUrl ?? undefined;
            app.buttonLabel = payload.title ?? undefined;
            update(app);
        });
    }

    function onUpdateAudioProperty(event: CustomEvent<PlayAudioPropertyData>) {
        update(event.detail);
    }

    function saveName() {
        // Enter saves and takes the field away. Chrome fires blur when a focused field is removed (a second save,
        // and a second name label on the map), Firefox fires nothing (the game's keys stay off, as if a field were
        // still focused): so the field is blurred here first, once, and the save runs on that blur only.
        if (!renaming) return;
        renaming = false;
        if (nameInput && document.activeElement === nameInput) {
            nameInput.blur();
        }
        preview?.setAreaName(areaName);
    }
    function startRename() {
        renaming = true;
        requestAnimationFrame(() => nameInput?.focus());
    }
    function saveDescription() {
        if (!preview) return;
        const description = preview.getProperties().find((p) => p.type === "areaDescriptionProperties");
        if (description?.type === "areaDescriptionProperties") {
            // A copy, not the live property: updateProperty snapshots the old state for undo before it applies the change.
            preview.updateProperty({ ...description, description: areaDescription, searchable: areaSearchable });
        } else {
            preview.addProperty({
                id: uuid(),
                type: "areaDescriptionProperties",
                description: areaDescription,
                searchable: areaSearchable,
            });
        }
    }

    function deleteArea() {
        if (!preview) return;
        // The tool shows the "removed · Undo" toast itself, once the area really goes (a personal area with objects
        // asks first, and the page stays open until the answer: a cancelled removal keeps the area on screen).
        tool()?.handleDeleteAreaFrontCommandExecution(preview.getId(), undefined, () => tool()?.deselectArea?.());
    }
</script>

{#if preview}
    {#if openProperty}
        {@const property = openProperty}
        {@const described = describeAreaProperty($LL, property, extensionRows)}
        <PanelHeader
            title={described.title}
            subtitle={areaName || $LL.mapEditor.edit.areas.unnamed()}
            onBack={back}
            backLabel={$LL.mapEditor.edit.areas.back()}
        />
        <div
            bind:this={propertyPage}
            class="em-scroll properties-container em-prop-page"
            data-testid="area-property-page"
        >
            {#if property.type === "focusable"}
                <FocusablePropertyEditor
                    {property}
                    on:close={() => remove(property.id)}
                    on:change={() => update(property)}
                />
            {:else if property.type === "highlight"}
                <HighlightPropertyEditor
                    {property}
                    on:close={() => remove(property.id)}
                    on:change={() => update(property)}
                />
            {:else if property.type === "silent"}
                <SilentPropertyEditor on:close={() => remove(property.id)} on:change={() => update(property)} />
            {:else if property.type === "jitsiRoomProperty"}
                <JitsiRoomPropertyEditor
                    {property}
                    isArea={true}
                    on:close={() => remove(property.id)}
                    on:change={() => update(property)}
                />
            {:else if property.type === "playAudio"}
                <PlayAudioPropertyEditor
                    property={{ ...property, hideButtonLabel: true }}
                    isArea={true}
                    on:close={() => remove(property.id)}
                    on:audioLink={onUpdateAudioProperty}
                />
            {:else if property.type === "openWebsite"}
                <OpenWebsitePropertyEditor
                    {property}
                    isArea={true}
                    on:close={() => remove(property.id)}
                    on:change={() => update(property)}
                />
            {:else if property.type === "speakerMegaphone"}
                <SpeakerMegaphonePropertyEditor
                    {property}
                    on:close={() => remove(property.id)}
                    on:change={() => update(property)}
                />
            {:else if property.type === "listenerMegaphone"}
                <ListenerMegaphonePropertyEditor
                    {property}
                    on:close={() => remove(property.id)}
                    on:change={() => update(property)}
                />
            {:else if property.type === "start"}
                <StartPropertyEditor
                    {property}
                    startAreaName={areaName}
                    updateStartAreaNameCallback={(name) => {
                        setTimeout(() => {
                            if (name === areaName) return;
                            areaName = name;
                            saveName();
                        }, 100);
                    }}
                    on:close={() => remove(property.id)}
                    on:change={() => update(property)}
                />
            {:else if property.type === "exit"}
                <ExitPropertyEditor
                    {property}
                    on:close={() => remove(property.id)}
                    on:change={() => update(property)}
                />
            {:else if property.type === "restrictedRightsPropertyData"}
                <RightsPropertyEditor
                    restrictedRightsPropertyData={property}
                    on:close={() => remove(property.id)}
                    on:change={() => update(property)}
                />
            {:else if property.type === "personalAreaPropertyData"}
                <PersonalAreaPropertyEditor
                    personalAreaPropertyData={property}
                    on:close={({ detail }) => remove(property.id, detail)}
                    on:change={({ detail }) => update(property, detail)}
                />
            {:else if property.type === "extensionModule"}
                {#each extensionRows as extensionRow, index (`extension-${index}`)}
                    {#if extensionRow[property.subtype] != undefined}
                        <svelte:component
                            this={extensionRow[property.subtype].AreaPropertyEditor}
                            extensionModuleAreaMapEditor={extensionRow}
                            {property}
                            on:close={() => remove(property.id)}
                            on:change={() => update(property)}
                        />
                    {/if}
                {/each}
            {:else if property.type === "matrixRoomPropertyData"}
                <MatrixRoomPropertyEditor
                    {property}
                    on:close={({ detail }) => remove(property.id, detail)}
                    on:change={() => update(property)}
                />
            {:else if property.type === "tooltipPropertyData"}
                <TooltipPropertyButton
                    {property}
                    on:close={() => remove(property.id)}
                    on:change={() => update(property)}
                />
            {:else if property.type === "openFile"}
                <OpenFilePropertyEditor
                    {property}
                    isArea={true}
                    on:close={() => remove(property.id)}
                    on:change={() => update(property)}
                />
            {:else if property.type === "livekitRoomProperty"}
                <LivekitRoomPropertyEditor
                    {property}
                    hasHighlightProperty={!!flags.highlight}
                    shouldDisableDisableChatButton={!!flags.matrixRoomPropertyData}
                    on:close={() => remove(property.id)}
                    on:change={() => update(property)}
                    on:highlightAreaOnEnter={() => add("highlight", undefined, false)}
                />
            {/if}
            <button type="button" class="em-remove" on:click={() => removeOpenProperty(property.id)}>
                <IconTrash font-size="16" />{$LL.mapEditor.edit.areas.remove()}
            </button>
        </div>
    {:else}
        <PanelHeader
            title={areaName || $LL.mapEditor.edit.areas.unnamed()}
            onBack={back}
            backLabel={$LL.mapEditor.edit.areas.back()}
        >
            <svelte:fragment slot="title">
                {#if renaming}
                    <input
                        bind:this={nameInput}
                        class="em-name-input"
                        type="text"
                        id="objectName"
                        bind:value={areaName}
                        placeholder={$LL.mapEditor.edit.areas.namePlaceholder()}
                        on:blur={saveName}
                        on:keydown={(e) => e.key === "Enter" && saveName()}
                    />
                {:else}
                    <button type="button" class="em-name" data-testid="area-rename" on:click={startRename}>
                        <span>{areaName || $LL.mapEditor.edit.areas.unnamed()}</span>
                        <IconPencil font-size="14" />
                    </button>
                {/if}
            </svelte:fragment>
            <svelte:fragment slot="subtitle">{size} · {$LL.mapEditor.edit.areas.rename()}</svelte:fragment>
        </PanelHeader>
        <div class="em-scroll">
            <!-- The description belongs with the name: it is the first thing under it. Several lines, as in the old
                 editor, so line breaks are kept. -->
            <label class="em-desc">
                <span class="em-t">{$LL.mapEditor.edit.areas.description()}</span>
                <textarea
                    id="objectDescription"
                    rows="3"
                    bind:value={areaDescription}
                    placeholder={$LL.mapEditor.edit.areas.descriptionPlaceholder()}
                    on:change={saveDescription}
                />
            </label>
            {#if turnedOn.length > 0}
                <div class="em-ebi">{$LL.mapEditor.edit.areas.turnedOn()}</div>
                {#each turnedOn as property (property.id)}
                    {@const described = describeAreaProperty($LL, property, extensionRows)}
                    <div class="em-row on">
                        <button type="button" class="em-row-main" on:click={() => (openProperty = property)}>
                            <span class="em-tile g"><svelte:component this={described.icon} font-size="18" /></span>
                            <span class="em-tx">
                                <span class="em-t">{described.title}</span>
                                <span class="em-m">{described.text}</span>
                            </span>
                        </button>
                        <input
                            type="checkbox"
                            class="em-switch"
                            checked
                            aria-label={described.title}
                            on:change={() => remove(property.id)}
                        />
                    </div>
                {/each}
            {/if}
            <div class="em-row">
                <span class="em-tile"><IconSearch font-size="18" /></span>
                <span class="em-tx">
                    <span class="em-t">{$LL.mapEditor.edit.areas.searchable()}</span>
                    <span class="em-m">{$LL.mapEditor.edit.areas.searchableText()}</span>
                </span>
                <input
                    type="checkbox"
                    class="em-switch"
                    id="searchable"
                    bind:checked={areaSearchable}
                    on:change={saveDescription}
                />
            </div>

            <div class="em-ebi">{$LL.mapEditor.edit.areas.addToArea()}</div>
            {#each rows as row (row.key + (row.subtype ?? ""))}
                <button
                    type="button"
                    class="em-row"
                    class:em-row-off={row.blocked}
                    disabled={row.blocked}
                    data-testid={row.testId}
                    on:click={() => add(row.key, row.subtype, row.opensPage)}
                >
                    <span class="em-tile"><svelte:component this={row.icon} font-size="18" /></span>
                    <span class="em-tx">
                        <span class="em-t">{row.title}</span>
                        <span class="em-m">{row.text}</span>
                    </span>
                    <span class="em-plus"><IconPlus font-size="14" /></span>
                </button>
            {/each}
            {#each extensionRows as extensionRow, index (`extension-${index}`)}
                {#each Object.entries(extensionRow) as [subtype, areaProperty] (subtype)}
                    {#if areaProperty.shouldDisplayButton(properties)}
                        <button
                            type="button"
                            class="em-row"
                            data-testid={subtype}
                            on:click={() => add("extensionModule", subtype)}
                        >
                            <span class="em-tile"
                                ><svelte:component this={areaProperty.label?.icon ?? IconLink} font-size="18" /></span
                            >
                            <span class="em-tx">
                                <span class="em-t">{areaProperty.label?.title ?? subtype}</span>
                                <span class="em-m"
                                    >{areaProperty.label?.text ??
                                        $LL.mapEditor.edit.properties.extensionModule.text()}</span
                                >
                            </span>
                            <span class="em-plus"><IconPlus font-size="14" /></span>
                        </button>
                    {/if}
                {/each}
            {/each}
            <button type="button" class="em-row" data-testid="area-add-app" on:click={() => (showApps = !showApps)}>
                <span class="em-tile"><IconLink font-size="18" /></span>
                <span class="em-tx">
                    <span class="em-t">{$LL.mapEditor.edit.properties.app.title()}</span>
                    <span class="em-m">{$LL.mapEditor.edit.properties.app.text()}</span>
                </span>
                <span class="em-plus"><IconPlus font-size="14" /></span>
            </button>
            {#if showApps}
                <div class="em-apps">
                    {#each WEB_APP_SUBTYPES as subtype (subtype)}
                        <button
                            type="button"
                            class="em-chip"
                            disabled={!appActivated(subtype)}
                            data-testid="openWebsite{subtype.charAt(0).toUpperCase() + subtype.slice(1)}"
                            on:click={() => add("openWebsite", subtype)}
                        >
                            <img class="em-chip-logo" src={APP_LOGOS[subtype]} alt="" />
                            {$LL.mapEditor.properties[subtype].label()}
                        </button>
                    {/each}
                    {#each connectionManager.applications as app, index (`app-${index}`)}
                        <button type="button" class="em-chip" on:click={() => addApp(app)}>
                            {#if app.image}<img class="em-chip-logo" src={app.image} alt="" />{/if}
                            {app.name}
                        </button>
                    {/each}
                </div>
                {#each WEB_APP_SUBTYPES.filter((subtype) => !appActivated(subtype)) as subtype (subtype)}
                    <p class="em-apps-off">{$LL.mapEditor.properties[subtype].disabled()}</p>
                {/each}
            {/if}
            <button type="button" class="em-remove" data-testid="area-delete" on:click={deleteArea}>
                <IconTrash font-size="16" />{$LL.mapEditor.edit.tools.delete()}
            </button>
        </div>
    {/if}
{/if}

<style>
    .em-scroll {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        scrollbar-width: thin;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding-right: 2px;
    }
    .em-ebi {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 12px 0 4px;
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #a78bfa;
    }
    .em-ebi:first-child {
        margin-top: 2px;
    }
    .em-ebi::before {
        content: "";
        width: 12px;
        height: 1px;
        background: currentColor;
    }
    .em-row {
        display: flex;
        align-items: center;
        gap: 11px;
        width: 100%;
        margin: 0;
        padding: 8px 0;
        border: 0;
        border-radius: 12px;
        background: transparent;
        font: inherit;
        color: #fff;
        text-align: left;
    }
    button.em-row {
        cursor: pointer;
    }
    .em-row-main {
        display: flex;
        align-items: center;
        gap: 11px;
        flex: 1;
        min-width: 0;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        font: inherit;
        color: #fff;
        text-align: left;
        cursor: pointer;
    }
    .em-row.on .em-t {
        font-weight: 700;
    }
    .em-tile {
        display: grid;
        place-items: center;
        flex: none;
        width: 24px;
        color: #fff;
    }
    .em-tx {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
    }
    .em-t {
        font-size: 14px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .em-m {
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
    }
    .em-plus {
        display: grid;
        place-items: center;
        flex: none;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.08);
    }
    @media (hover: hover) {
        button.em-row:not(:disabled):hover .em-plus {
            background: rgba(255, 255, 255, 0.16);
        }
    }
    .em-switch {
        appearance: none;
        flex: none;
        width: 42px;
        height: 26px;
        margin: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.14);
        position: relative;
        cursor: pointer;
        transition: background 150ms ease;
    }
    .em-switch::after {
        content: "";
        position: absolute;
        top: 3px;
        left: 3px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
        transition: left 150ms ease;
    }
    .em-switch:checked {
        background: linear-gradient(90deg, #8629fc, #4156f6);
    }
    .em-switch:checked::after {
        left: 19px;
    }
    .em-desc {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 4px 0 8px;
    }
    .em-desc textarea {
        width: 100%;
        min-height: 64px;
        padding: 9px 12px;
        border: 0;
        border-radius: 12px;
        background: rgba(0, 0, 0, 0.25);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        font: inherit;
        font-size: 14px;
        line-height: 1.4;
        color: #fff;
        outline: none;
        resize: vertical;
    }
    .em-desc textarea:focus-visible {
        box-shadow: inset 0 0 0 2px rgba(196, 181, 253, 0.9);
    }
    .em-name {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: 100%;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        font: inherit;
        color: #fff;
        cursor: pointer;
    }
    .em-name span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .em-name :global(svg) {
        flex: none;
        color: rgba(244, 242, 250, 0.64);
    }
    .em-name-input {
        width: 100%;
        height: 34px;
        padding: 0 10px;
        border: 0;
        border-radius: 10px;
        background: rgba(0, 0, 0, 0.25);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.4);
        font: inherit;
        font-size: 16px;
        font-weight: 600;
        color: #fff;
        outline: none;
    }
    .em-apps {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 4px 0 8px 35px;
    }
    .em-chip {
        height: 30px;
        padding: 0 12px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        font: inherit;
        font-size: 13px;
        color: #fff;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }
    .em-chip:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }
    .em-chip-logo {
        width: 16px;
        height: 16px;
        border-radius: 3px;
        object-fit: contain;
    }
    .em-apps-off {
        margin: 0;
        padding: 0 0 4px 35px;
        font-size: 12px;
        color: rgba(244, 242, 250, 0.6);
    }
    .em-remove {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        align-self: flex-start;
        margin: 14px 0 4px;
        padding: 8px 14px;
        border: 0;
        border-radius: 999px;
        background: rgba(233, 109, 81, 0.14);
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        color: #f7a48f;
        cursor: pointer;
    }
    .em-prop-page {
        gap: 8px;
    }
    /* A setting that cannot go with one already on (Stage next to a video call): shown, greyed, not tappable. */
    button.em-row.em-row-off {
        opacity: 0.45;
        cursor: not-allowed;
    }
    .em-prop-page > :global(.property-settings-container > .header) {
        display: none;
    }
    .em-prop-page :global(.property-settings-container) {
        /* Today's property forms, on the panel's ink. */
        color: #fff;
    }
</style>
