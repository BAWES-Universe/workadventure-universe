<script lang="ts">
    import { get } from "svelte/store";
    import type { ComponentType } from "svelte";
    import { onDestroy, onMount, tick } from "svelte";
    import type { TransitionConfig } from "svelte/transition";
    import { cubicOut } from "svelte/easing";
    import type { MenuItem } from "../../Stores/MenuStore";
    import {
        activeSubMenuStore,
        customMenuIframe,
        menuVisiblilityStore,
        SubMenusInterface,
        subMenusStore,
    } from "../../Stores/MenuStore";
    import { menuInputFocusStore } from "../../Stores/MenuInputFocusStore";
    import { sendMenuClickedEvent } from "../../Api/Iframe/Ui/MenuItem";
    import { LL } from "../../../i18n/i18n-svelte";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import SettingsSubMenu from "./SettingsSubMenu.svelte";
    import ProfileSubMenu from "./ProfileSubMenu.svelte";
    import AboutRoomSubMenu from "./AboutRoomSubMenu.svelte";
    import ContactSubMenu from "./ContactSubMenu.svelte";
    import CustomSubMenu from "./CustomSubMenu.svelte";
    import GuestSubMenu from "./GuestSubMenu.svelte";
    import ReportSubMenu from "./ReportSubMenu.svelte";
    import ChatSubMenu from "./ChatSubMenu.svelte";
    import ShortcutSubMenu from "./ShortcutSubMenu.svelte";
    import {
        IconAdjustmentsHorizontal,
        IconApps,
        IconArrowLeft,
        IconKeyboard,
        IconMessageCircle,
        IconUnMute,
        IconUser,
        IconX,
    } from "@wa-icons";

    /**
     * The settings window. Settings are two pages, General and Sound and video, plus Keyboard on computers. Map
     * credits (and Contact and Report a problem, when the room sets a link for them) open from rows of General, with a
     * back button. The other pages of the menu (the profile, chat, a map's own menus) keep their
     * place after the settings pages, so nothing a room or script adds is lost.
     *
     * On a phone the pages are tabs with the gradient pill under the open one, like Chats and People. From 1024px they
     * are a side list on the left, with the same gradient for the open page.
     */

    type Page = {
        id: string;
        label: string;
        icon: ComponentType | undefined;
        /** The menu item behind the page: Settings for General and Sound and video. */
        item: MenuItem;
    };

    /** Pages opened from a row of General: they show a back button instead of the tabs. */
    const ROW_PAGES: string[] = [SubMenusInterface.aboutRoom, SubMenusInterface.contact, SubMenusInterface.report];
    /** Pages that are one iframe and take the whole body. */
    const FRAME_PAGES: string[] = [SubMenusInterface.profile, SubMenusInterface.contact, SubMenusInterface.report];

    const finePointer = typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches === true;

    /** The open page: "general", "sound", or a menu item's key. */
    let current = "general";
    /** A page opened from a row of General (Map credits, Contact, Report), shown with a back button. */
    let rowPage: string | undefined = undefined;
    let activeComponent: ComponentType | undefined = undefined;
    let props: { url: string; allowApi: boolean; allow: string | undefined } | Record<string, never> = {};
    let isFrame = false;

    let unsubscriberSubMenuStore: (() => void) | undefined;
    let unsubscriberActiveSubMenuStore: (() => void) | undefined;

    function labelOf(item: MenuItem): string {
        return item.type === "scripting" ? item.label : $LL.menu.sub[item.key]();
    }

    function iconOf(item: MenuItem): ComponentType | undefined {
        if (item.type === "scripting") return IconApps;
        switch (item.key) {
            case SubMenusInterface.profile:
                return IconUser;
            case SubMenusInterface.chat:
                return IconMessageCircle;
            default:
                return IconApps;
        }
    }

    function isVisible(item: MenuItem): boolean {
        return get(item.visible);
    }

    $: settingsItem = $subMenusStore.find(
        (item) => item.type === "translated" && item.key === SubMenusInterface.settings
    );
    $: shortcutsItem = $subMenusStore.find(
        (item) => item.type === "translated" && item.key === SubMenusInterface.shortcuts
    );

    // The settings pages first, then every other page of the menu that is visible here.
    $: settingsPages = settingsItem
        ? [
              {
                  id: "general",
                  label: $LL.menu.settings.tabs.general(),
                  icon: IconAdjustmentsHorizontal,
                  item: settingsItem,
              },
              {
                  id: "sound",
                  label: $LL.menu.settings.tabs.soundAndVideo(),
                  icon: IconUnMute,
                  item: settingsItem,
              },
          ]
        : [];
    // Keyboard is for computers; on a touch screen it only shows when a script opens it.
    $: keyboardPages =
        shortcutsItem && (finePointer || current === SubMenusInterface.shortcuts)
            ? [
                  {
                      id: SubMenusInterface.shortcuts,
                      label: $LL.menu.settings.tabs.keyboard(),
                      icon: IconKeyboard,
                      item: shortcutsItem,
                  },
              ]
            : [];
    $: otherPages = $subMenusStore
        .filter(
            (item) =>
                !(
                    item.type === "translated" &&
                    (item.key === SubMenusInterface.settings ||
                        item.key === SubMenusInterface.shortcuts ||
                        ROW_PAGES.includes(item.key))
                ) && isVisible(item)
        )
        .map((item) => ({ id: item.key, label: labelOf(item), icon: iconOf(item), item }));
    $: pages = [...settingsPages, ...keyboardPages] as Page[];
    $: allPages = [...pages, ...otherPages] as Page[];

    // The rows of General that open a page: Map credits always, Contact and Report when the room has them.
    $: rowPages = $subMenusStore
        .filter((item) => item.type === "translated" && ROW_PAGES.includes(item.key) && isVisible(item))
        .map((item) => ({
            key: item.key,
            label:
                item.key === SubMenusInterface.aboutRoom
                    ? $LL.menu.settings.mapCredits()
                    : item.key === SubMenusInterface.contact
                    ? $LL.menu.settings.contact()
                    : $LL.menu.settings.report(),
        }));

    $: currentPage = allPages.find((page) => page.id === current);
    $: rowPageLabel = rowPages.find((page) => page.key === rowPage)?.label;

    onMount(() => {
        unsubscriberActiveSubMenuStore = activeSubMenuStore.subscribe((index) => {
            const item = get(subMenusStore)[index];
            if (item) void open(item);
        });
        // A script can remove the page that is open: fall back to General.
        unsubscriberSubMenuStore = subMenusStore.subscribe((items) => {
            if (current !== "general" && current !== "sound" && !items.some((item) => item.key === current)) {
                void openSettings("general");
            }
        });
    });

    onDestroy(() => {
        menuInputFocusStore.set(false);
        unsubscriberSubMenuStore?.();
        unsubscriberActiveSubMenuStore?.();
        resizeObserver?.disconnect();
    });

    /** Opens a menu item: from the store (the profile menu, a script) or from a tab. */
    async function open(item: MenuItem) {
        if (item.type === "scripting") {
            analyticsClient.menuCustom(item.key);
            const customMenu = customMenuIframe.get(item.key);
            if (customMenu === undefined) {
                // A script's menu without a page is a command: run it and close.
                sendMenuClickedEvent(item.key);
                menuVisiblilityStore.set(false);
                return;
            }
            show(item.key, CustomSubMenu, true, {
                url: customMenu.url,
                allowApi: customMenu.allowApi,
                allow: customMenu.allow,
            });
            return;
        }

        switch (item.key) {
            case SubMenusInterface.settings:
                // Coming back to Settings from another page keeps the settings page you were on.
                if (current !== "general" && current !== "sound") current = "general";
                await openSettings(current as "general" | "sound");
                return;
            case SubMenusInterface.profile:
                show(item.key, ProfileSubMenu, true);
                analyticsClient.menuProfile();
                return;
            case SubMenusInterface.invite:
                show(item.key, GuestSubMenu);
                analyticsClient.menuInvite();
                return;
            case SubMenusInterface.aboutRoom:
            case SubMenusInterface.contact:
            case SubMenusInterface.report:
                openRowPage(item.key);
                return;
            case SubMenusInterface.chat:
                show(item.key, ChatSubMenu);
                analyticsClient.menuChat();
                return;
            case SubMenusInterface.shortcuts:
                show(item.key, ShortcutSubMenu);
                analyticsClient.menuShortcuts();
                return;
        }
    }

    function show(
        id: string,
        component: ComponentType,
        frame = false,
        componentProps: { url: string; allowApi: boolean; allow: string | undefined } | Record<string, never> = {}
    ) {
        current = id;
        rowPage = undefined;
        activeComponent = component;
        props = componentProps;
        isFrame = frame;
    }

    async function openSettings(section: "general" | "sound") {
        const wasSettings = activeComponent === SettingsSubMenu;
        show(section, SettingsSubMenu);
        if (!wasSettings) analyticsClient.menuSetting();
        await tick();
    }

    function openRowPage(key: string) {
        current = "general";
        rowPage = key;
        isFrame = FRAME_PAGES.includes(key);
        props = {};
        switch (key) {
            case SubMenusInterface.aboutRoom:
                activeComponent = AboutRoomSubMenu;
                analyticsClient.menuCredit();
                break;
            case SubMenusInterface.contact:
                activeComponent = ContactSubMenu;
                analyticsClient.menuContact();
                break;
            case SubMenusInterface.report:
                activeComponent = ReportSubMenu;
                analyticsClient.reportIssue();
                break;
        }
    }

    /** Opens a menu item through the store, as the profile menu and scripts do; the store only tells us when it changes. */
    function activate(item: MenuItem) {
        const before = get(activeSubMenuStore);
        activeSubMenuStore.activateByMenuItem(item);
        if (get(activeSubMenuStore) === before) void open(item);
    }

    function selectPage(page: Page) {
        if (page.id === current && rowPage === undefined) return;
        // Settings is one menu item for two pages: say which one before opening it.
        if (page.id === "general" || page.id === "sound") current = page.id;
        activate(page.item);
    }

    function openRow(key: string) {
        const item = $subMenusStore.find((menu) => menu.key === key);
        if (item) activate(item);
    }

    function back() {
        current = "general";
        if (settingsItem) activate(settingsItem);
    }

    function closeMenu() {
        activeSubMenuStore.activateByIndex(0);
        menuVisiblilityStore.set(false);
    }

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            closeMenu();
        }
    }

    // ─── The phone tabs' pill: it slides under the open tab, measured from the tab itself. ───
    let tabsElement: HTMLElement | undefined;
    let pillStyle = "";
    let resizeObserver: ResizeObserver | undefined;

    function placePill() {
        const active = tabsElement?.querySelector<HTMLElement>(".u-settings-tab.is-active");
        if (!active) {
            pillStyle = "opacity: 0;";
            return;
        }
        pillStyle = `width: ${active.offsetWidth}px; transform: translateX(${active.offsetLeft}px);`;
        active.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }

    $: if (tabsElement && !resizeObserver && typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => placePill());
        resizeObserver.observe(tabsElement);
    }
    /** Re-measures once the tabs have been drawn for this page and this list of pages. */
    function schedulePill(_page: string, _count: number) {
        tick()
            .then(placePill)
            .catch((e) => console.error(e));
    }

    $: if (tabsElement) schedulePill(current, allPages.length);

    // Motion as in Express and Explore: quick, eased out, and none for players who ask for less.
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    function unfold(_node: Element): TransitionConfig {
        return {
            duration: reducedMotion ? 0 : 260,
            easing: cubicOut,
            css: (t) => `opacity: ${t}; transform: translateY(${(1 - t) * 12}px) scale(${0.96 + 0.04 * t});`,
        };
    }
