<script lang="ts">
    import { onMount } from "svelte";

    export let parent: HTMLElement;
    export let onVisibilityChange: (isVisible: boolean) => void = () => {};
    let divElement: HTMLElement;

    export let isVisible = true;
    // Desktop bar (#1734): a button that moved into the menu gives its room back, so it leaves no empty gap. Its box
    // stays where it would be, just pulled back over the space before it, so the observer below still sees the moment
    // it would fit again. The width is read by the bar too.
    export let collapse = false;
    export let width = 0;

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

<div
    class="group/visibilitychecker"
    class:visible={isVisible}
    class:invisible={!isVisible}
    style:margin-inline-start={collapse && !isVisible ? `-${width}px` : undefined}
    bind:this={divElement}
    bind:offsetWidth={width}
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
