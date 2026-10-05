<script lang="ts">
    // "Sides and colours" of one of your uploads: the four sides of the chosen colour, the colours, and a row showing
    // how it looks while placing. Every added side or colour is its own picture that carries the first picture's id,
    // so the pictures group into one object and Turn and the colour choice work for it while placing.
    import { createEventDispatcher } from "svelte";
    import type { EntityPrefab } from "@workadventure/map-editor";
    import { ENTITY_UPLOAD_SUPPORTED_FORMATS_FRONT } from "@workadventure/map-editor";
    import { CustomEntityDirection } from "@workadventure/messages";
    import { v4 as uuidv4 } from "uuid";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { mobileLayoutStore } from "../../../Stores/MobileLayoutStore";
    import {
        mapEditorDeleteCustomEntityEventStore,
        mapEditorEntityModeStore,
        mapEditorEntityUploadEventStore,
        mapEditorSelectedEntityPrefabStore,
        mapEditorSelectedEntityStore,
        mapEditorVisibilityStore,
    } from "../../../Stores/MapEditorStore";
    import { editPickedVariantStore } from "../../../Stores/EditModeStore";
    import PanelHeader from "./PanelHeader.svelte";
    import { IconCheck, IconPlus, IconRefresh, IconX } from "@wa-icons";

    /** The id of the upload (its first picture). */
    export let variantId: string;
    /** The colour to show first. */
    export let color = "";

    const dispatch = createEventDispatcher<{ done: undefined }>();
    const variantsStore = gameManager
        .getCurrentGameScene()
        .getEntitiesCollectionsManager()
        .getEntitiesPrefabsVariantStore();

    type Direction = EntityPrefab["direction"];
    type Size = { width: number; height: number };
    const SIDES: { direction: Direction; message: CustomEntityDirection }[] = [
        { direction: "Down", message: CustomEntityDirection.Down },
        { direction: "Left", message: CustomEntityDirection.Left },
        { direction: "Right", message: CustomEntityDirection.Right },
        { direction: "Up", message: CustomEntityDirection.Up },
    ];

    let selectedColor = color;
    /** A colour just picked that has no picture yet; it is real once its first picture is added. */
    let pendingColor: string | undefined;
    let previewDirection: Direction = "Down";
    /** The side a picture is being added to, until the picture shows up. */
    let busy: { color: string; direction: Direction } | undefined;
    let targetDirection: Direction = "Down";
    let error: string | undefined;
    let note: string | undefined;
    let front: Size | undefined;
    let measuredId: string | undefined;
    let fileInput: HTMLInputElement;
    let colorInput: HTMLInputElement;

    $: variant = $variantsStore.find((each) => each.id === variantId);
    $: first = variant?.defaultPrefab;
    $: colors = variant
        ? [
              ...variant.colors,
              ...(pendingColor !== undefined && !variant.colors.includes(pendingColor) ? [pendingColor] : []),
          ]
        : [];
    $: if (first && !colors.includes(selectedColor)) selectedColor = first.color;
    $: sides = SIDES.map((side) => ({ ...side, prefab: variant?.getPrefab(selectedColor, side.direction) }));
    $: filled = sides.filter((side) => side.prefab !== undefined);
    $: preview = variant?.getPrefab(selectedColor, previewDirection) ?? filled[0]?.prefab;
    $: if (busy && variant?.getPrefab(busy.color, busy.direction)) busy = undefined;
    $: if (variant && busy === undefined && $mapEditorEntityUploadEventStore === undefined) {
        // Nothing is uploading: a colour with a picture is no longer pending.
        if (pendingColor !== undefined && variant.colors.includes(pendingColor)) pendingColor = undefined;
    }
    // The first picture sets the size every other side must have.
    $: if (first && first.id !== measuredId) measureFront(first);

    function measureFront(prefab: EntityPrefab) {
        measuredId = prefab.id;
        front = undefined;
        measure(prefab.imagePath)
            .then((size) => (front = size))
            .catch(() => (front = undefined));
    }

    function measure(src: string): Promise<Size> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
            img.onerror = () => reject(new Error("Could not read the picture"));
            img.src = src;
        });
    }

    function sideLabel(direction: Direction): string {
        switch (direction) {
            case "Left":
                return $LL.mapEditor.edit.variants.left();
            case "Right":
                return $LL.mapEditor.edit.variants.right();
            case "Up":
                return $LL.mapEditor.edit.variants.back();
            default:
                return $LL.mapEditor.edit.variants.front();
        }
    }

    function colorLabel(each: string): string {
        return each === "" ? $LL.mapEditor.edit.variants.original() : each.toUpperCase();
    }

    function chooseFile(direction: Direction) {
        error = undefined;
        note = undefined;
        targetDirection = direction;
        fileInput.value = "";
        fileInput.click();
    }

    async function add(files: FileList | null) {
        const file = files?.item(0);
        if (!file || !first) return;
        if (!ENTITY_UPLOAD_SUPPORTED_FORMATS_FRONT.includes(file.type) || file.type.trim() === "") {
            error = $LL.mapEditor.entityEditor.uploadEntity.errorOnFileFormat();
            return;
        }
        const url = URL.createObjectURL(file);
        let size: Size;
        try {
            size = await measure(url);
        } catch {
            error = $LL.mapEditor.entityEditor.uploadEntity.errorOnFileFormat();
            return;
        } finally {
            URL.revokeObjectURL(url);
        }
        if (front && (size.width !== front.width || size.height !== front.height)) {
            error = $LL.mapEditor.edit.variants.wrongSize({
                width: size.width,
                height: size.height,
                expectedWidth: front.width,
                expectedHeight: front.height,
            });
            return;
        }
        const side = SIDES.find((each) => each.direction === targetDirection) ?? SIDES[0];
        const id = uuidv4();
        const buffer = await file.arrayBuffer();
        busy = { color: selectedColor, direction: side.direction };
        previewDirection = side.direction;
        mapEditorEntityUploadEventStore.set({
            id,
            file: new Uint8Array(buffer),
            direction: side.message,
            name: first.name,
            tags: first.tags,
            imagePath: `${id}-${file.name}`,
            collisionGrid: first.collisionGrid,
            depthOffset: first.depthOffset,
            color: selectedColor,
            variantOf: first.id,
        });
    }

    function remove(prefab: EntityPrefab) {
        error = undefined;
        if (!first || prefab.id === first.id) {
            note = $LL.mapEditor.edit.variants.removeFirst();
            return;
        }
        note = undefined;
        mapEditorDeleteCustomEntityEventStore.set({ id: prefab.id });
        if ($mapEditorSelectedEntityPrefabStore?.id === prefab.id) mapEditorSelectedEntityPrefabStore.set(first);
    }

    function pickColor(each: string) {
        error = undefined;
        note = undefined;
        selectedColor = each;
        previewDirection = "Down";
    }

    function addColor() {
        colorInput.click();
    }

    function onColorPicked() {
        const picked = colorInput.value;
        if (!picked) return;
        pendingColor = colors.includes(picked) ? undefined : picked;
        pickColor(picked);
        if (pendingColor !== undefined) note = $LL.mapEditor.edit.variants.pickColour();
    }

    function turn() {
        if (filled.length < 2) return;
        const index = filled.findIndex((side) => side.direction === previewDirection);
        previewDirection = filled[(index + 1) % filled.length].direction;
    }

    function place() {
        if (!variant || !preview) return;
        editPickedVariantStore.set({ variant, color: selectedColor });
        mapEditorSelectedEntityStore.set(undefined);
        mapEditorEntityModeStore.set("ADD");
        mapEditorSelectedEntityPrefabStore.set(preview);
        dispatch("done");
        if ($mobileLayoutStore) mapEditorVisibilityStore.set(false);
    }
