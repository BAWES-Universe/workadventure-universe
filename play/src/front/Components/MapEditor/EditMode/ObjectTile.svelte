<script lang="ts">
    // One object in the picker: its picture on a rounded tile and its name under it.
    import type { EntityVariant } from "../../../Phaser/Game/MapEditor/Entities/EntityVariant";
    import EntityImage from "../EntityEditor/EntityItem/EntityImage.svelte";

    export let variant: EntityVariant;
    export let active = false;
    export let onPick: (variant: EntityVariant) => void;
</script>

<button
    type="button"
    class="em-ot"
    class:on={active}
    data-testid="entity-item"
    title={variant.defaultPrefab.name}
    on:click={() => onPick(variant)}
>
    <i class="em-ot-pic">
        <EntityImage
            classNames="em-ot-img"
            imageSource={variant.defaultPrefab.imagePath}
            imageAlt={variant.defaultPrefab.name}
        />
    </i>
    <span class="em-ot-name">{variant.defaultPrefab.name}</span>
</button>

<style>
    .em-ot {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        min-width: 0;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        font: inherit;
        font-size: 11px;
        line-height: 1.2;
        color: rgba(244, 242, 250, 0.64);
        text-align: center;
        cursor: pointer;
    }
    .em-ot.on {
        color: #fff;
    }
    .em-ot-pic {
        display: grid;
        place-items: center;
        width: 100%;
        aspect-ratio: 1;
        max-width: 72px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.05);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
        overflow: hidden;
        transition: background-color 150ms ease, box-shadow 150ms ease;
    }
    @media (hover: hover) {
        .em-ot:hover .em-ot-pic {
            background: rgba(255, 255, 255, 0.1);
        }
    }
    .em-ot.on .em-ot-pic {
        box-shadow: inset 0 0 0 2px #a78bfa, 0 0 0 3px rgba(167, 139, 250, 0.2);
    }
    .em-ot-pic :global(.em-ot-img) {
        max-width: 72%;
        max-height: 72%;
        object-fit: contain;
    }
    .em-ot-name {
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .em-ot:focus-visible {
        outline: none;
    }
    .em-ot:focus-visible .em-ot-pic {
        box-shadow: inset 0 0 0 2px #fff;
    }
</style>
