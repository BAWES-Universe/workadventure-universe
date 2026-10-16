<script lang="ts">
    import { onDestroy, tick } from "svelte";
    import { fade, fly } from "svelte/transition";
    import { CHAT_SHEET_INVITE_PEEK } from "../ChatSheetSizes";
    import LL from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { inviteUserActivated, userIsConnected } from "../../Stores/MenuStore";
    import {
        chatInviteSheetHeightStore,
        chatSearchBarValue,
        chatSearchOpenStore,
        inviteCardRequestStore,
        navChat,
    } from "../Stores/ChatStore";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import ChatHeader from "./ChatHeader.svelte";
    import ChatHeaderNewMenu from "./Header/ChatHeaderNewMenu.svelte";
    import { focusChatSearchRequest, getNewChatOptions } from "./Header/ChatHeaderNewMenu";
    import { isChatSearchOpen } from "./Header/ChatSearchOpen";
    import { IconCheck, IconCopy, IconLink, IconSearch, IconShare, IconUserPlus, IconX } from "@wa-icons";

    /**
     * The footer of the Chats and People lists, pinned to the bottom of the chat panel: "Invite someone to join", a
     * round search button and, on Chats, a round "+". Tapping search turns the whole row into the search field with
     * its Cancel (ChatHeader.svelte). Invite takes the row's place the same way, with a panel that slides up over the
     * dimmed list (the list doesn't move): the link to this room, two options (arrive next to me, pick an entry
     * point) and Share and Copy link at the bottom, where the button was. On a phone's chat sheet the sheet borrows the
     * height the panel needs (ChatSidebar.svelte) and gives it back on close. Same link rules as the menu's invite page.
     * The panel is positioned against the list column that holds this footer, which must be `relative`.
     */
    const COPIED_FOR_MS = 3000;

    // No scene while a reconnect swaps it: the link still works, without entry points or "next to me".
    const gameScene = gameManager.tryGetCurrentGameScene();
    const startPositions = gameScene?.getStartPositionNames() ?? [];
    const canShare = typeof navigator.share === "function";
    const roomName = gameScene?.room.roomName?.trim();
    const chatStatusStore = gameManager.chatConnection.connectionStatus;
    const isMatrixGuest = gameManager.chatConnection.isGuest;
    const isPeopleListEnabled = gameScene?.room.isChatOnlineListEnabled ?? false;

    let open = false;
    let arriveNextToMe = false;
    let entryPoint = startPositions[0] ?? "";
    let copied = false;
    let copiedTimer: ReturnType<typeof setTimeout> | undefined;
    let overlay: HTMLElement | undefined;
    let panel: HTMLElement | undefined;
    let panelHeight = 0;
    // The sheet's height that shows the panel whole: the panel, everything else in the chat that is not the list
    // column (the handle, the tabs, a banner under the list...) and a peek of the dimmed list.
    let sheetNeeds = 0;
    let linkText: HTMLElement | undefined;
    let trigger: HTMLButtonElement | undefined;

    function playerPosition(): { x: number; y: number } | undefined {
        const player = gameManager.tryGetCurrentGameScene()?.CurrentPlayer;
        return player ? { x: Math.floor(player.x), y: Math.floor(player.y) } : undefined;
    }

    function buildLink(): string {
        const base = `${location.origin}${location.pathname}`;
        const hash: string[] = [];
        if (entryPoint && startPositions.length > 1) hash.push(entryPoint);
        const position = arriveNextToMe ? playerPosition() : undefined;
        if (position) hash.push(`moveTo=${position.x},${position.y}`);
        return hash.length > 0 ? `${base}#${hash.join("&")}` : base;
    }

    // Search covers the open tab's own list; People reaches the world's members too. Chats has none while offline.
    $: showSearch = $navChat.key === "users" || ($navChat.key === "chat" && $chatStatusStore !== "OFFLINE");

    // One "+" for New message, New group, Find a group and New folder. Hidden for guests: saved chat needs an account.
    $: newChatOptions =
        $navChat.key === "chat"
            ? getNewChatOptions({
                  isSignedIn: $userIsConnected,
                  isMatrixGuest: $isMatrixGuest,
                  chatStatus: $chatStatusStore,
                  isPeopleListEnabled,
              })
            : [];

    // Open when the person opened it, or when something else filled the text in or asked for its focus ("New message",
    // "Find people" after a proximity chat). Once open it stays open until Cancel, even if the text is cleared.
    $: searchOpen =
        showSearch &&
        isChatSearchOpen({
            opened: $chatSearchOpenStore,
            value: $chatSearchBarValue,
            focusRequested: $focusChatSearchRequest,
        });
    $: if (searchOpen && !$chatSearchOpenStore) chatSearchOpenStore.set(true);
    // The search replaces the invite panel's place: an open panel closes.
    $: if (searchOpen) open = false;
    // A map script can take the invite button away while the panel is open.
    $: if (!$inviteUserActivated) open = false;
    // The sheet's height that shows the panel whole (measured below).
    $: sheetNeeds = measureSheetNeeds(panelHeight, overlay);
    // The chat sheet borrows it while the panel is open.
    $: chatInviteSheetHeightStore.set(open ? sheetNeeds : 0);

    let chatResizeObserver: ResizeObserver | undefined;
    function measureSheetNeeds(height: number, element: HTMLElement | undefined): number {
        const chat = element?.closest<HTMLElement>("#chat");
        if (!element || !chat || height <= 0) return 0;
        // A banner under the list can wrap or go away while the panel is open: measure again when the chat resizes.
        if (!chatResizeObserver && typeof ResizeObserver !== "undefined") {
            chatResizeObserver = new ResizeObserver(() => (sheetNeeds = measureSheetNeeds(panelHeight, overlay)));
            chatResizeObserver.observe(chat);
        }
        // The panel's own height is cut to the column while the sheet is low: what it needs is its content's height.
        const panelNeeds = Math.max(height, panel?.scrollHeight ?? 0);
        // The overlay fills the list column: what the chat has besides it stays the same at any sheet height.
        return panelNeeds + (chat.offsetHeight - element.offsetHeight) + CHAT_SHEET_INVITE_PEEK;
    }

    // The Chats tab can lose its search (chat offline): the sheet must not stay full height for a field that is gone.
    $: if (!showSearch && $chatSearchOpenStore) chatSearchOpenStore.set(false);

    function openSearch() {
        // The field takes the focus as it appears (ChatHeader), inside this tap, so the phone's keyboard opens at once.
        focusChatSearchRequest.set(true);
        chatSearchOpenStore.set(true);
    }

    let link = "";
    // Rebuilt whenever an option changes, and each time the card opens (you may have moved since).
    $: link = linkFor(arriveNextToMe, entryPoint, open);

    function linkFor(_nextToMe: boolean, _entry: string, _open: boolean): string {
        return buildLink();
    }

    async function toggle() {
        open = !open;
        if (open) {
            analyticsClient.openInvite();
            await tick();
            // Escape and the screen reader's reading order start inside the panel. The link is not selected: on an
            // iPhone that shows the selection handles over it.
            panel?.focus({ preventScroll: true });
        }
    }

    function close(restoreFocus = true) {
        open = false;
        if (!restoreFocus) return;
        // The button is back (it hides, kept in place, while the panel is open): the focus returns to it, also after a
        // tap on the dimmed list, which takes the focus away before it closes the panel.
        tick()
            .then(() => trigger?.focus({ preventScroll: true }))
            .catch((e) => console.error(e));
    }

    // A click anywhere else (the map, the tabs, another window) closes the panel too, and keeps the focus where the
    // click put it. The Invite button toggles the panel itself; the panel and its dimmed list close it themselves.
    function onWindowClick(event: MouseEvent) {
        if (!open || !(event.target instanceof Node)) return;
        if (overlay?.contains(event.target) || trigger?.contains(event.target)) return;
        close(false);
    }
    // Shown without "https://": the panel is narrow and the part that tells rooms apart comes after it.
    $: linkShown = link.replace(/^https?:\/\//, "");

    // A map script asked for the invite menu: open the panel.
    $: if ($inviteCardRequestStore) {
        inviteCardRequestStore.set(false);
        // Not while the search field has the footer: the panel would be hidden and pop up after Cancel.
        if (!open && !searchOpen) toggle().catch((e) => console.error(e));
    }

    function copy() {
        // "Next to me" means where the player stands now, so read the position again at the moment of copying.
        link = buildLink();
        analyticsClient.inviteCopyLink();
        if (arriveNextToMe) analyticsClient.inviteCopyLinkWalk(link);
        navigator.clipboard
            .writeText(link)
            .then(() => {
                copied = true;
                if (copiedTimer) clearTimeout(copiedTimer);
                copiedTimer = setTimeout(() => (copied = false), COPIED_FOR_MS);
            })
            .catch((error) => {
                console.error("Could not copy the invite link", error);
                // Nothing to copy with: select the link so it can be copied by hand.
                const selection = window.getSelection();
                if (selection && linkText) selection.selectAllChildren(linkText);
            });
    }

    function share() {
        link = buildLink();
        analyticsClient.inviteCopyLink();
        navigator.share({ url: link }).catch(() => copy());
    }

    function onKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape" && open) {
            event.stopPropagation();
            close();
        }
    }

    onDestroy(() => {
        if (copiedTimer) clearTimeout(copiedTimer);
        // The Chats and People tabs each hold a footer: leaving one with the panel open gives the sheet its height back.
        chatResizeObserver?.disconnect();
        chatInviteSheetHeightStore.set(0);
    });