</script>

<svelte:window on:keydown={onKeyDown} />

<div class="u-settings-layer font-main">
    <section
        class="u-settings u-surface"
        aria-labelledby="settings-title"
        data-testid="settings-window"
        transition:unfold
    >
        <nav class="u-settings-nav" aria-label={$LL.menu.sub.settings()}>
            <h2 class="u-settings-title">{$LL.menu.sub.settings()}</h2>
            {#each pages as page (page.id)}
                <button
                    type="button"
                    class="u-settings-navrow"
                    class:is-active={current === page.id}
                    aria-current={current === page.id ? "page" : undefined}
                    data-testid="settings-nav-{page.id}"
                    on:click={() => selectPage(page)}
                >
                    <svelte:component this={page.icon} />
                    <span>{page.label}</span>
                </button>
            {/each}
            {#if otherPages.length > 0}
                <div class="u-settings-navdivider" role="separator" />
                {#each otherPages as page (page.id)}
                    <button
                        type="button"
                        class="u-settings-navrow"
                        class:is-active={current === page.id}
                        aria-current={current === page.id ? "page" : undefined}
                        data-testid="settings-nav-{page.id}"
                        on:click={() => selectPage(page)}
                    >
                        <svelte:component this={page.icon} />
                        <span>{page.label}</span>
                    </button>
                {/each}
            {/if}
        </nav>

        <div class="u-settings-main">
            <header class="u-settings-head">
                {#if rowPage !== undefined}
                    <button
                        type="button"
                        class="u-close u-settings-round"
                        aria-label={$LL.menu.settings.back()}
                        data-testid="settings-back"
                        on:click={back}
                    >
                        <IconArrowLeft font-size="20" />
                    </button>
                    <h2 id="settings-title" class="u-settings-title">{rowPageLabel ?? ""}</h2>
                {:else}
                    <h2 id="settings-title" class="u-settings-title">
                        <span class="u-settings-title-phone">{$LL.menu.sub.settings()}</span>
                        <span class="u-settings-title-wide">{currentPage?.label ?? $LL.menu.sub.settings()}</span>
                    </h2>
                {/if}
                <button
                    type="button"
                    class="u-close u-settings-round"
                    id="closeMenu"
                    data-testid="closeMenuBtn"
                    aria-label={$LL.menu.settings.close()}
                    on:click={closeMenu}
                >
                    <IconX font-size="20" />
                </button>
            </header>

            {#if rowPage === undefined && allPages.length > 1}
                <div class="u-settings-tabs u-glass" role="tablist" bind:this={tabsElement}>
                    <span class="u-settings-pill" style={pillStyle} aria-hidden="true" />
                    {#each allPages as page (page.id)}
                        <button
                            type="button"
                            role="tab"
                            class="u-settings-tab"
                            class:is-active={current === page.id}
                            aria-selected={current === page.id}
                            data-testid="settings-tab-{page.id}"
                            on:click={() => selectPage(page)}
                        >
                            {page.label}
                        </button>
                    {/each}
                </div>
            {/if}

            <div class="u-settings-body" class:is-frame={isFrame} id="submenu">
                {#if activeComponent === SettingsSubMenu}
                    <SettingsSubMenu
                        section={current === "sound" ? "sound" : "general"}
                        pages={rowPages}
                        onOpenPage={openRow}
                    />
                {:else if activeComponent}
                    <svelte:component this={activeComponent} {...props} />
                {/if}
            </div>
        </div>
    </section>
</div>
