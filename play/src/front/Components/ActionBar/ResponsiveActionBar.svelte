<script lang="ts">
    import debug from "debug";
    import { onMount } from "svelte";
    import { videoStreamElementsStore } from "../../Stores/PeerStore";

    import { highlightFullScreen } from "../../Stores/ActionsCamStore";
    import { barInViewStore } from "../../Stores/BarInViewStore";
    import { modalFullScreenStore, modalIframeStore, modalVisibilityStore } from "../../Stores/ModalStore";
    import { openedMenuStore } from "../../Stores/MenuStore";
    import { mobileLayoutStore } from "../../Stores/MobileLayoutStore";

    const logger = debug("responsive-action-bar");

    // On desktops a side window (Orbit) opens under the bar: the bar, and the menus that open from
    // it, stay above the window. Maximised, the window takes the whole screen, bar included.
    // Everywhere else, a menu opened from the bar while a window shows was opened last, so it comes in front of the
    // window (the window stays open under it).
    $: aboveSideWindow =
        ($barInViewStore &&
            $modalVisibilityStore &&
            ($modalIframeStore?.position === "right" || $modalIframeStore?.position === "left") &&
            !$modalFullScreenStore) ||
        ($modalVisibilityStore && $openedMenuStore !== undefined);

    let centerPlusRightDiv: HTMLDivElement;
    export let rightDiv: HTMLDivElement;
    let rightDivContent: HTMLDivElement;
    export let actionBarWidth: number;
    let centerDivWidth: number;
    let leftDivWidth: number;
    let leftToCenterWidth: number;
    let rightContentWidth: number;
    // Room the right-hand buttons could still take, in either mode: what the bar has left once the left buttons, the
    // centre buttons and the right buttons are laid out (negative while they overflow). The bar uses it to give a
    // button back its room (#1734).
    export let freeWidth = 0;
    $: freeWidth = actionBarWidth - leftDivWidth - centerDivWidth - rightContentWidth;

    $: if (centerPlusRightDiv)
        centerPlusRightDiv.style.minWidth = `${
            mode === "wide"
                ? Math.min(actionBarWidth * 0.5 + centerDivWidth * 0.5, actionBarWidth - leftDivWidth)
                : actionBarWidth - leftDivWidth
        }px`;
    $: if (centerPlusRightDiv) centerPlusRightDiv.style.maxWidth = `${actionBarWidth - leftDivWidth}px`;

    // In "wide" mode, all buttons are displayed and there is space between left and center buttons
    // In "shrunk" mode, some buttons are hidden and there is no space between left and center buttons
    // We go in "shrunk" mode when the space between left and center buttons is 0px
    // We go back in "wide" mode when all buttons are visible
    let mode: "wide" | "shrunk" = "wide";

    function switchToShrunkMode() {
        // Additional delay: we make sure the right bar is not touching the center bar. Why?
        // Because when resized quickly (for instance when switching from landscape to portrait), the hiddenItemsWidth
        // can suddenly hit 0px before the flexbox had time to resize the right bar to the correct size.
        // By waiting a bit, we make sure the flexbox has time to resize and the "hiddenItemsWidth" value reflects
        // the actual width of the bar.

        setTimeout(() => {
            if (leftToCenterWidth === 0) {
                logger("Switching to shrunk mode");
                mode = "shrunk";
            }
        }, 1);
    }

    $: if (leftToCenterWidth === 0) {
        switchToShrunkMode();
    }

    // Desktop bar: back to "wide" (centred) once everything fits centred again, also when no button had to go into the
    // menu on the way (Explore shortening its name can avoid that, #1734). The 4px keep rounding from flipping it back.
    $: if (
        mode === "shrunk" &&
        !$mobileLayoutStore &&
        actionBarWidth -
            leftDivWidth -
            Math.max(
                Math.min(actionBarWidth * 0.5 + centerDivWidth * 0.5, actionBarWidth - leftDivWidth),
                centerDivWidth + rightContentWidth
            ) >=
            4
    ) {
        logger("Switching back to wide mode: everything fits centred");
        mode = "wide";
    }

    let fullMenuVisible: boolean;

    $: if (fullMenuVisible) {
        logger("Switching to wide mode");
        mode = "wide";
    }

    onMount(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    fullMenuVisible = entry.isIntersecting;
                });
            },
            {
                root: rightDiv,
                threshold: 1.0,
            }
        );

        observer.observe(rightDivContent);

        return () => {
            observer.disconnect();
        };
    });
