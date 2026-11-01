<script lang="ts">
    import { onMount } from "svelte";

    export let parent: HTMLElement;
    export let onVisibilityChange: (isVisible: boolean) => void = () => {};
    let divElement: HTMLElement;

    export let isVisible = true;

    onMount(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
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
            observer.disconnect();
        };
    });
</script>

<div class="group/visibilitychecker" class:visible={isVisible} class:invisible={!isVisible} bind:this={divElement}>
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
