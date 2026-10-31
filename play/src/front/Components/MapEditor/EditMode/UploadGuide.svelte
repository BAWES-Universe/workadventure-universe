<script lang="ts">
    // "Add your own": four short rules before the picture is chosen, then a check of the picture at real size on the
    // tile grid next to your own character, with the same fields as today's upload (name, tags, blocking grid, depth).
    // "Edit this upload" opens the same check page with the upload's saved values (#1637).
    import { createEventDispatcher, onDestroy } from "svelte";
    import { ENTITY_UPLOAD_SUPPORTED_FORMATS_FRONT } from "@workadventure/map-editor";
    import type { EntityPrefab } from "@workadventure/map-editor";
    import { CustomEntityDirection } from "@workadventure/messages";
    import { v4 as uuidv4 } from "uuid";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { mapEditorEntityUploadEventStore, selectCategoryStore } from "../../../Stores/MapEditorStore";
    import { currentPlayerWokaStore } from "../../../Stores/CurrentPlayerWokaStore";
    import PanelHeader from "./PanelHeader.svelte";
    import { IconCheck, IconCloudUpload, IconEye, IconInfoCircle, IconRefresh, IconStar, IconTexture } from "@wa-icons";

    /** The upload to change; without it the page adds a new one. */
    export let editing: EntityPrefab | undefined = undefined;
    // Set when this person may not delete the upload (#1628): why, shown in place of "Delete this upload".
    // The uploader may not delete it while a copy sits where they can't edit: then only map editors can (#1628).
    export let deleteBlocked = false;

    const dispatch = createEventDispatcher<{ done: undefined; save: EntityPrefab; remove: { id: string } }>();
    const TILE = 32;

    let file: File | undefined;
    let imageUrl: string | undefined = editing?.imagePath;
    let naturalWidth = 0;
    let naturalHeight = 0;
    let error: string | undefined;
    let dropHover = false;

    let name = editing?.name ?? "";
    let category = editing?.tags.join(", ") ?? "";
    let floating = editing ? editing.collisionGrid === undefined : false;
    let depth: "standing" | "ground" | "custom" = "standing";
    // How far above the picture's bottom edge the line sits: people whose feet are above it walk behind.
    let depthOffset = 0;
    let grid: number[][] = editing?.collisionGrid?.map((row) => [...row]) ?? [];

    function isSupported(type: string): boolean {
        return type.trim().length > 0 && ENTITY_UPLOAD_SUPPORTED_FORMATS_FRONT.includes(type);
    }

    function take(files: FileList | null | undefined) {
        error = undefined;
        const picked = files?.item(0);
        if (!picked) return;
        if (files && files.length > 1) {
            error = $LL.mapEditor.entityEditor.uploadEntity.errorOnFileNumber();
            return;
        }
        if (!isSupported(picked.type)) {
            error = $LL.mapEditor.entityEditor.uploadEntity.errorOnFileFormat();
            return;
        }
        file = picked;
        if (imageUrl) URL.revokeObjectURL(imageUrl);
        imageUrl = URL.createObjectURL(picked);
        name = picked.name.replace(/\.[a-z0-9]+$/i, "");
        naturalWidth = 0;
        naturalHeight = 0;
        grid = [];
    }

    function onLoad(event: Event) {
        const img = event.currentTarget as HTMLImageElement;
        naturalWidth = img.naturalWidth;
        naturalHeight = img.naturalHeight;
        const columns = Math.max(1, Math.ceil(naturalWidth / TILE));
        const rows = Math.max(1, Math.ceil(naturalHeight / TILE));
        // An upload being changed keeps its squares when they still fit the picture.
        if (grid.length !== rows || grid.some((row) => row.length !== columns)) {
            grid = Array(rows)
                .fill(0)
                .map(() => Array(columns).fill(0));
        }
        const saved = -(editing?.depthOffset ?? 0);
        if (!editing || saved === 0) {
            depth = "standing";
            depthOffset = 0;
        } else if (saved === naturalHeight) {
            depth = "ground";
            depthOffset = naturalHeight;
        } else {
            depth = "custom";
            depthOffset = saved;
        }
    }

    function onDrop(event: DragEvent) {
        dropHover = false;
        take(event.dataTransfer?.files);
    }

    function toggleCell(row: number, column: number) {
        grid[row][column] = grid[row][column] === 0 ? 1 : 0;
        grid = grid;
    }

    $: tilesWide = naturalWidth / TILE;
    $: tilesHigh = naturalHeight / TILE;
    $: fits = naturalWidth > 0 && Number.isInteger(tilesWide) && Number.isInteger(tilesHigh);
    $: suggestion = `${Math.max(1, Math.round(tilesWide)) * TILE} × ${Math.max(1, Math.round(tilesHigh)) * TILE}`;
    // The check box draws the picture at real size with a tile above and below it, so the line people pass behind and
    // its "In front" label stay in view; it scrolls when the picture is big.
    $: boxHeight = Math.max(4 * TILE, Math.min(7 * TILE, Math.ceil(naturalHeight / TILE) * TILE + 2 * TILE));
    $: wokaLeft = Math.min(TILE * 1.5 + naturalWidth + TILE, 7 * TILE);
    $: total = grid.reduce((sum, row) => sum + row.length, 0);
    $: blocked = grid.reduce((sum, row) => sum + row.filter((cell) => cell === 1).length, 0);
    // The line people pass behind, measured from the top of the picture.
    $: lineFromBottom = depth === "standing" ? 0 : depth === "ground" ? naturalHeight : depthOffset;
    $: lineTop = Math.max(0, naturalHeight - lineFromBottom);

    function tagsOf(text: string): string[] {
        return text
            .split(",")
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0);
    }

    function saveChanges() {
        if (!editing) return;
        dispatch("save", {
            ...editing,
            name: name.trim() || editing.name,
            tags: tagsOf(category),
            collisionGrid: floating ? undefined : grid,
            depthOffset: -lineFromBottom,
        });
    }

    async function save() {
        if (!file) return;
        const buffer = await file.arrayBuffer();
        const id = uuidv4();
        const tags = tagsOf(category);
        mapEditorEntityUploadEventStore.set({
            id,
            file: new Uint8Array(buffer),
            direction: CustomEntityDirection.Down,
            name: name.trim() || file.name,
            tags,
            imagePath: `${id}-${file.name}`,
            collisionGrid: floating ? undefined : grid,
            depthOffset: -lineFromBottom,
            color: "",
        });
        selectCategoryStore.set(tags[0] ?? "Custom");
        dispatch("done");
    }

    function cancel() {
        dispatch("done");
    }

    onDestroy(() => {
        if (imageUrl) URL.revokeObjectURL(imageUrl);
    });