</script>

<div
    class="@container/actions w-full {aboveSideWindow
        ? 'z-[2001]'
        : 'z-[301]'} transition-all pointer-events-none bp-menu bar-safe-area {$videoStreamElementsStore.length > 0 &&
    $highlightFullScreen
        ? 'hidden'
        : ''}"
>
    <div class="gap-1 @md/actions:gap-2 @xl/actions:gap-4 p-1 @md/actions:p-2 @xl/actions:p-4 screen-blocker">
        <!-- relative: what the overlay slot holds is placed against the whole bar, not one of its parts. -->
        <div class="relative w-full flex justify-between items-center" bind:offsetWidth={actionBarWidth}>
            <!-- Left bar -->
            <div class="flex-1 flex">
                <div class="flex-none" bind:offsetWidth={leftDivWidth}>
                    <slot name="left" />
                </div>
                {#if mode === "wide"}
                    <div class="w-0 flex-1 min-w-0 flex justify-end" bind:offsetWidth={leftToCenterWidth} />
                {/if}
            </div>
            <!-- Center + right bar -->
            <div
                class="flex justify-between items-center"
                class:flex-none={mode === "wide"}
                class:flex-1={mode === "shrunk"}
                bind:this={centerPlusRightDiv}
            >
                <!-- Center bar -->
                <div class="flex justify-end" bind:offsetWidth={centerDivWidth}>
                    <slot name="center" />
                </div>
                <!-- Right bar. It clips what doesn't fit (those buttons go to the menu); the 12px of padding above,
                     taken back by the negative margin, leaves room for a count on a button's top-left corner (Orbit's)
                     without moving anything. -->
                <div
                    class="flex flex-row justify-end overflow-hidden -mt-3 pt-3"
                    class:flex-none={mode === "wide"}
                    class:flex-1={mode === "shrunk"}
                    bind:this={rightDiv}
                >
                    <div
                        class="flex flew-row flex-none h-full"
                        bind:this={rightDivContent}
                        bind:offsetWidth={rightContentWidth}
                    >
                        <slot name="right" />
                    </div>
                </div>
            </div>
            <slot name="overlay" />
        </div>
    </div>
</div>

<style>
    /* Tablets and desktops (the bar at the top): the installed app on an iPad runs under its see-through status bar
       (#969), so the bar starts below it. Everywhere else the inset is 0. Phones set their own padding below. */
    .bar-safe-area {
        box-sizing: border-box;
        padding-top: env(safe-area-inset-top, 0px);
    }

    /* Phones (the bar at the bottom; Tailwind's mobile: variant, written as a list the compiler can read): where the
       phone reports a home bar, the bar rises just clear of it, 17px from the bottom edge: the line itself is drawn in
       the bottom 13px, and 17px is where the chat's Invite button already sits. The 34px an iPhone reports, less 21px,
       adds 13px to the bar's own 4px. Only the installed app on an iPhone or iPad reports it (index.html turns on
       viewport-fit=cover there, #941); everywhere else it is 0 and the bar stays where it is. The sides take the
       full inset, kept off the rounded corners. */
    @media (max-height: 960px) and (max-width: 480px) and (pointer: coarse),
        (max-height: 480px) and (max-width: 960px) and (pointer: coarse) {
        .bar-safe-area {
            box-sizing: border-box;
            padding: 0 env(safe-area-inset-right, 0px) max(0px, env(safe-area-inset-bottom, 0px) - 21px)
                env(safe-area-inset-left, 0px);
        }
    }
</style>
