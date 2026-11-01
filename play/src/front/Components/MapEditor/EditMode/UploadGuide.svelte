<script lang="ts">
    // "Add your own": four short rules before the picture is chosen, then a check of the picture at real size on the
    // tile grid, with your own character walking past it. The red squares (where people bump into it) and the front and
    // back line are the only settings; the three cards read them back, so what they say is always true (#1694).
    // "Edit this upload" opens the same check page with the upload's saved values (#1637).
    import { createEventDispatcher, onDestroy } from "svelte";
    import { ENTITY_UPLOAD_SUPPORTED_FORMATS_FRONT } from "@workadventure/map-editor";
    import type { EntityPrefab } from "@workadventure/map-editor";
    import { CustomEntityDirection } from "@workadventure/messages";
    import { v4 as uuidv4 } from "uuid";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { mapEditorEntityUploadEventStore, selectCategoryStore } from "../../../Stores/MapEditorStore";
    import { currentPlayerWokaStore } from "../../../Stores/CurrentPlayerWokaStore";
    import { warningMessageStore } from "../../../Stores/ErrorStore";
    import RangeSlider from "../../Input/RangeSlider.svelte";
    import PanelHeader from "./PanelHeader.svelte";
    import { deleteStep } from "./uploadCopies";
    import type { DeleteStep, PlacedIn } from "./uploadCopies";
    import { IconCheck, IconCloudUpload, IconEye, IconInfoCircle, IconRefresh, IconStar, IconTexture } from "@wa-icons";

    /** The upload to change; without it the page adds a new one. */
    export let editing: EntityPrefab | undefined = undefined;
    // Set when this person may not delete the upload (#1628): "Delete this upload" is then left out, with no reason shown.
    // The uploader may not delete it while a copy sits where they can't edit: then only map editors can (#1628).
    export let deleteBlocked = false;

    // Where the upload is placed, asked before it is deleted (#1690): when it is placed anywhere, "Delete this upload"
    // opens a box listing every room and how many copies go.
    export let loadPlacedIn: (() => Promise<PlacedIn[]>) | undefined = undefined;

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
    // What happens when people walk into it, read back from the red squares and the line
    type Meet = "bump" | "through" | "over";
    // The front and back line, when set with the slider (or saved by hand on an older upload). Unset, it follows
    // the red squares.
    let lineSet: number | undefined;
    // Squares where the picture touches the floor, and the lowest painted pixel row: read from the picture itself
    let baseCells: number[][] = [];
    let paintedBottom = 0;
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
        lineSet = undefined;
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
        readPicture(img, columns, rows);
        if (!editing) {
            grid = baseCells.map((row) => [...row]);
            return;
        }
        // A saved line stays exactly as saved. It only follows the squares when it already sits at them.
        const saved = -(editing.depthOffset ?? 0);
        lineSet =
            grid.some((row) => row.includes(1)) && saved === autoLine(grid, naturalHeight, paintedBottom)
                ? undefined
                : saved;
    }

    function readPicture(img: HTMLImageElement, columns: number, rows: number, retried = false) {
        baseCells = Array(rows)
            .fill(0)
            .map(() => Array(columns).fill(0));
        paintedBottom = naturalHeight;
        try {
            const canvas = document.createElement("canvas");
            canvas.width = naturalWidth;
            canvas.height = naturalHeight;
            const context = canvas.getContext("2d");
            if (!context) throw new Error("no canvas");
            context.drawImage(img, 0, 0);
            const data = context.getImageData(0, 0, naturalWidth, naturalHeight).data;
            const painted = (x: number, y: number) => data[(y * naturalWidth + x) * 4 + 3] > 32;
            let bottom = 0;
            for (let y = naturalHeight - 1; y >= 0 && bottom === 0; y--) {
                for (let x = 0; x < naturalWidth; x++) {
                    if (painted(x, y)) {
                        bottom = y + 1;
                        break;
                    }
                }
            }
            if (bottom === 0) throw new Error("empty picture");
            paintedBottom = bottom;
            const row = Math.min(rows - 1, Math.floor((bottom - 1) / TILE));
            // Columns whose paint reaches the floor: the last few pixel rows above the painted bottom
            for (let column = 0; column < columns; column++) {
                for (let y = Math.max(0, bottom - 8); y < bottom && baseCells[row][column] === 0; y++) {
                    for (let x = column * TILE; x < Math.min(naturalWidth, (column + 1) * TILE); x++) {
                        if (painted(x, y)) {
                            baseCells[row][column] = 1;
                            break;
                        }
                    }
                }
            }
        } catch {
            // A picture we can't read: its bottom row of squares
            baseCells[rows - 1] = baseCells[rows - 1].map(() => 1);
            // A saved upload comes from map-storage, which can be another site: the page can't read its pixels unless
            // it's loaded again for reading. If that fails too, the bottom row stays.
            if (!retried && !img.src.startsWith("blob:")) {
                const copy = new Image();
                copy.crossOrigin = "anonymous";
                copy.onload = () => {
                    if (naturalWidth === copy.naturalWidth && naturalHeight === copy.naturalHeight) {
                        readPicture(copy, columns, rows, true);
                    }
                };
                copy.src = img.src;
            }
        }
    }

    // Where people start going behind it, measured up from the picture's bottom edge: the front edge of the red squares;
    // with none, the bottom of what's painted.
    // The picture's numbers are passed in so the reactive line below updates when a later read finds the painted bottom.
    function autoLine(cells: number[][], height: number, bottom: number): number {
        const lowest = cells.reduce((low, row, r) => (row.includes(1) ? r : low), -1);
        if (lowest < 0) return Math.max(0, height - bottom);
        return Math.max(0, height - (lowest + 1) * TILE);
    }

    function pick(how: Meet) {
        if (how === "bump") {
            if (!grid.some((row) => row.includes(1))) grid = baseCells.map((row) => [...row]);
        } else {
            grid = grid.map((row) => row.map(() => 0));
        }
        // "Walk over it" is the line at the very top: people always show on top
        lineSet = how === "over" ? naturalHeight : undefined;
    }

    function onDrop(event: DragEvent) {
        dropHover = false;
        take(event.dataTransfer?.files);
    }

    function toggleCell(row: number, column: number) {
        grid[row][column] = grid[row][column] === 0 ? 1 : 0;
        grid = grid;
        // Squares on a rug: people now stop at it, so it can't keep everyone on top
        if (grid[row][column] === 1 && lineSet === naturalHeight) lineSet = undefined;
    }

    $: tilesWide = naturalWidth / TILE;
    $: tilesHigh = naturalHeight / TILE;
    $: fits = naturalWidth > 0 && Number.isInteger(tilesWide) && Number.isInteger(tilesHigh);
    $: suggestion = `${Math.max(1, Math.round(tilesWide)) * TILE} × ${Math.max(1, Math.round(tilesHigh)) * TILE}`;
    // The check box draws the picture at real size with a tile above and below it, so you stay in view as you walk
    // behind it and in front of it; it scrolls when the picture is big.
    $: boxHeight = Math.max(4 * TILE, Math.min(7 * TILE, Math.ceil(naturalHeight / TILE) * TILE + 2 * TILE));
    $: blocked = grid.reduce((sum, row) => sum + row.filter((cell) => cell === 1).length, 0);
    // No red squares saves like the old "Floats" switch: no grid at all (placing it snaps differently with a grid).
    // An older upload saved with an empty grid keeps it; one whose red squares were all taken off saves no grid.
    $: floating =
        blocked === 0 &&
        (editing === undefined ||
            editing.collisionGrid === undefined ||
            editing.collisionGrid.some((row) => row.includes(1)));
    $: baseCount = Math.max(
        1,
        baseCells.reduce((sum, row) => sum + row.filter((cell) => cell === 1).length, 0)
    );
    $: autoLineNow = naturalHeight > 0 ? autoLine(grid, naturalHeight, paintedBottom) : 0;
    $: lineFromBottom = lineSet ?? autoLineNow;
    $: meet = (
        blocked > 0 ? "bump" : naturalHeight > 0 && lineFromBottom >= naturalHeight ? "over" : "through"
    ) as Meet;
    $: lineTop = Math.max(0, naturalHeight - lineFromBottom);
    // The walking you: just behind the squares it stands on, then just in front of it
    $: topRow = grid.findIndex((row) => row.includes(1));
    $: backFeet = meet === "bump" && lineSet === undefined && topRow >= 0 ? topRow * TILE - 2 : lineTop - 6;
    $: frontFeet = lineTop + 22;
    $: meets = [
        {
            value: "bump" as Meet,
            label: $LL.mapEditor.edit.upload.meetBump(),
            like: $LL.mapEditor.edit.upload.meetBumpLike({ count: blocked || baseCount }),
        },
        {
            value: "through" as Meet,
            label: $LL.mapEditor.edit.upload.meetThrough(),
            like: $LL.mapEditor.edit.upload.meetThroughLike(),
        },
        {
            value: "over" as Meet,
            label: $LL.mapEditor.edit.upload.meetOver(),
            like: $LL.mapEditor.edit.upload.meetOverLike(),
        },
    ];

    function tagsOf(text: string): string[] {
        return text
            .split(",")
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0);
    }

    function saveChanges() {
        if (!editing) return;
        closed = true;
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
        closed = true;
        dispatch("done");
    }

    // Set once the guide is left (Cancel, Save, or closed): a lookup that answers later then does nothing
    let closed = false;
    let checking = false;
    let confirming: Extract<DeleteStep, { ask: true }> | undefined;

    function askDelete() {
        if (!editing || checking) return;
        const id = editing.id;
        if (!loadPlacedIn) {
            dispatch("remove", { id });
            return;
        }
        checking = true;
        loadPlacedIn()
            .then((placedIn) => {
                if (closed) return;
                const step = deleteStep(placedIn);
                if (step.ask) {
                    confirming = step;
                } else {
                    dispatch("remove", { id });
                }
            })
            .catch((e) => {
                console.error(e);
                if (closed) return;
                warningMessageStore.addWarningMessage($LL.mapEditor.editNotSaved());
            })
            .finally(() => {
                checking = false;
            });
    }

    onDestroy(() => {
        closed = true;
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
                <div class="em-pic">
                    <img src={imageUrl} alt={name} draggable="false" on:load={onLoad} />
                    {#if naturalHeight > 0 && $currentPlayerWokaStore}
                        <img
                            class="em-walker"
                            class:over={meet === "over"}
                            src={$currentPlayerWokaStore}
                            alt=""
                            draggable="false"
                            style="--x0: -30px; --x1: {naturalWidth + 6}px; --back: {backFeet -
                                TILE}px; --front: {frontFeet - TILE}px; --mid: {Math.round(naturalHeight * 0.7) -
                                TILE}px"
                        />
                    {/if}
                    {#if naturalHeight > 0}
                        <div class="em-line" style="top: {lineTop}px" data-testid="front-back-line" />
                    {/if}
                    {#if grid.length > 0}
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
            </div>
            {#if naturalWidth > 0}
                <span class="em-hint"
                    >{blocked > 0
                        ? $LL.mapEditor.edit.upload.gridHint()
                        : $LL.mapEditor.edit.upload.gridHintNone()}</span
                >
            {/if}
            <span class="em-you">{$LL.mapEditor.edit.upload.walkingYou()}</span>
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
        <div class="em-ebi">{$LL.mapEditor.edit.upload.meetTitle()}</div>
        <div class="em-meet" role="radiogroup" aria-label={$LL.mapEditor.edit.upload.meetTitle()}>
            {#each meets as m (m.value)}
                <button
                    type="button"
                    role="radio"
                    class="em-meet-card"
                    class:on={meet === m.value}
                    aria-checked={meet === m.value}
                    data-testid="meet-{m.value}"
                    on:click={() => pick(m.value)}
                >
                    <span class="em-thumb {m.value}">
                        <img class="em-thumb-pic" src={imageUrl} alt="" draggable="false" />
                        {#if $currentPlayerWokaStore}<img
                                class="em-thumb-you"
                                src={$currentPlayerWokaStore}
                                alt=""
                                draggable="false"
                            />{/if}
                    </span>
                    <span class="em-t">{m.label}</span>
                    <span class="em-m">{m.like}</span>
                </button>
            {/each}
        </div>
        <span class="em-m em-meet-text"
            >{meet === "bump"
                ? $LL.mapEditor.edit.upload.standsOnCount(blocked)
                : meet === "through"
                ? $LL.mapEditor.edit.upload.throughText()
                : $LL.mapEditor.edit.upload.overText()}</span
        >
        {#if naturalHeight > 0}
            <div class="em-field em-depth">
                <span class="em-t">{$LL.mapEditor.edit.upload.lineTitle()}</span>
                <span class="em-m">{$LL.mapEditor.edit.upload.lineText()}</span>
                <div class="em-line-row">
                    <span class="em-m">{$LL.mapEditor.edit.upload.lineBase()}</span>
                    <div class="em-line-slider" data-testid="front-back">
                        <RangeSlider
                            min={0}
                            max={naturalHeight}
                            step={1}
                            value={lineFromBottom}
                            onChange={(v) => (lineSet = v)}
                            variant="secondary"
                            buttonShape="square"
                            wrapperMargins={false}
                            ariaLabel={$LL.mapEditor.edit.upload.lineTitle()}
                        />
                    </div>
                    <span class="em-m">{$LL.mapEditor.edit.upload.lineTop()}</span>
                </div>
                {#if lineSet !== undefined && meet !== "over" && lineSet !== autoLineNow}
                    <button type="button" class="em-link" on:click={() => (lineSet = undefined)}
                        >{blocked > 0
                            ? $LL.mapEditor.edit.upload.lineToSquares()
                            : $LL.mapEditor.edit.upload.lineToBase()}</button
                    >
                {/if}
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
        {#if editing && !deleteBlocked}
            <button type="button" class="em-delete" data-testid="removeEntity" disabled={checking} on:click={askDelete}
                >{$LL.mapEditor.edit.upload.delete()}</button
            >
        {/if}
    </div>
    {#if editing && confirming}
        <div
            class="em-confirm"
            role="alertdialog"
            aria-label={$LL.mapEditor.edit.upload.deleteTitle({ name: editing.name })}
            data-testid="deleteUploadBox"
        >
            <div class="em-confirm-title">{$LL.mapEditor.edit.upload.deleteTitle({ name: editing.name })}</div>
            <div class="em-m">{$LL.mapEditor.edit.upload.deletePlaced({ count: confirming.total })}</div>
            <ul class="em-confirm-rooms">
                {#each confirming.rooms as room, index (index)}
                    <li data-testid="deleteUploadRoom">
                        <span>{room.thisRoom ? $LL.mapEditor.edit.upload.deleteThisRoom() : room.name}</span>
                        <span class="em-confirm-count">{room.count}</span>
                    </li>
                {/each}
            </ul>
            <div class="em-m">{$LL.mapEditor.edit.upload.deleteWarning()}</div>
            <div class="em-confirm-actions">
                <button
                    type="button"
                    class="em-btn em-btn-q"
                    data-testid="keepUpload"
                    on:click={() => (confirming = undefined)}>{$LL.mapEditor.edit.upload.deleteKeep()}</button
                >
                <button
                    type="button"
                    class="em-btn u-cta-coral"
                    data-testid="deleteUploadEverywhere"
                    on:click={() => editing && dispatch("remove", { id: editing.id })}
                    >{$LL.mapEditor.edit.upload.deleteAll()}</button
                >
            </div>
        </div>
    {:else}
        <div class="em-actions">
            <button type="button" class="em-btn em-btn-q" on:click={cancel}>{$LL.mapEditor.edit.upload.cancel()}</button
            >
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
    .em-pic > img:first-child {
        position: relative;
        z-index: 1;
    }
    .em-pic img {
        display: block;
        image-rendering: pixelated;
        max-width: none;
    }
    .em-cells {
        position: absolute;
        z-index: 2;
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
        z-index: 4;
        border-top: 2px solid #a78bfa;
        pointer-events: none;
    }
    /* You walk past the picture: behind it first, then in front of it */
    .em-walker {
        position: absolute;
        left: 0;
        top: 0;
        width: 32px;
        height: 32px;
        z-index: 0;
        pointer-events: none;
        image-rendering: pixelated;
        animation: em-walk 7s linear infinite;
    }
    .em-walker.over {
        animation-name: em-walk-over;
    }
    @keyframes em-walk {
        0% {
            transform: translate(var(--x0), var(--back));
            z-index: 0;
        }
        40% {
            transform: translate(var(--x1), var(--back));
            z-index: 0;
        }
        49.9% {
            transform: translate(var(--x1), var(--front));
            z-index: 0;
        }
        50% {
            transform: translate(var(--x1), var(--front));
            z-index: 3;
        }
        90% {
            transform: translate(var(--x0), var(--front));
            z-index: 3;
        }
        99.9% {
            transform: translate(var(--x0), var(--back));
            z-index: 3;
        }
        100% {
            transform: translate(var(--x0), var(--back));
            z-index: 0;
        }
    }
    @keyframes em-walk-over {
        0% {
            transform: translate(var(--x0), var(--mid));
            z-index: 3;
        }
        50% {
            transform: translate(var(--x1), var(--mid));
            z-index: 3;
        }
        100% {
            transform: translate(var(--x0), var(--mid));
            z-index: 3;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        /* Standing still, half behind it */
        .em-walker {
            animation: none;
            transform: translate(12px, var(--back));
        }
    }
    .em-meet {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
    }
    .em-meet-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        min-height: 44px;
        padding: 8px 4px 10px;
        border: 0;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.05);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.16);
        font: inherit;
        color: #fff;
        text-align: center;
        cursor: pointer;
    }
    .em-meet-card.on {
        background: rgba(167, 139, 250, 0.18);
        box-shadow: inset 0 0 0 1.5px #a78bfa;
    }
    .em-meet-card .em-t {
        font-size: 13px;
        font-weight: 600;
    }
    .em-meet-card .em-m {
        font-size: 11px;
    }
    .em-thumb {
        position: relative;
        width: 64px;
        height: 52px;
        margin-bottom: 4px;
    }
    .em-thumb img {
        position: absolute;
        image-rendering: pixelated;
        max-width: none;
    }
    .em-thumb-pic {
        height: 44px;
        bottom: 4px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 1;
    }
    .em-thumb-you {
        width: 22px;
        height: 22px;
    }
    .em-thumb.bump .em-thumb-pic {
        left: 38%;
    }
    .em-thumb.bump .em-thumb-you {
        left: 44px;
        bottom: 2px;
        z-index: 2;
    }
    .em-thumb.through .em-thumb-you {
        left: 28px;
        bottom: 12px;
        z-index: 0;
    }
    .em-thumb.over .em-thumb-you {
        left: 21px;
        bottom: 22px;
        z-index: 2;
    }
    .em-line-row {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 44px;
    }
    .em-line-slider {
        flex: 1;
        min-width: 0;
        /* room for the knob at both ends, clear of "Base" and "Top" */
        padding: 0 14px;
    }
    .em-meet-text {
        padding: 2px 2px 0;
    }
    .em-link {
        align-self: flex-start;
        min-height: 44px;
        padding: 0;
        border: 0;
        background: transparent;
        font: inherit;
        font-size: 13px;
        color: #c4b5fd;
        text-decoration: underline;
        text-underline-offset: 3px;
        cursor: pointer;
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
    .em-field input[type="text"] {
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
    .em-confirm {
        flex: none;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 14px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.04);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    }
    .em-confirm-title {
        font-size: 15px;
        font-weight: 600;
    }
    /* Many rooms scroll inside the box, so the buttons stay in view: there is no cap on the list. */
    .em-confirm-rooms {
        margin: 0;
        padding: 0;
        list-style: none;
        max-height: 132px;
        overflow-y: auto;
        scrollbar-width: thin;
    }
    .em-confirm-rooms li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 44px;
        font-size: 14px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    .em-confirm-count {
        flex: none;
        color: rgba(244, 242, 250, 0.64);
        font-variant-numeric: tabular-nums;
    }
    .em-confirm-actions {
        display: flex;
        gap: 8px;
    }
    .em-confirm-actions .em-btn {
        height: 44px;
    }
</style>
