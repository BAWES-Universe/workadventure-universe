<script lang="ts">
    import { createFloatingUiActions } from "../../Utils/svelte-floatingui";

    const [floatingUiRef, floatingUiContent, arrowAction] = createFloatingUiActions(
        {
            placement: "top",
            //strategy: 'fixed',
        },
        8
    );

    // Hover shows it on a computer; a tap or click pins it, so a touch screen can read it too. A tap elsewhere puts it away.
    let hovered = false;
    let pinned = false;
    $: showTooltip = hovered || pinned;
    let root: HTMLElement;

    function away(event: PointerEvent) {
        if (!pinned || root?.contains(event.target as Node)) return;
        pinned = false;
    }
</script>

<svelte:window on:pointerdown={away} />

<div bind:this={root}>
    <svg
        role="button"
        tabindex="0"
        aria-label="Info"
        aria-expanded={showTooltip}
        use:floatingUiRef
        class="icon icon-tabler icon-tabler-info-square-rounded-filled fill-contrast-200 stroke-contrast-200"
        fill="none"
        height="24"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.5"
        viewBox="0 0 24 24"
        width="24"
        xmlns="http://www.w3.org/2000/svg"
        on:mouseenter={() => (hovered = true)}
        on:mouseleave={() => (hovered = false)}
        on:click={() => (pinned = !pinned)}
        on:keydown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                pinned = !pinned;
            }
        }}
    >
        <path d="M0 0h24v24H0z" fill="none" stroke="none" />
        <path
            d="M12 2l.642 .005l.616 .017l.299 .013l.579 .034l.553 .046c4.687 .455 6.65 2.333 7.166 6.906l.03 .29l.046 .553l.041 .727l.006 .15l.017 .617l.005 .642l-.005 .642l-.017 .616l-.013 .299l-.034 .579l-.046 .553c-.455 4.687 -2.333 6.65 -6.906 7.166l-.29 .03l-.553 .046l-.727 .041l-.15 .006l-.617 .017l-.642 .005l-.642 -.005l-.616 -.017l-.299 -.013l-.579 -.034l-.553 -.046c-4.687 -.455 -6.65 -2.333 -7.166 -6.906l-.03 -.29l-.046 -.553l-.041 -.727l-.006 -.15l-.017 -.617l-.004 -.318v-.648l.004 -.318l.017 -.616l.013 -.299l.034 -.579l.046 -.553c.455 -4.687 2.333 -6.65 6.906 -7.166l.29 -.03l.553 -.046l.727 -.041l.15 -.006l.617 -.017c.21 -.003 .424 -.005 .642 -.005zm0 9h-1l-.117 .007a1 1 0 0 0 0 1.986l.117 .007v3l.007 .117a1 1 0 0 0 .876 .876l.117 .007h1l.117 -.007a1 1 0 0 0 .876 -.876l.007 -.117l-.007 -.117a1 1 0 0 0 -.764 -.857l-.112 -.02l-.117 -.006v-3l-.007 -.117a1 1 0 0 0 -.876 -.876l-.117 -.007zm.01 -3l-.127 .007a1 1 0 0 0 0 1.986l.117 .007l.127 -.007a1 1 0 0 0 0 -1.986l-.117 -.007z"
            stroke-width="0"
        />
    </svg>

    <!--{#if showTooltip}-->
    <div
        class="transition-opacity {showTooltip
            ? 'visible'
            : 'hidden'} absolute bg-contrast-900 rounded p-3 text-white z-10 w-80"
        use:floatingUiContent
    >
        <slot />

        <!-- Arrow -->
        <div use:arrowAction />
    </div>
    <!--{/if}-->
</div>