</script>

<svelte:window on:click={onWindowClick} />

{#if $inviteUserActivated || showSearch || newChatOptions.length > 0}
    <div class="invite-footer sticky bottom-0 z-30 shrink-0 px-4 pb-4 pt-3" data-testid="chatInviteFooter">
        {#if searchOpen}
            <ChatHeader />
        {:else}
            <!-- While the panel is open the row steps aside but keeps its place, so nothing in the list moves. -->
            <!-- The "+" menu opens upward from this row. -->
            <div class="relative flex items-center gap-2" class:invisible={open} aria-hidden={open} inert={open}>
                {#if $inviteUserActivated}
                    <button
                        bind:this={trigger}
                        type="button"
                        class="invite-button m-0 flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-3 text-sm font-bold text-white lg:gap-1.5 lg:px-2"
                        aria-expanded={open}
                        aria-controls="chatInvitePanel"
                        data-testid="chatInviteButton"
                        on:click={() => toggle().catch((e) => console.error(e))}
                    >
                        <IconUserPlus font-size="18" class="shrink-0" />
                        <span class="min-w-0 truncate">{$LL.chat.inviteFooter.button()}</span>
                    </button>
                {:else}
                    <div class="grow" />
                {/if}
                {#if showSearch}
                    <button
                        type="button"
                        class="u-glass-btn w-11"
                        data-testid="chatSearchOpen"
                        aria-label={$navChat.key === "users"
                            ? $LL.chat.header.searchPeople()
                            : $LL.chat.header.searchChat()}
                        title={$navChat.key === "users" ? $LL.chat.header.searchPeople() : $LL.chat.header.searchChat()}
                        on:click={openSearch}
                    >
                        <IconSearch font-size="20" />
                    </button>
                {/if}
                {#if newChatOptions.length > 0}
                    <ChatHeaderNewMenu options={newChatOptions} />
                {/if}
            </div>
        {/if}
    </div>
{/if}

{#if open}
    <!-- Over the list column (the nearest `relative` ancestor), not inside the footer: the footer is only 70px tall and
         the list behind it keeps its size. A tap on the dimmed list, the X or Escape closes it. -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
        bind:this={overlay}
        class="invite-overlay absolute inset-0 z-40 flex flex-col justify-end overflow-hidden"
        transition:fade={{ duration: 150 }}
        on:keydown={onKeyDown}
        data-testid="chatInviteOverlay"
    >
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <div
            class="invite-dim absolute inset-0"
            aria-hidden="true"
            on:click={() => close()}
            data-testid="chatInviteDim"
        />
        <section
            bind:this={panel}
            bind:clientHeight={panelHeight}
            id="chatInvitePanel"
            class="invite-panel relative flex max-h-full flex-col gap-3 overflow-y-auto px-4 pb-4 pt-1.5"
            role="dialog"
            aria-labelledby="chatInviteTitle"
            tabindex="-1"
            transition:fly={{ y: 48, duration: 180 }}
            data-testid="chatInviteCard"
        >
            <span class="invite-grabber" aria-hidden="true" />

            <div class="flex min-h-11 items-center gap-2">
                <h3 id="chatInviteTitle" class="u-text-gradient m-0 min-w-0 flex-1 text-base font-bold leading-6">
                    {$LL.chat.inviteFooter.title()}
                </h3>
                <button
                    type="button"
                    class="u-close -me-2"
                    aria-label={$LL.chat.inviteFooter.close()}
                    data-testid="chatInviteClose"
                    on:click={() => close()}
                >
                    <IconX font-size="22" />
                </button>
            </div>

            <p class="m-0 -mt-2.5 text-xs leading-[18px] text-white/60">
                {roomName ? $LL.chat.inviteFooter.hintRoom({ room: roomName }) : $LL.chat.inviteFooter.hint()}
            </p>

            <div
                class="invite-link flex h-11 min-w-0 items-center gap-2.5 rounded-full px-3.5 text-[13px] text-white/80"
            >
                <IconLink font-size="18" class="shrink-0" aria-hidden="true" />
                <span
                    bind:this={linkText}
                    class="min-w-0 flex-1 truncate"
                    dir="ltr"
                    title={link}
                    aria-label={$LL.chat.inviteFooter.linkLabel()}
                    data-testid="chatInviteLink"
                    data-link={link}>{linkShown}</span
                >
            </div>

            <div class="invite-group rounded-2xl">
                <label class="invite-option flex min-h-14 cursor-pointer items-center gap-3 px-3.5 py-1.5">
                    <span class="flex min-w-0 flex-1 flex-col">
                        <span class="text-sm font-bold text-white">{$LL.chat.inviteFooter.nextToMe()}</span>
                        <span class="text-xs leading-[18px] text-white/60">{$LL.chat.inviteFooter.nextToMeHint()}</span>
                    </span>
                    <input
                        type="checkbox"
                        class="invite-switch m-0 shrink-0"
                        bind:checked={arriveNextToMe}
                        data-testid="chatInviteNextToMe"
                    />
                </label>

                {#if startPositions.length > 1}
                    <label class="invite-option invite-option-divided flex min-h-14 items-center gap-3 px-3.5 py-1.5">
                        <span class="flex-1 text-sm font-bold text-white">{$LL.chat.inviteFooter.entryPoint()}</span>
                        <select
                            bind:value={entryPoint}
                            class="invite-select m-0 h-9 max-w-[55%] truncate rounded-full px-3.5 text-[13px] font-semibold text-white"
                            data-testid="chatInviteEntryPoint"
                        >
                            {#each startPositions as name (name)}
                                <option value={name}>{name}</option>
                            {/each}
                        </select>
                    </label>
                {/if}
            </div>

            <div class="flex gap-2">
                {#if canShare}
                    <button
                        type="button"
                        class="u-glass-btn flex-1 gap-2 px-4 text-sm font-bold"
                        data-testid="chatInviteShare"
                        on:click={share}
                    >
                        <IconShare font-size="18" />
                        {$LL.chat.inviteFooter.share()}
                    </button>
                {/if}
                <button
                    type="button"
                    class="invite-copy m-0 flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-bold text-white {canShare
                        ? 'flex-[1.4]'
                        : 'flex-1'}"
                    data-testid="chatInviteCopy"
                    on:click={copy}
                >
                    {#if copied}
                        <IconCheck font-size="18" />
                        {$LL.menu.invite.copied()}
                    {:else}
                        <IconCopy font-size="18" />
                        {$LL.chat.inviteFooter.copyLink()}
                    {/if}
                </button>
            </div>
        </section>
    </div>
{/if}

<style>
    /* Fades the list out under the footer, so the button sits on the panel rather than on a hard edge. */
    .invite-footer {
        background: linear-gradient(to top, rgb(var(--u-ink) / 0.95) 55%, rgb(var(--u-ink) / 0));
    }
    /* Follows the floating chat's rounded bottom corners on a desktop (chat.scss). Below that the chat is edge to edge
       and square, and so is the footer. */
    @media (min-width: 1024px) {
        .invite-footer {
            border-radius: 0 0 24px 24px;
        }
    }

    /* The Express button's look, as a wide pill: Express ink, the same inner edge and soft purple glow, and its
       purple, blue and gold edge as a still ring (the glow of what is always on screen, not an animation). Plain
       white text and glyph. Hover is the bar's soft white, 8%, laid over the ink. */
    .invite-button {
        position: relative;
        isolation: isolate;
        border: none;
        background: var(--u-surface-bg);
        box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08) inset, 0 0 14px -2px rgba(134, 41, 252, 0.3);
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }
    .invite-button::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        padding: 1.5px;
        background: conic-gradient(from 200deg, #8629fc, #4156f6, #e9c74c, #8629fc);
        -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
        mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
        -webkit-mask-composite: xor;
        mask-composite: exclude;
        opacity: 0.55;
        z-index: -1;
        pointer-events: none;
    }
    @media (hover: hover) {
        .invite-button:hover {
            background: linear-gradient(rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.08)), var(--u-surface-bg);
        }
    }
    .invite-button:active,
    .invite-button[aria-expanded="true"] {
        background: linear-gradient(rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.1)), var(--u-surface-bg);
    }
    .invite-button:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 2px;
    }

    /* The dimmed list behind the panel: ink at 62%, the way the mock draws it. */
    .invite-dim {
        background: rgb(10 8 20 / 0.62);
    }

    /* The panel: a raised sheet in the sheet's own ink, a violet edge and a soft violet glow. On a phone it is square at
       the bottom like the sheet; from 1024px the chat floats, rounded on all corners (chat.scss). */
    .invite-panel {
        border-radius: 24px 24px 0 0;
        background: linear-gradient(160deg, rgb(38 34 58 / 0.99), rgb(20 18 30 / 0.99));
        box-shadow: 0 1px 0 rgb(255 255 255 / 0.1) inset, 0 0 0 1px rgb(167 139 250 / 0.24),
            0 -18px 40px -16px rgb(0 0 0 / 0.7), 0 0 32px -12px rgb(134 41 252 / 0.55);
    }
    @media (min-width: 1024px) {
        .invite-panel {
            border-radius: 24px;
        }
    }
    .invite-panel:focus {
        outline: none;
    }
    .invite-grabber {
        display: block;
        flex: none;
        align-self: center;
        width: 40px;
        height: 5px;
        margin-top: 4px;
        border-radius: 9999px;
        background: rgb(255 255 255 / 0.3);
    }

    .invite-link {
        background: rgb(0 0 0 / 0.25);
        border: 1px solid rgb(255 255 255 / 0.08);
    }

    .invite-group {
        background: rgb(255 255 255 / 0.04);
        border: 1px solid rgb(255 255 255 / 0.06);
    }
    .invite-option-divided {
        border-top: 1px solid rgb(255 255 255 / 0.06);
    }
    .invite-select {
        background: rgb(255 255 255 / 0.06);
        border: 1px solid rgb(255 255 255 / 0.12);
        cursor: pointer;
    }

    /* Copy link: the primary action. Brand gradient; hover is the bar's soft white, 8%, laid over it (no shadow or
       size change); a tap presses it with the same white at 10%. */
    .invite-copy {
        border: none;
        background-color: transparent;
        background-image: linear-gradient(transparent, transparent), linear-gradient(90deg, #8629fc, #4156f6);
        box-shadow: 0 8px 24px -10px rgb(134 41 252 / 0.7);
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }
    @media (hover: hover) {
        .invite-copy:hover {
            background-image: linear-gradient(rgb(255 255 255 / 0.08), rgb(255 255 255 / 0.08)),
                linear-gradient(90deg, #8629fc, #4156f6);
        }
    }
    .invite-copy:active {
        background-image: linear-gradient(rgb(255 255 255 / 0.1), rgb(255 255 255 / 0.1)),
            linear-gradient(90deg, #8629fc, #4156f6);
    }
    .invite-copy:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 2px;
    }
    .invite-select:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 2px;
    }

    .invite-option {
        transition: background-color 150ms ease;
    }
    .invite-option:hover {
        background: rgb(255 255 255 / 0.04);
    }
    .invite-group > .invite-option:first-child {
        border-radius: 15px 15px 0 0;
    }
    .invite-group > .invite-option:last-child {
        border-radius: 0 0 15px 15px;
    }
    .invite-group > .invite-option:only-child {
        border-radius: 15px;
    }

    /* A small brand switch for the checkbox, 44 x 26 like the mock. */
    .invite-switch {
        appearance: none;
        -webkit-appearance: none;
        position: relative;
        width: 2.75rem;
        height: 1.625rem;
        border-radius: 999px;
        background: rgb(255 255 255 / 0.15);
        cursor: pointer;
        transition: background 200ms ease;
    }
    .invite-switch::after {
        content: "";
        position: absolute;
        top: 3px;
        inset-inline-start: 3px;
        width: 1.25rem;
        height: 1.25rem;
        border-radius: 999px;
        background: #fff;
        transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .invite-switch:checked {
        background: linear-gradient(90deg, #8629fc, #4156f6);
    }
    .invite-switch:checked::after {
        transform: translateX(1.125rem);
    }
    :global([dir="rtl"]) .invite-switch:checked::after {
        transform: translateX(-1.125rem);
    }
    .invite-switch:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 2px;
    }
</style>
