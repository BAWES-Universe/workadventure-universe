<script lang="ts">
    import { onMount } from "svelte";

    export let parent: HTMLElement;
    export let onVisibilityChange: (isVisible: boolean) => void = () => {};
    let divElement: HTMLElement;

    export let isVisible = true;
    // Desktop bar (#1734): a button that moved into the menu gives its room back, so it leaves no empty gap (its box
    // is pulled back over the space before it). While collapsed it only comes back when the bar says so (collapse turns
    // false), so folded buttons return one at a time, nearest first, and only when the room is really there. The
    // width is read by the bar too.
    export let collapse = false;
    export let width = 0;
    // Read with a ResizeObserver (bind:borderBoxSize): bind:offsetWidth would make this box position: relative and
    // put an iframe in it, which changes what the bar's menus are placed against.
    let boxSize: ResizeObserverSize[] | undefined = undefined;
    $: width = boxSize?.[0]?.inlineSize ?? 0;

    let observer: IntersectionObserver | undefined = undefined;

    onMount(() => {
        observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    // The whole bar is hidden (no size, e.g. a video in full screen): nothing moved, so every button
                    // keeps its place and none goes into the menu, and they are all there again when the bar shows.
                    if (entry.rootBounds !== null && entry.rootBounds.width === 0) return;
                    if (entry.isIntersecting && !isVisible && collapse) return;
                    isVisible = entry.isIntersecting;
                    onVisibilityChange(isVisible);
                });
            },
            {
                root: parent,
                threshold: 1,
            }
        );

        observer.observe(divElement);

        return () => {
            observer?.disconnect();
        };
    });

    // The bar lets this button back: observe afresh, so the observer reports where the button now stands even if its
    // box was already inside the bar while it was collapsed.
    $: if (!collapse) reobserve();
    function reobserve() {
        if (!observer || !divElement) return;
        observer.unobserve(divElement);
        observer.observe(divElement);
    }
</script>

<div
    class="group/visibilitychecker"
    class:visible={isVisible}
    class:invisible={!isVisible}
    style:margin-inline-start={collapse && !isVisible ? `-${width}px` : undefined}
    bind:this={divElement}
    bind:borderBoxSize={boxSize}
>
    <slot />
</div>

<style>
    /* A bar button that no longer fits hides at once, all of it. Without this, any part of it that animates keeps
       showing for its animation time, because the browser animates "hidden" too: Tools' down arrow
       (transition-all) flashed alone in the bar when entering a meeting room at widths where Tools folds into
       the menu. */
    .invisible :global(*) {
        transition: none !important;
    }
</style>
