<script lang="ts">
    // "Add your own": four short rules before the picture is chosen, then a check of the picture at real size on the
    // tile grid next to your own character, with the same fields as today's upload (name, tags, blocking grid, depth).
    import { createEventDispatcher, onDestroy } from "svelte";
    import { ENTITY_UPLOAD_SUPPORTED_FORMATS_FRONT } from "@workadventure/map-editor";
    import { CustomEntityDirection } from "@workadventure/messages";
    import { v4 as uuidv4 } from "uuid";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { mapEditorEntityUploadEventStore, selectCategoryStore } from "../../../Stores/MapEditorStore";
    import { currentPlayerWokaStore } from "../../../Stores/CurrentPlayerWokaStore";
    import PanelHeader from "./PanelHeader.svelte";
    import { IconCheck, IconCloudUpload, IconEye, IconInfoCircle, IconRefresh, IconStar, IconTexture } from "@wa-icons";

    const dispatch = createEventDispatcher<{ done: undefined }>();
    const TILE = 32;

    let file: File | undefined;
    let imageUrl: string | undefined;
    let naturalWidth = 0;
    let naturalHeight = 0;
    let error: string | undefined;
    let dropHover = false;

    let name = "";
    let category = "";
    let floating = false;
    let depth: "standing" | "ground" | "custom" = "standing";
    let depthOffset = 0;
    let grid: number[][] = [];

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
        grid = Array(rows)
            .fill(0)
            .map(() => Array(columns).fill(0));
        depthOffset = 0;
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
    // The check box draws the picture at real size, so it is at least 3 tiles high and scrolls when the picture is big.
    $: boxHeight = Math.max(3 * TILE, Math.min(6 * TILE, Math.ceil(naturalHeight / TILE) * TILE + TILE));
    $: wokaLeft = Math.min(TILE * 1.5 + naturalWidth + TILE, 7 * TILE);

    async function save() {
        if (!file) return;
        const buffer = await file.arrayBuffer();
        const id = uuidv4();
        const tags = category
            .split(",")
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0);
        const offset = depth === "standing" ? 0 : depth === "ground" ? -naturalHeight : -depthOffset;
        mapEditorEntityUploadEventStore.set({
            id,
            file: new Uint8Array(buffer),
            direction: CustomEntityDirection.Down,
            name: name.trim() || file.name,
            tags,
            imagePath: `${id}-${file.name}`,
            collisionGrid: floating ? undefined : grid,
            depthOffset: offset,
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

{#if !file}
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
        title={$LL.mapEditor.edit.upload.checkTitle()}
        subtitle={$LL.mapEditor.edit.upload.checkSubtitle()}
        onBack={() => (file = undefined)}
        backLabel={$LL.mapEditor.edit.areas.back()}
    />
    <div class="em-scroll em-check">
        <div class="em-gridbox" style="height: {boxHeight}px">
            <div class="em-gridbox-scroll">
                <div class="em-pic" class:floating>
                    <img src={imageUrl} alt={name} draggable="false" on:load={onLoad} />
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
            <span class="em-you">{$LL.mapEditor.edit.upload.youForSize()}</span>
        </div>
        {#if naturalWidth > 0}
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
                    <span class="em-m">{$LL.mapEditor.edit.upload.blocksText()}</span>
                </span>
            </div>
        {/if}
        <label class="em-field">
            <span class="em-t">{$LL.mapEditor.edit.upload.depth()}</span>
            <select bind:value={depth}>
                <option value="standing">{$LL.mapEditor.edit.upload.depthStanding()}</option>
                <option value="ground">{$LL.mapEditor.edit.upload.depthGround()}</option>
                <option value="custom">{$LL.mapEditor.edit.upload.depthCustom()}</option>
            </select>
        </label>
        {#if depth === "custom"}
            <label class="em-field">
                <span class="em-m"
                    >{$LL.mapEditor.entityEditor.customEntityEditorForm.wokaAbove()} ↔ {$LL.mapEditor.entityEditor.customEntityEditorForm.wokaBelow()}</span
                >
                <input type="range" min="0" max={naturalHeight} bind:value={depthOffset} />
            </label>
        {/if}
    </div>
    <div class="em-actions">
        <button type="button" class="em-btn em-btn-q" on:click={cancel}>{$LL.mapEditor.edit.upload.cancel()}</button>
        <button
            type="button"
            class="em-btn u-cta"
            data-testid="applyEntityModifications"
            disabled={naturalWidth === 0}
            on:click={() => save().catch((e) => console.error(e))}>{$LL.mapEditor.edit.upload.save()}</button
        >
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
        border: 1px solid rgba(255, 255, 255, 0.25);
        background: transparent;
        cursor: pointer;
    }
    .em-cell.on {
        background: rgba(233, 109, 81, 0.55);
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