</script>

{#if variant && first}
    <PanelHeader title={first.name} onBack={() => dispatch("done")} backLabel={$LL.mapEditor.edit.areas.back()}>
        <svelte:fragment slot="subtitle">
            {$LL.mapEditor.edit.variants.yourUpload()} · {$LL.mapEditor.edit.variants.sideCount({
                count: filled.length,
            })} · {$LL.mapEditor.edit.variants.colourCount({ count: variant.colors.length })}
        </svelte:fragment>
    </PanelHeader>
    <div class="em-scroll" data-testid="upload-variants">
        <div class="em-ebi">{$LL.mapEditor.edit.variants.sides()}</div>
        <div class="em-slots">
            {#each sides as side (side.direction)}
                <div
                    class="em-slot"
                    class:on={side.prefab && side.direction === previewDirection}
                    class:e={!side.prefab}
                >
                    {#if side.prefab}
                        <button
                            type="button"
                            class="em-slot-pic"
                            style="background-image: url({side.prefab.imagePath})"
                            aria-label={sideLabel(side.direction)}
                            aria-pressed={side.direction === previewDirection}
                            data-testid="variant-side-{side.direction}"
                            on:click={() => (previewDirection = side.direction)}
                        />
                        <button
                            type="button"
                            class="em-slot-x"
                            aria-label={$LL.mapEditor.edit.variants.remove()}
                            title={$LL.mapEditor.edit.variants.remove()}
                            data-testid="variant-remove-{side.direction}"
                            on:click={() => side.prefab && remove(side.prefab)}
                        >
                            <IconX font-size="12" />
                        </button>
                    {:else}
                        <button
                            type="button"
                            class="em-slot-pic em-slot-add"
                            aria-label={sideLabel(side.direction)}
                            data-testid="variant-add-{side.direction}"
                            disabled={busy !== undefined}
                            on:click={() => chooseFile(side.direction)}
                        >
                            {#if busy?.direction === side.direction && busy.color === selectedColor}
                                <span class="em-busy">{$LL.mapEditor.edit.variants.uploading()}</span>
                            {:else}
                                <IconPlus font-size="16" />
                            {/if}
                        </button>
                    {/if}
                    <span class="em-slot-l">{sideLabel(side.direction)}</span>
                </div>
            {/each}
        </div>
        {#if error}<div class="em-err" data-testid="variant-error">{error}</div>{/if}
        {#if note}<div class="em-note">{note}</div>{/if}
        <div class="em-m">{$LL.mapEditor.edit.variants.sidesText()}</div>

        <div class="em-ebi">{$LL.mapEditor.edit.variants.colours()}</div>
        <div class="em-chips">
            {#each colors as each (each)}
                <button
                    type="button"
                    class="em-chip"
                    class:on={each === selectedColor}
                    aria-pressed={each === selectedColor}
                    data-testid="variant-colour-{each === '' ? 'original' : each.replace('#', '')}"
                    on:click={() => pickColor(each)}
                >
                    <span class="em-sw" class:none={each === ""} style={each === "" ? "" : `background: ${each}`} />
                    {colorLabel(each)}
                    {#if each === selectedColor}<IconCheck font-size="14" />{/if}
                </button>
            {/each}
            <button type="button" class="em-chip em-chip-add" data-testid="variant-colour-add" on:click={addColor}>
                <IconPlus font-size="14" />{$LL.mapEditor.edit.variants.addColour()}
            </button>
        </div>
        <div class="em-m">{$LL.mapEditor.edit.variants.coloursText()}</div>

        {#if preview}
            <div class="em-ebi">{$LL.mapEditor.edit.variants.preview()}</div>
            <div class="em-prev">
                <button type="button" class="em-prev-go" data-testid="variant-place" on:click={place}>
                    <i class="em-prev-pic" style="background-image: url({preview.imagePath})" />
                    <span class="em-tx">
                        <span class="em-t">{first.name}</span>
                        <span class="em-m">{$LL.mapEditor.edit.variants.placeHint()}</span>
                    </span>
                    <span
                        class="em-sw em-sw-on"
                        class:none={selectedColor === ""}
                        style={selectedColor === "" ? "" : `background: ${selectedColor}`}
                    />
                </button>
                <button
                    type="button"
                    class="em-circ"
                    aria-label={$LL.mapEditor.edit.objects.turn()}
                    title={$LL.mapEditor.edit.objects.turn()}
                    data-testid="variant-turn"
                    disabled={filled.length < 2}
                    on:click={turn}
                >
                    <IconRefresh font-size="16" />
                </button>
            </div>
        {/if}
    </div>
    <input
        class="em-hidden"
        type="file"
        accept={ENTITY_UPLOAD_SUPPORTED_FORMATS_FRONT}
        tabindex="-1"
        aria-hidden="true"
        data-testid="variant-file"
        bind:this={fileInput}
        on:change={(event) => add(event.currentTarget.files).catch((e) => console.error(e))}
    />
    <input
        class="em-hidden"
        type="color"
        tabindex="-1"
        aria-hidden="true"
        data-testid="variant-colour"
        bind:this={colorInput}
        on:change={onColorPicked}
    />
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
    .em-ebi:first-child {
        margin-top: 4px;
    }
    .em-ebi::before {
        content: "";
        width: 12px;
        height: 1px;
        background: currentColor;
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
    .em-err {
        font-size: 12.5px;
        line-height: 1.3;
        color: #f7a48f;
    }
    .em-note {
        font-size: 12.5px;
        line-height: 1.3;
        color: #c4b5fd;
    }
    .em-slots {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 4px;
    }
    .em-slot {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        color: rgba(244, 242, 250, 0.64);
    }
    .em-slot.on {
        color: #fff;
    }
    .em-slot-pic {
        display: grid;
        place-items: center;
        width: 52px;
        height: 52px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.04) center / auto 70% no-repeat;
        box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.1);
        image-rendering: pixelated;
        color: #fff;
        cursor: pointer;
    }
    .em-slot.on .em-slot-pic {
        box-shadow: inset 0 0 0 2px #a78bfa, 0 0 0 3px rgba(167, 139, 250, 0.2);
    }
    .em-slot-add {
        box-shadow: none;
        border: 1.5px dashed rgba(255, 255, 255, 0.22);
        background: transparent;
    }
    .em-slot-add:disabled {
        cursor: default;
        opacity: 0.6;
    }
    .em-busy {
        font-size: 10px;
        color: rgba(244, 242, 250, 0.64);
    }
    .em-slot-x {
        position: absolute;
        top: -4px;
        right: calc(50% - 32px);
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: #2a2438;
        box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.18);
        color: #fff;
        cursor: pointer;
    }
    .em-slot-l {
        white-space: nowrap;
    }
    .em-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
    }
    .em-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 30px;
        margin: 0;
        padding: 0 12px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        font: inherit;
        font-size: 13px;
        font-weight: 500;
        color: #fff;
        white-space: nowrap;
        cursor: pointer;
    }
    .em-chip.on {
        background: linear-gradient(135deg, #8629fc, #4156f6);
        box-shadow: none;
    }
    .em-chip-add {
        color: rgba(244, 242, 250, 0.64);
    }
    .em-sw {
        flex: none;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.25);
    }
    .em-sw.none {
        /* The colour of the first picture, which has no name: a hatched dot. */
        background: repeating-linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.32) 0 3px,
            rgba(255, 255, 255, 0.08) 3px 6px
        );
    }
    .em-sw-on {
        width: 22px;
        height: 22px;
        box-shadow: inset 0 0 0 2px #fff;
    }
    .em-prev {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .em-prev-go {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 0;
        padding: 8px 10px;
        border: 0;
        border-radius: 12px;
        background: rgba(0, 0, 0, 0.25);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        font: inherit;
        color: #fff;
        text-align: left;
        cursor: pointer;
    }
    @media (hover: hover) {
        .em-prev-go:hover {
            background: rgba(0, 0, 0, 0.35);
        }
    }
    .em-prev-pic {
        flex: none;
        width: 34px;
        height: 34px;
        background: center / auto 90% no-repeat;
        image-rendering: pixelated;
    }
    .em-tx {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
    }
    .em-circ {
        display: grid;
        place-items: center;
        flex: none;
        width: 34px;
        height: 34px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
        cursor: pointer;
    }
    .em-circ:disabled {
        opacity: 0.4;
        cursor: default;
    }
    @media (hover: hover) {
        .em-circ:not(:disabled):hover,
        .em-slot-pic:hover,
        .em-slot-x:hover {
            filter: brightness(1.2);
        }
    }
    .em-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
    }
</style>
