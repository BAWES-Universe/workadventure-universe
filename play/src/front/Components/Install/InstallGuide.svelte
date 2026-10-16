<script lang="ts">
    /* eslint-disable svelte/no-at-html-tags */
    import { fly } from "svelte/transition";
    import type { TransitionConfig } from "svelte/transition";
    import { LL } from "../../../i18n/i18n-svelte";
    import { installApp } from "../../Install/InstallWiring";
    import { installIconSrc } from "../../Install/InstallIcon";
    import { enableUserInputsStore } from "../../Stores/UserInputStore";
    import type { InstallGuide } from "../../Install/InstallPlatform";
    import {
        IconApps,
        IconArrowDown,
        IconCheck,
        IconCopy,
        IconDeviceDesktopDown,
        IconDeviceMobileDown,
        IconDeviceMobilePlus,
        IconDots,
        IconMenu2,
        IconMoreVertical,
        IconPlus,
        IconShare2,
        IconSquarePlus,
        IconX,
    } from "@wa-icons";

    const { guideOpenStore } = installApp;
    const iconSrc = installIconSrc();

    // The three steps of the iPhone and iPad guides. What the chip on the right draws is the button to tap, as the
    // browser shows it (light, in the browser's own look): it is not ours.
    $: iosGuide =
        $guideOpenStore === "iphone-safari"
            ? { text: $LL.install.guide.iphoneSafari, firstChip: "dots" as const }
            : $guideOpenStore === "ipad-safari"
            ? { text: $LL.install.guide.ipadSafari, firstChip: "share" as const }
            : $guideOpenStore === "ios-chrome"
            ? { text: $LL.install.guide.iosChrome, firstChip: "share" as const }
            : undefined;

    // The picture on the right of a step: the browser's own button, as it draws it.
    type Chip = "dots" | "menu" | "phoneDown" | "phonePlus" | "plus" | "desktopDown" | "apps" | "install";
    interface BrowserSheet {
        title: string;
        steps: { text: string; note?: string; chips: Chip[] }[];
        foot?: string;
        place: "bottom" | "top" | "desktop";
        arrow: boolean;
    }

    // One guide per browser. Edge and Samsung Internet open their menu from a bar at the bottom of the phone, so
    // their sheet sits at the top; the others sit at the bottom.
    function browserSheetFor(
        guide: InstallGuide | undefined,
        t: typeof $LL.install.guide.browserMenu
    ): BrowserSheet | undefined {
        switch (guide) {
            case "browser-chrome-android":
                return {
                    title: t.chromeAndroid.title(),
                    steps: [
                        { text: t.chromeAndroid.step1(), chips: ["dots"] },
                        { text: t.chromeAndroid.step2(), note: t.chromeAndroid.step2Older(), chips: ["phoneDown"] },
                        { text: t.chromeAndroid.step3(), chips: ["install"] },
                    ],
                    place: "bottom",
                    arrow: false,
                };
            case "browser-edge-android":
                return {
                    title: t.edgeAndroid.title(),
                    steps: [
                        { text: t.edgeAndroid.step1(), chips: ["menu"] },
                        { text: t.edgeAndroid.step2(), chips: ["phonePlus"] },
                        { text: t.edgeAndroid.step3(), chips: ["install"] },
                    ],
                    place: "top",
                    arrow: false,
                };
            case "browser-samsung-android":
                return {
                    title: t.samsungAndroid.title(),
                    steps: [
                        { text: t.samsungAndroid.step1(), chips: ["menu"] },
                        { text: t.samsungAndroid.step2(), chips: ["plus"] },
                        { text: t.samsungAndroid.step3(), chips: ["install"] },
                    ],
                    place: "top",
                    arrow: false,
                };
            case "browser-other-android":
                return {
                    title: t.otherAndroid.title(),
                    steps: [
                        { text: t.otherAndroid.step1(), chips: ["dots", "menu"] },
                        { text: t.otherAndroid.step2(), chips: ["phoneDown"] },
                        { text: t.otherAndroid.step3(), chips: ["install"] },
                    ],
                    place: "bottom",
                    arrow: false,
                };
            case "browser-chrome-desktop":
                return {
                    title: t.chromeDesktop.title(),
                    steps: [
                        { text: t.chromeDesktop.step1(), chips: ["desktopDown"] },
                        { text: t.chromeDesktop.step2(), chips: ["install"] },
                    ],
                    foot: t.chromeDesktop.noIcon(),
                    place: "desktop",
                    arrow: true,
                };
            case "browser-edge-desktop":
                return {
                    title: t.edgeDesktop.title(),
                    steps: [
                        { text: t.edgeDesktop.step1(), chips: ["apps"] },
                        { text: t.edgeDesktop.step2(), chips: ["install"] },
                    ],
                    foot: t.edgeDesktop.noIcon(),
                    place: "desktop",
                    arrow: true,
                };
            case "browser-other-desktop":
                return {
                    title: t.otherDesktop.title(),
                    steps: [
                        { text: t.otherDesktop.step1(), chips: ["desktopDown", "dots"] },
                        { text: t.otherDesktop.step2(), chips: ["install"] },
                    ],
                    place: "desktop",
                    arrow: false,
                };
            default:
                return undefined;
        }
    }
    $: browserSheet = browserSheetFor($guideOpenStore, $LL.install.guide.browserMenu);

    // Dragging the handle down closes the sheet: past half of its height it goes, less and it springs back.
    let sheet: HTMLDivElement | undefined;
    let dragStartY: number | undefined;
    let dragY = 0;
    function dragStart(event: PointerEvent) {
        dragStartY = event.clientY;
        dragY = 0;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }
    function dragMove(event: PointerEvent) {
        if (dragStartY === undefined) return;
        dragY = Math.max(0, event.clientY - dragStartY);
    }
    function dragEnd() {
        if (dragStartY === undefined) return;
        const farEnough = sheet !== undefined && dragY > sheet.offsetHeight / 2;
        dragStartY = undefined;
        // Closing keeps the sheet where the finger left it, so it leaves from there: the offset is cleared once it is gone.
        if (farEnough) installApp.closeGuide();
        else dragY = 0;
    }

    // The sheet leaves downwards from where it is: from where the finger let go after a swipe, else from its place.
    function sheetOut(_node: Element): TransitionConfig {
        const from = dragY;
        return { duration: 300, css: (t) => `transform: translateY(${from + (1 - t) * 80}px); opacity: ${t};` };
    }

    // Keyboard and screen readers: the guide takes focus when it opens (on its close button), Escape closes it, and
    // focus goes back to the profile button when it closes. The guide never blocks the game behind it.
    const profileButtonSelector = '[data-testid="action-user"] .profile-button';
    function takeFocus(node: HTMLElement) {
        const closeButton =
            node.querySelector<HTMLElement>(".u-close") ??
            node.querySelector<HTMLElement>('[data-testid="install-guide-close"]');
        closeButton?.focus({ preventScroll: true });
        return {
            destroy() {
                // Only when the focus was still on the guide (or lost with it): never pull it away from where the
                // player has moved on to.
                const active = document.activeElement;
                if (active && active !== document.body && !node.contains(active)) return;
                document.querySelector<HTMLElement>(profileButtonSelector)?.focus({ preventScroll: true });
            },
        };
    }

    function closeOnEscape(event: KeyboardEvent) {
        // An Escape that leaves a text field (the chat, a form) does only that.
        if (event.key !== "Escape" || $guideOpenStore === undefined || !$enableUserInputsStore) return;
        event.stopPropagation();
        installApp.closeGuide();
    }

    let copied = false;
    let copiedTimer: ReturnType<typeof setTimeout> | undefined;
    async function copyLink() {
        try {
            await navigator.clipboard.writeText(window.location.href);
            copied = true;
            clearTimeout(copiedTimer);
            copiedTimer = setTimeout(() => (copied = false), 2500);
        } catch (error) {
            console.warn("The link could not be copied", error);
        }
    }