</script>

{#if !file && !editing}
    <PanelHeader
        title={$LL.mapEditor.edit.upload.title()}
        subtitle={$LL.mapEditor.edit.upload.subtitle()}
        onBack={cancel}
        backLabel={$LL.mapEditor.edit.areas.back()}
    />
    <div class="em-scroll em-rules">
        <div class="em-ebi">{$LL.mapEditor.edit.upload.makeItFit()}</div>
        <div class="em-row">
            <span class="em-tile"><IconTexture font-size="18" /></span>
            <div class="em-tx">
                <div class="em-t">{$LL.mapEditor.edit.upload.tileTitle()}</div>
                <div class="em-m">{$LL.mapEditor.edit.upload.tileText()}</div>
            </div>
        </div>
        <div class="em-row">
            <span class="em-tile"><IconEye font-size="18" /></span>
            <div class="em-tx">
                <div class="em-t">{$LL.mapEditor.edit.upload.angleTitle()}</div>
                <div class="em-m">{$LL.mapEditor.edit.upload.angleText()}</div>
            </div>
        </div>
        <div class="em-row">
            <span class="em-tile"><IconStar font-size="18" /></span>
            <div class="em-tx">
                <div class="em-t">{$LL.mapEditor.edit.upload.backgroundTitle()}</div>
                <div class="em-m">{$LL.mapEditor.edit.upload.backgroundText()}</div>
            </div>
        </div>
        <div class="em-row">
            <span class="em-tile"><IconRefresh font-size="18" /></span>
            <div class="em-tx">
                <div class="em-t">{$LL.mapEditor.edit.upload.sidesTitle()}</div>
                <div class="em-m">{$LL.mapEditor.edit.upload.sidesText()}</div>
            </div>
        </div>
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <label
            class="em-drop"
            class:hover={dropHover}
            on:drop|preventDefault|stopPropagation={onDrop}
            on:dragover|preventDefault={() => (dropHover = true)}
            on:dragleave|preventDefault={() => (dropHover = false)}
        >
            <input
                class="hidden"
                type="file"
                accept={ENTITY_UPLOAD_SUPPORTED_FORMATS_FRONT}
                data-testid="uploadCustomAsset"
                on:change={(e) => take(e.currentTarget.files)}
            />
            <IconCloudUpload font-size="24" />
            <div class="em-t">{$LL.mapEditor.edit.upload.choose()}</div>
            <div class="em-m">{$LL.mapEditor.edit.upload.formats()}</div>
            {#if error}<div class="em-err">{error}</div>{/if}
        </label>
    </div>
{:else}
    <PanelHeader
        title={editing ? editing.name : $LL.mapEditor.edit.upload.checkTitle()}
        subtitle={editing ? $LL.mapEditor.edit.objects.editUpload() : $LL.mapEditor.edit.upload.checkSubtitle()}
        onBack={editing ? cancel : () => (file = undefined)}
        backLabel={$LL.mapEditor.edit.areas.back()}
    />
    <div class="em-scroll em-check">
        <div class="em-gridbox" style="height: {boxHeight}px">
            <div class="em-gridbox-scroll">
                <div class="em-pic" class:floating>
                    <img src={imageUrl} alt={name} draggable="false" on:load={onLoad} />
                    {#if naturalHeight > 0}
                        <div class="em-line" class:ground={depth === "ground"} style="top: {lineTop}px">
                            {#if depth !== "ground"}<span class="em-line-up">{$LL.mapEditor.edit.upload.behind()}</span
                                >{/if}
                            <span class="em-line-down">{$LL.mapEditor.edit.upload.inFront()}</span>
                        </div>
                    {/if}
                    {#if !floating && grid.length > 0}
                        <div class="em-cells" style="grid-template-columns: repeat({grid[0].length}, {TILE}px)">
                            {#each grid as row, r (r)}
                                {#each row as cell, c (c)}
                                    <button
                                        type="button"
                                        class="em-cell"
                                        class:on={cell === 1}
                                        aria-pressed={cell === 1}
                                        aria-label="{r + 1},{c + 1}"
                                        on:click={() => toggleCell(r, c)}
                                    />
                                {/each}
                            {/each}
                        </div>
                    {/if}
                </div>
                {#if $currentPlayerWokaStore}
                    <img
                        class="em-woka"
                        src={$currentPlayerWokaStore}
                        alt=""
                        style="left: {wokaLeft}px"
                        draggable="false"
                    />
                {/if}
            </div>
            {#if !floating && naturalWidth > 0}
                <span class="em-hint">{$LL.mapEditor.edit.upload.gridHint()}</span>
            {/if}
            <span class="em-you">{$LL.mapEditor.edit.upload.youForSize()}</span>
        </div>
        {#if naturalWidth > 0 && !editing}
            <div class="em-ok" class:fits class:warn={!fits}>
                {#if fits}<IconCheck font-size="14" />{:else}<IconInfoCircle font-size="14" />{/if}
                <span>
                    <b
                        >{$LL.mapEditor.edit.upload.sizeLine({
                            width: naturalWidth,
                            height: naturalHeight,
                            tilesWide: Math.round(tilesWide * 10) / 10,
                            tilesHigh: Math.round(tilesHigh * 10) / 10,
                        })}</b
                    >
                    {fits ? $LL.mapEditor.edit.upload.fits() : $LL.mapEditor.edit.upload.doesNotFit({ suggestion })}
                </span>
            </div>
        {/if}
        <div class="em-ebi">{$LL.mapEditor.edit.upload.about()}</div>
        <label class="em-field">
            <span class="em-t">{$LL.mapEditor.edit.upload.name()}</span>
            <input type="text" bind:value={name} data-testid="name" />
        </label>
        <label class="em-field">
            <span class="em-t">{$LL.mapEditor.edit.upload.category()}</span>
            <input
                type="text"
                bind:value={category}
                placeholder={$LL.mapEditor.edit.upload.categoryPlaceholder()}
                data-testid="tags"
            />
        </label>
        <label class="em-field em-switch-row">
            <span class="em-tx">
                <span class="em-t">{$LL.mapEditor.edit.upload.floating()}</span>
                <span class="em-m">{$LL.mapEditor.edit.upload.floatingText()}</span>
            </span>
            <input type="checkbox" class="em-switch" bind:checked={floating} data-testid="floatingObject" />
        </label>
        {#if !floating}
            <div class="em-field">
                <span class="em-tx">
                    <span class="em-t">{$LL.mapEditor.edit.upload.blocks()}</span>
                    <span class="em-m" data-testid="blocks-count"
                        >{blocked === 0
                            ? $LL.mapEditor.edit.upload.blocksNone()
                            : $LL.mapEditor.edit.upload.blocksCount({ count: blocked, total })}</span
                    >
                </span>
            </div>
        {/if}
        <div class="em-field em-depth">
            <label class="em-depth-row">
                <span class="em-t">{$LL.mapEditor.edit.upload.depth()}</span>
                <select bind:value={depth} data-testid="depth">
                    <option value="standing">{$LL.mapEditor.edit.upload.depthStanding()}</option>
                    <option value="ground">{$LL.mapEditor.edit.upload.depthGround()}</option>
                    <option value="custom">{$LL.mapEditor.edit.upload.depthCustom()}</option>
                </select>
            </label>
            <span class="em-m"
                >{depth === "standing"
                    ? $LL.mapEditor.edit.upload.depthStandingText()
                    : depth === "ground"
                    ? $LL.mapEditor.edit.upload.depthGroundText()
                    : $LL.mapEditor.edit.upload.depthCustomText()}</span
            >
        </div>
        {#if depth === "custom"}
            <label class="em-field">
                <span class="em-t">{$LL.mapEditor.edit.upload.moveLine()}</span>
                <input type="range" min="0" max={naturalHeight} bind:value={depthOffset} />
            </label>
        {/if}
        {#if editing && !deleteBlocked}
            <button
                type="button"
                class="em-delete"
                data-testid="removeEntity"
                on:click={() => editing && dispatch("remove", { id: editing.id })}
                >{$LL.mapEditor.edit.upload.delete()}</button
            >
        {/if}
    </div>
    <div class="em-actions">
        <button type="button" class="em-btn em-btn-q" on:click={cancel}>{$LL.mapEditor.edit.upload.cancel()}</button>
        {#if editing}
            <button
                type="button"
                class="em-btn u-cta"
                data-testid="applyEntityModifications"
                disabled={naturalWidth === 0}
                on:click={saveChanges}>{$LL.mapEditor.edit.upload.saveChanges()}</button
            >
        {:else}
            <button
                type="button"
                class="em-btn u-cta"
                data-testid="applyEntityModifications"
                disabled={naturalWidth === 0}
                on:click={() => save().catch((e) => console.error(e))}>{$LL.mapEditor.edit.upload.save()}</button
            >
        {/if}
    </div>
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
        gap: 6px;
        padding-right: 2px;
    }
    .em-ebi {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 10px 0 2px;
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #a78bfa;
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
        padding: 7px 0;
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
        font-weight: 600;
    }
    .em-m {
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
    }
    .em-drop {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        margin-top: 10px;
        padding: 14px;
        border: 1.5px dashed rgba(167, 139, 250, 0.45);
        border-radius: 16px;
        text-align: center;
        cursor: pointer;
        transition: border-color 150ms ease, background-color 150ms ease;
    }
    .em-drop.hover,
    .em-drop:hover {
        border-color: #a78bfa;
        background: rgba(134, 41, 252, 0.08);
    }
    .em-err {
        font-size: 12.5px;
        color: #f7a48f;
    }
    .em-gridbox {
        position: relative;
        flex: none;
        border-radius: 14px;
        overflow: hidden;
        background-color: #2a2438;
        background-image: linear-gradient(rgba(255, 255, 255, 0.14) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.14) 1px, transparent 1px);
        background-size: 32px 32px;
    }
    .em-gridbox-scroll {
        position: absolute;
        inset: 0;
        overflow: auto;
    }
    .em-pic {
        position: absolute;
        left: 32px;
        top: 32px;
        outline: 1.5px dashed rgba(196, 181, 253, 0.9);
        background: rgba(134, 41, 252, 0.12);
    }
    .em-pic img {
        display: block;
        image-rendering: pixelated;
        max-width: none;
    }
    .em-cells {
        position: absolute;
        inset: 0;
        display: grid;
        grid-auto-rows: 32px;
    }
    .em-cell {
        margin: 0;
        padding: 0;
        border: 1px dashed rgba(255, 255, 255, 0.6);
        background: transparent;
        cursor: pointer;
    }
    @media (hover: hover) {
        .em-cell:hover {
            background: rgba(255, 255, 255, 0.16);
        }
    }
    .em-cell.on {
        border-style: solid;
        border-color: #f7a48f;
        background: repeating-linear-gradient(45deg, rgba(233, 109, 81, 0.7) 0 4px, rgba(233, 109, 81, 0.35) 4px 8px);
    }
    .em-line {
        position: absolute;
        left: -10px;
        right: -10px;
        height: 0;
        border-top: 2px solid #a78bfa;
        pointer-events: none;
    }
    .em-line span {
        position: absolute;
        left: calc(100% + 4px);
        font-size: 10px;
        line-height: 1;
        white-space: nowrap;
        color: #c4b5fd;
    }
    .em-line-up {
        bottom: 3px;
    }
    .em-line-down {
        top: 3px;
    }
    .em-hint {
        position: absolute;
        left: 8px;
        top: 8px;
        padding: 3px 8px;
        border-radius: 999px;
        background: rgba(10, 8, 20, 0.7);
        font-size: 11px;
        color: #fff;
        pointer-events: none;
    }
    .em-field.em-depth {
        flex-direction: column;
        align-items: stretch;
        gap: 4px;
    }
    .em-depth-row {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .em-depth-row > .em-t {
        flex: 1;
        font-weight: 400;
    }
    .em-depth-row select {
        flex: 1;
        min-width: 0;
        height: 36px;
        padding: 0 12px;
        border: 0;
        border-radius: 10px;
        background: rgba(0, 0, 0, 0.25);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        font: inherit;
        color: #fff;
        outline: none;
    }
    .em-delete {
        align-self: flex-start;
        margin: 10px 0 4px;
        padding: 10px 0;
        min-height: 44px;
        border: 0;
        background: transparent;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #f7a48f;
        cursor: pointer;
    }
    .em-woka {
        position: absolute;
        top: 64px;
        width: 32px;
        height: 32px;
        image-rendering: pixelated;
        object-fit: contain;
        max-width: none;
    }
    .em-you {
        position: absolute;
        right: 8px;
        bottom: 8px;
        padding: 3px 8px;
        border-radius: 999px;
        background: rgba(10, 8, 20, 0.7);
        font-size: 11px;
        color: rgba(244, 242, 250, 0.64);
    }
    .em-ok {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        font-size: 12.5px;
        line-height: 1.3;
    }
    .em-ok :global(svg) {
        flex: none;
        margin-top: 2px;
    }
    .em-ok.fits {
        color: #7fd99a;
    }
    .em-ok.warn {
        color: #ffb09e;
    }
    .em-field {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 7px 0;
        font-size: 14px;
    }
    .em-field > .em-t {
        flex: 1;
        font-weight: 400;
    }
    .em-field input[type="text"],
    .em-field select {
        flex: 1;
        min-width: 0;
        height: 36px;
        padding: 0 12px;
        border: 0;
        border-radius: 10px;
        background: rgba(0, 0, 0, 0.25);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        font: inherit;
        color: #fff;
        outline: none;
    }
    .em-field input[type="range"] {
        flex: 1;
    }
    .em-switch-row .em-tx {
        flex: 1;
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
    .em-actions {
        display: flex;
        gap: 8px;
        flex: none;
    }
    .em-btn {
        flex: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 40px;
        padding: 0 14px;
        border: 0;
        border-radius: 999px;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
    }
    .em-btn:disabled {
        opacity: 0.5;
        cursor: default;
    }
    .em-btn-q {
        background: rgba(255, 255, 255, 0.08);
    }
</style>
