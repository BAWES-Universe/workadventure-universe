<script lang="ts">
    // Where a Brick's computer screen opens (Watch, game #2000). On a phone, or when the chat takes the width, it covers the
    // chat panel. On a computer it is a window beside the chat, so the chat stays in view and the screen has room: the same
    // as the mock (desktop pictures c-d-watch and c-d-control). It reads where the chat is, and follows it when the window changes.
    import { onDestroy, onMount } from "svelte";
    import { brickScreenStore, closeBrickScreen } from "./BrickScreenStore";
    import BrickScreen from "./BrickScreen.svelte";

    /** From this width the screen can sit beside the chat. */
    const BESIDE_FROM_PX = 1024;
    /** The chat is a side panel, not the whole window, when it takes less than this share of the width. */
    const PANEL_SHARE = 0.6;
    const GAP_PX = 16;
    /** Under the bar at the top of the game, as the mock has it. */
    const TOP_PX = 76;

    let beside: { start: number } | undefined;
    let resizeFrame: number | undefined;

    function place() {
        resizeFrame = undefined;
        const width = document.documentElement.clientWidth;
        const chat = document.getElementById("chat");
        if (!chat || width < BESIDE_FROM_PX) {
            beside = undefined;
            return;
        }
        const box = chat.getBoundingClientRect();
        const rtl = document.documentElement.dir === "rtl";
        if (box.width === 0 || box.width > width * PANEL_SHARE) {
            beside = undefined;
            return;
        }
        beside = { start: rtl ? width - box.left + GAP_PX : box.right + GAP_PX };
    }

    function schedule() {
        if (resizeFrame === undefined) resizeFrame = requestAnimationFrame(place);
    }

    // Opened or closed: look again where the chat is
    $: if ($brickScreenStore) schedule();

    onMount(() => {
        place();
        window.addEventListener("resize", schedule);
    });
    onDestroy(() => {
        window.removeEventListener("resize", schedule);
        if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
    });

    /** Moves the window to the page's top level, so nothing in the chat (a slide, a transform) holds it in. */
    function portal(node: HTMLElement) {
        document.body.appendChild(node);
        return { destroy: () => node.remove() };
    }
</script>

{#if $brickScreenStore}
    {#key $brickScreenStore.id}
        {#if beside}
            <div
                class="bsh beside"
                style="inset-inline-start: {beside.start}px; inset-inline-end: {GAP_PX}px; top: {TOP_PX}px; bottom: {GAP_PX}px;"
                data-testid="brickScreenHost"
                use:portal
            >
                <BrickScreen brick={$brickScreenStore} onClose={closeBrickScreen} />
            </div>
        {:else}
            <div class="bsh over" data-testid="brickScreenHost">
                <BrickScreen brick={$brickScreenStore} onClose={closeBrickScreen} />
            </div>
        {/if}
    {/key}
{/if}

<style>
    .bsh {
        display: flex;
        flex-direction: column;
        background: linear-gradient(160deg, rgb(31 28 47), rgb(var(--u-ink)));
    }
    .over {
        position: absolute;
        inset: 0;
        z-index: 60;
    }
    .beside {
        position: fixed;
        z-index: 2000;
        border-radius: 18px;
        overflow: hidden;
        box-shadow: inset 0 0 0 1px rgb(134 41 252 / 0.28), 0 18px 48px -18px rgb(0 0 0 / 0.7);
    }
</style>
