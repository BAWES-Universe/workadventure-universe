<script lang="ts" context="module">
    // Every WOKA picture is loaded once and shared by all the tiles that draw it
    const imageCache = new Map<string, HTMLImageElement>();

    function cachedImage(url: string): HTMLImageElement {
        let img = imageCache.get(url);
        if (!img) {
            img = new window.Image();
            // Set crossOrigin before src so the image is only fetched once
            img.crossOrigin = "user-credentials";
            img.src = url;
            imageCache.set(url, img);
        }
        return img;
    }
</script>

<script lang="ts">
    import { afterUpdate, onDestroy, onMount } from "svelte";
    import type { WokaData, WokaTexture } from "./WokaTypes";

    export let selectedTextures: Record<string, string>;
    export let wokaData: WokaData | null = null;
    export let canvasSize = 64;
    export let direction: number = 0;
    export let getTextureUrl: (url: string) => string = (url) => url;
    export let classList: string = "";
    /** Walks on the spot (the game's walk cycle) instead of standing still. Stands still for reduced motion. */
    export let walking = false;

    const bodyPartOrder = ["body", "eyes", "hair", "clothes", "hat", "accessory", "woka"];

    let canvas: HTMLCanvasElement;
    let ctx: CanvasRenderingContext2D | undefined;
    let images: Record<string, HTMLImageElement> = {};
    let loadedUrlsKey: string | undefined;
    // The game's walk cycle is columns 0, 1, 2, 1 at 10 frames a second (Animation.ts)
    const walkCycle = [0, 1, 2, 1];
    let walkStep = 0;
    let walkTimer: ReturnType<typeof setInterval> | undefined;
    $: frame = walking ? walkCycle[walkStep] : 0;

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
            const img = cachedImage(url);
            if (!img.complete) {
                img.addEventListener(
                    "load",
                    () => {
                        if (images[part] === img) draw();
                    },
                    { once: true }
                );
            }
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

    function updateWalkTimer(walk: boolean) {
        if (walkTimer) clearInterval(walkTimer);
        walkTimer = undefined;
        walkStep = 0;
        if (!walk || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
        walkTimer = setInterval(() => {
            walkStep = (walkStep + 1) % walkCycle.length;
        }, 100);
    }
    $: updateWalkTimer(walking);

    onMount(() => {
        const context = canvas.getContext("2d");
        if (!context) return;
        ctx = context;
        draw();
    });

    onDestroy(() => {
        if (walkTimer) clearInterval(walkTimer);
    });
</script>

<canvas
    bind:this={canvas}
    width={canvasSize}
    height={canvasSize}
    style="image-rendering: pixelated;"
    class={classList}
/>