</script>

<svelte:window on:keydown={closeOnEscape} />

{#if iosGuide !== undefined}
    <!-- iPhone and iPad: a sheet at the bottom of the page, over the game's buttons. Chrome and Safari on iPad have a
         yellow arrow bouncing over Share at the top right. Safari on iPhone has none: its ⋯ button is in the browser's
         bar, which the page cannot see (it may be at the bottom, at the top or hidden). Swipe the handle down to close. -->
    <div
        bind:this={sheet}
        class="ios-sheet u-surface pointer-events-auto absolute inset-x-2 z-[1100] mx-auto flex max-w-[440px] flex-col gap-3 rounded-3xl px-4 pb-4 pt-2.5 text-white {$guideOpenStore ===
        'iphone-safari'
            ? 'bottom-2'
            : 'bottom-6'}"
        class:sheet-dragging={dragStartY !== undefined}
        style:transform={dragY > 0 ? `translateY(${dragY}px)` : undefined}
        role="dialog"
        aria-label={iosGuide.text.title()}
        data-testid="install-guide"
        use:takeFocus
        in:fly={{ y: 80, duration: 300 }}
        out:sheetOut
        on:outroend={() => (dragY = 0)}
    >
        <div
            class="drag-zone"
            data-testid="install-guide-handle"
            on:pointerdown={dragStart}
            on:pointermove={dragMove}
            on:pointerup={dragEnd}
            on:pointercancel={dragEnd}
        >
            <div class="mx-auto h-[5px] w-10 rounded-full bg-white/25" aria-hidden="true" />
        </div>
        <div class="flex items-center gap-3">
            {#if iconSrc}
                <img class="h-12 w-12 flex-none rounded-[22%]" src={iconSrc} alt="" />
            {/if}
            <b class="flex-1 text-[19px] font-extrabold leading-tight">{iosGuide.text.title()}</b>
            <button
                type="button"
                class="u-close"
                aria-label={$LL.install.guide.close()}
                data-testid="install-guide-close"
                on:click={() => installApp.closeGuide()}
            >
                <IconX font-size="18" aria-hidden="true" />
            </button>
        </div>
        <div class="flex min-h-12 items-center gap-3">
            <span
                class="grid h-[26px] w-[26px] flex-none place-items-center rounded-full bg-gradient-to-r from-[#8629fc] to-[#4156f6] text-[13px] font-bold"
                >1</span
            >
            <span class="min-w-0 flex-1 text-sm leading-snug">{@html iosGuide.text.step1()}</span>
            <span class="chip" aria-hidden="true">
                {#if iosGuide.firstChip === "dots"}<IconDots font-size="18" />{:else}<IconShare2 font-size="18" />{/if}
            </span>
        </div>
        <div class="flex min-h-12 items-center gap-3">
            <span
                class="grid h-[26px] w-[26px] flex-none place-items-center rounded-full bg-white/10 text-[13px] font-bold"
                >2</span
            >
            <span class="min-w-0 flex-1 text-sm leading-snug">{@html iosGuide.text.step2()}</span>
            <span class="chip" aria-hidden="true"
                ><IconSquarePlus font-size="18" />{$LL.install.guide.addToHomeScreen()}</span
            >
        </div>
        <div class="flex min-h-12 items-center gap-3">
            <span
                class="grid h-[26px] w-[26px] flex-none place-items-center rounded-full bg-white/10 text-[13px] font-bold"
                >3</span
            >
            <span class="min-w-0 flex-1 text-sm leading-snug">{@html iosGuide.text.step3()}</span>
            <span class="chip" aria-hidden="true"><span class="toggle" /></span>
        </div>
        <p
            class="m-0 border-t border-white/10 pt-3 text-center text-[13px] text-white/60"
            data-testid="install-guide-already"
        >
            {$LL.install.guide.alreadyAdded()}
        </p>
    </div>
    {#if $guideOpenStore !== "iphone-safari"}
        <div
            class="hint hint-up pointer-events-none absolute right-[58px] top-[98px] z-[1101] md:right-[72px] md:top-14"
            aria-hidden="true"
        >
            <IconArrowDown font-size="34" />
        </div>
    {/if}
{:else if $guideOpenStore === "open-in-safari"}
    <!-- Inside Instagram, WhatsApp and the like: their own browsers cannot add to the Home Screen, so say so. -->
    <div
        class="u-surface pointer-events-auto absolute inset-x-2 top-[110px] z-[1100] mx-auto flex max-w-[440px] flex-col gap-3 rounded-[20px] p-[18px] text-white"
        role="dialog"
        aria-label={$LL.install.guide.openInSafari.title()}
        data-testid="install-guide"
        use:takeFocus
        transition:fly={{ y: -50, duration: 300 }}
    >
        <div class="flex items-center gap-3">
            {#if iconSrc}
                <img class="h-12 w-12 flex-none rounded-[22%]" src={iconSrc} alt="" />
            {/if}
            <b class="text-[19px] leading-tight">{$LL.install.guide.openInSafari.title()}</b>
        </div>
        <p class="m-0 text-sm text-white/70">{$LL.install.guide.openInSafari.text()}</p>
        <div class="flex gap-2">
            <button
                type="button"
                class="u-cta flex min-h-[44px] min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-bold"
                data-testid="install-guide-copy"
                on:click={() => void copyLink()}
            >
                {#if copied}<IconCheck
                        font-size="18"
                        aria-hidden="true"
                    />{$LL.install.guide.openInSafari.copied()}{:else}<IconCopy
                        font-size="18"
                        aria-hidden="true"
                    />{$LL.install.guide.openInSafari.copy()}{/if}
            </button>
            <button
                type="button"
                class="u-cta-secondary flex min-h-[44px] min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-full px-4 text-sm font-bold"
                data-testid="install-guide-close"
                on:click={() => installApp.closeGuide()}
            >
                {$LL.install.guide.openInSafari.notNow()}
            </button>
        </div>
    </div>
{:else if browserSheet !== undefined}
    <!-- The browser's own install window was cancelled and cannot open twice: a guide in this browser's own words, with
         a picture of each button to tap. Phones have no arrow (the bar can be at the top or the bottom); computers
         point at the install icon in the address bar. -->
    <div
        class="u-surface pointer-events-auto absolute z-[1100] flex flex-col gap-2 rounded-3xl px-4 pb-3.5 pt-3 text-white {browserSheet.place ===
        'desktop'
            ? 'right-4 top-12 w-[440px] max-w-[calc(100vw-2rem)]'
            : `inset-x-2 mx-auto max-w-[440px] ${
                  browserSheet.place === 'top' ? 'top-[calc(8px+env(safe-area-inset-top))]' : 'bottom-6'
              }`}"
        role="dialog"
        aria-label={browserSheet.title}
        data-testid="install-guide"
        use:takeFocus
        transition:fly={{ y: browserSheet.place === "bottom" ? 80 : -50, duration: 300 }}
    >
        <div class="mb-0.5 flex items-center gap-3">
            {#if iconSrc}
                <img class="h-11 w-11 flex-none rounded-[22%]" src={iconSrc} alt="" />
            {/if}
            <b class="flex-1 text-[19px] font-extrabold leading-tight">{browserSheet.title}</b>
            <button
                type="button"
                class="u-close"
                aria-label={$LL.install.guide.close()}
                data-testid="install-guide-close"
                on:click={() => installApp.closeGuide()}
            >
                <IconX font-size="18" aria-hidden="true" />
            </button>
        </div>
        {#each browserSheet.steps as step, index (index)}
            <div class="flex min-h-12 items-center gap-3">
                <span
                    class="grid h-[26px] w-[26px] flex-none place-items-center rounded-full text-[13px] font-bold {index ===
                    0
                        ? 'bg-gradient-to-r from-[#8629fc] to-[#4156f6]'
                        : 'bg-white/10'}">{index + 1}</span
                >
                <span class="min-w-0 flex-1 text-sm leading-snug">
                    {@html step.text}
                    {#if step.note}<span class="mt-0.5 block text-xs text-white/55">{step.note}</span>{/if}
                </span>
                <span class="flex flex-none gap-1.5" aria-hidden="true">
                    {#each step.chips as chip (chip)}
                        {#if chip === "install"}
                            <span class="chip chip-install">{$LL.install.guide.browserMenu.installButton()}</span>
                        {:else}
                            <span class="chip">
                                {#if chip === "dots"}<IconMoreVertical font-size="18" />
                                {:else if chip === "menu"}<IconMenu2 font-size="18" />
                                {:else if chip === "phoneDown"}<IconDeviceMobileDown font-size="18" />
                                {:else if chip === "phonePlus"}<IconDeviceMobilePlus font-size="18" />
                                {:else if chip === "plus"}<IconPlus font-size="18" />
                                {:else if chip === "desktopDown"}<IconDeviceDesktopDown font-size="18" />
                                {:else}<IconApps font-size="18" />{/if}
                            </span>
                        {/if}
                    {/each}
                </span>
            </div>
        {/each}
        {#if browserSheet.foot}
            <p
                class="m-0 border-t border-white/10 pt-2.5 text-[13px] leading-snug text-white/65 [&_b]:text-white"
                data-testid="install-guide-no-icon"
            >
                {@html browserSheet.foot}
            </p>
        {/if}
    </div>
    {#if browserSheet.arrow}
        <div
            class="hint hint-up pointer-events-none absolute right-[92px] top-[calc(6px+env(safe-area-inset-top))] z-[1101]"
            aria-hidden="true"
        >
            <IconArrowDown font-size="34" />
        </div>
    {/if}
{:else if $guideOpenStore === "mac-safari"}
    <!-- Mac Safari has no install button either: File, then Add to Dock. -->
    <div
        class="u-surface pointer-events-auto absolute left-1/2 top-[110px] z-[1100] flex w-[440px] max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-col gap-3 rounded-[20px] p-5 text-white"
        role="dialog"
        aria-label={$LL.install.guide.macSafari.title()}
        data-testid="install-guide"
        use:takeFocus
        transition:fly={{ y: -50, duration: 300 }}
    >
        <div class="flex items-center gap-3">
            {#if iconSrc}
                <img class="h-12 w-12 flex-none rounded-[22%]" src={iconSrc} alt="" />
            {/if}
            <b class="flex-1 text-lg leading-tight">{$LL.install.guide.macSafari.title()}</b>
            <button
                type="button"
                class="u-close"
                aria-label={$LL.install.guide.close()}
                on:click={() => installApp.closeGuide()}
            >
                <IconX font-size="18" aria-hidden="true" />
            </button>
        </div>
        <div class="flex min-h-12 items-center gap-3">
            <span
                class="grid h-[26px] w-[26px] flex-none place-items-center rounded-full bg-gradient-to-r from-[#8629fc] to-[#4156f6] text-[13px] font-bold"
                >1</span
            >
            <span class="min-w-0 flex-1 text-sm leading-snug">{@html $LL.install.guide.macSafari.step1()}</span>
        </div>
        <div class="flex min-h-12 items-center gap-3">
            <span
                class="grid h-[26px] w-[26px] flex-none place-items-center rounded-full bg-white/10 text-[13px] font-bold"
                >2</span
            >
            <span class="min-w-0 flex-1 text-sm leading-snug">{@html $LL.install.guide.macSafari.step2()}</span>
        </div>
        <div class="flex">
            <button
                type="button"
                class="u-cta-secondary flex min-h-[44px] flex-1 items-center justify-center whitespace-nowrap rounded-full px-4 text-sm font-bold"
                data-testid="install-guide-close"
                on:click={() => installApp.closeGuide()}
            >
                {$LL.install.guide.macSafari.gotIt()}
            </button>
        </div>
    </div>
{/if}

<style>
    /* The sheet follows the finger while its handle is dragged, and springs back when let go too early. The zone is a
       wider, taller target than the 5px handle it holds, and keeps the page from scrolling under the finger. */
    .ios-sheet {
        transition: transform 0.25s ease;
    }
    .ios-sheet.sheet-dragging {
        transition: none;
    }
    .drag-zone {
        margin: -10px -16px -12px;
        padding: 10px 16px 12px;
        cursor: grab;
        touch-action: none;
    }
    /* What the browser draws (a button in its bar, a switch): light and in its own look, so it reads as the thing to
       find there, not as part of the game. */
    .chip {
        display: inline-flex;
        flex: none;
        align-items: center;
        gap: 6px;
        height: 34px;
        padding: 0 10px;
        border-radius: 10px;
        background: rgba(240, 240, 245, 0.92);
        color: #1c1c1e;
        font-size: 12.5px;
        font-weight: 600;
        white-space: nowrap;
    }
    /* Chrome's own Install button in its window: blue, a pill. */
    .chip-install {
        background: #8ab4f8;
        color: #202124;
        border-radius: 999px;
        padding: 0 14px;
    }
    .toggle {
        position: relative;
        width: 30px;
        height: 18px;
        border-radius: 999px;
        background: #34c759;
    }
    .toggle::after {
        content: "";
        position: absolute;
        top: 2px;
        right: 2px;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #fff;
    }
    /* The arrow over the button to tap: yellow, bouncing (still for people who asked for less motion). */
    .hint {
        display: grid;
        place-items: center;
        color: #fde047;
        filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.6));
    }
    .hint-up {
        rotate: 180deg;
    }
    @media (prefers-reduced-motion: no-preference) {
        .hint {
            animation: install-hint-bob-down 1.1s ease-in-out infinite;
        }
        .hint-up {
            animation-name: install-hint-bob-up;
        }
    }
    @keyframes install-hint-bob-down {
        0%,
        100% {
            translate: 0 0;
        }
        50% {
            translate: 0 6px;
        }
    }
    @keyframes install-hint-bob-up {
        0%,
        100% {
            translate: 0 0;
        }
        50% {
            translate: 0 -6px;
        }
    }
</style>
