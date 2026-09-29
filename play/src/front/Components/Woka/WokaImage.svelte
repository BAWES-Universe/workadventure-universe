<script lang="ts">
    import { afterUpdate, onMount } from "svelte";
    import type { WokaData, WokaTexture } from "./WokaTypes";

    export let selectedTextures: Record<string, string>;
    export let wokaData: WokaData | null = null;
    export let canvasSize = 64;
    export let direction: number = 0;
    export let getTextureUrl: (url: string) => string = (url) => url;
    export let classList: string = "";

    const bodyPartOrder = ["body", "eyes", "hair", "clothes", "hat", "accessory", "woka"];

    let canvas: HTMLCanvasElement;
    let ctx: CanvasRenderingContext2D | undefined;
    let images: Record<string, HTMLImageElement> = {};
    let loadedUrlsKey: string | undefined;
    const frame = 0;

    function findTextureUrl(
        bodyPart: string,
        textures: Record<string, string>,
        data: WokaData | null,
        toUrl: (url: string) => string
    ): string | null {
        const textureId = textures?.[bodyPart];
        if (!textureId || !data?.[bodyPart]?.collections) return null;
        for (const collection of data[bodyPart].collections) {
            const texture = collection.textures.find((t: WokaTexture) => t.id === textureId);
            if (texture) return toUrl(texture.url);
        }
        return null;
    }

    function loadImages(urls: Record<string, string>) {
        const nextImages: Record<string, HTMLImageElement> = {};
        for (const part of bodyPartOrder) {
            const url = urls[part];
            if (!url) continue;
            const img = new window.Image();
            // Set crossOrigin before src so the image is only fetched once
            img.crossOrigin = "user-credentials";
            img.onload = () => {
                if (images[part] === img) draw();
            };
            img.src = url;
            nextImages[part] = img;
        }
        images = nextImages;
        draw();
    }

    // The woka is a still frame, so draw only when an image finishes loading or an input changes,
    // instead of redrawing every animation frame.
    function draw() {
        if (!ctx || !canvas) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;
        for (const part of bodyPartOrder) {
            const img = images[part];
            if (img && img.complete && img.naturalWidth > 0) {
                ctx.drawImage(img, frame * 32, direction * 32, 32, 32, 0, 0, canvasSize, canvasSize);
            }
        }
    }

    $: urls = Object.fromEntries(
        bodyPartOrder
            .map((part) => [part, findTextureUrl(part, selectedTextures, wokaData, getTextureUrl)] as const)
            .filter((entry): entry is readonly [string, string] => entry[1] !== null)
    );

    // Only reload when the resolved image URLs change, so a parent re-render with an equal
    // texture selection keeps the current picture instead of flashing blank.
    $: {
        const key = JSON.stringify(urls);
        if (key !== loadedUrlsKey) {
            loadedUrlsKey = key;
            loadImages(urls);
        }
    }

    // Runs after direction or canvasSize changes have reached the DOM (resizing clears the canvas)
    afterUpdate(draw);

    onMount(() => {
        const context = canvas.getContext("2d");
        if (!context) return;
        ctx = context;
        draw();
    });
</script>

<canvas
    bind:this={canvas}
    width={canvasSize}
    height={canvasSize}
    style="image-rendering: pixelated;"
    class={classList}
/>
