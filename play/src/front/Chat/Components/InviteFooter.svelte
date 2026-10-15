<script lang="ts">
    import { onDestroy, tick } from "svelte";
    import { slide } from "svelte/transition";
    import LL from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { inviteUserActivated, userIsConnected } from "../../Stores/MenuStore";
    import { chatSearchBarValue, chatSearchOpenStore, inviteCardRequestStore, navChat } from "../Stores/ChatStore";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import ChatHeader from "./ChatHeader.svelte";
    import ChatHeaderNewMenu from "./Header/ChatHeaderNewMenu.svelte";
    import { focusChatSearchRequest, getNewChatOptions } from "./Header/ChatHeaderNewMenu";
    import { isChatSearchOpen } from "./Header/ChatSearchOpen";
    import { IconCheck, IconCopy, IconSearch, IconShare, IconUserPlus, IconX } from "@wa-icons";

    /**
     * The footer of the Chats and People lists, pinned to the bottom of the chat panel: "Invite someone to join", a
     * round search button and, on Chats, a round "+". Tapping search turns the whole row into the search field with
     * its Cancel (ChatHeader.svelte). Invite opens a small card right above it: the link to this room, one-tap copy
     * or share, and two options (arrive next to me, pick an entry point). Same link rules as the menu's invite page;
     * no page change, nothing to close.
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
    let container: HTMLDivElement | undefined;
    let linkField: HTMLInputElement | undefined;

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
    // The search replaces the invite card's place: an open card closes.
    $: if (searchOpen) open = false;
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
            linkField?.select();
        }
    }

    function close() {
        open = false;
    }

    // A map script asked for the invite menu: open the card.
    $: if ($inviteCardRequestStore) {
        inviteCardRequestStore.set(false);
        // Not while the search field has the footer: the card would be hidden and pop up after Cancel.
        if (!open && !searchOpen) toggle().catch((e) => console.error(e));
    }

    function copy() {
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
                linkField?.select();
            });
    }

    function share() {
        analyticsClient.inviteCopyLink();
        navigator.share({ url: link }).catch(() => copy());
    }

    function onWindowClick(event: MouseEvent) {
        if (!open || !container) return;
        if (event.target instanceof Node && container.contains(event.target)) return;
        close();
    }

    function onKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape" && open) {
            event.stopPropagation();
            close();
        }
    }

    onDestroy(() => {
        if (copiedTimer) clearTimeout(copiedTimer);
    });
</script>

<svelte:window on:click={onWindowClick} />

{#if $inviteUserActivated || showSearch || newChatOptions.length > 0}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
        class="invite-footer sticky bottom-0 z-30 shrink-0 px-4 pb-4 pt-3"
        bind:this={container}
        on:keydown={onKeyDown}
        data-testid="chatInviteFooter"
    >
        {#if searchOpen}
            <ChatHeader />
        {:else}
            {#if open}
                <section
                    class="u-glass invite-card mb-2 rounded-2xl p-3"
                    aria-labelledby="chatInviteTitle"
                    transition:slide={{ duration: 180 }}
                    data-testid="chatInviteCard"
                >
                    <div class="flex items-start gap-2">
                        <div class="flex min-w-0 grow flex-col">
                            <h3 id="chatInviteTitle" class="u-text-gradient m-0 text-base font-bold leading-6">
                                {$LL.chat.inviteFooter.title()}
                            </h3>
                            <p class="m-0 text-xs leading-5 text-white/60">
                                {roomName
                                    ? $LL.chat.inviteFooter.hintRoom({ room: roomName })
                                    : $LL.chat.inviteFooter.hint()}
                            </p>
                        </div>
                        <button
                            type="button"
                            class="m-0 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg p-0 text-white/60 hover:bg-white/10 hover:text-white"
                            aria-label={$LL.chat.inviteFooter.close()}
                            on:click={close}
                        >
                            <IconX font-size="16" />
                        </button>
                    </div>

                    <div class="invite-link mt-3 flex items-center gap-1 rounded-xl p-1 ps-3">
                        <input
                            bind:this={linkField}
                            type="text"
                            readonly
                            class="m-0 min-w-0 grow border-none bg-transparent p-0 text-xs text-white/80 focus:outline-none focus:ring-0"
                            value={link}
                            aria-label={$LL.chat.inviteFooter.linkLabel()}
                            data-testid="chatInviteLink"
                            on:focus={() => linkField?.select()}
                        />
                        <button
                            type="button"
                            class="u-cta m-0 flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-bold"
                            data-testid="chatInviteCopy"
                            on:click={copy}
                        >
                            {#if copied}
                                <IconCheck font-size="16" />
                                {$LL.menu.invite.copied()}
                            {:else}
                                <IconCopy font-size="16" />
                                {$LL.menu.invite.copy()}
                            {/if}
                        </button>
                    </div>

                    {#if canShare}
                        <button
                            type="button"
                            class="u-cta-secondary m-0 mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold"
                            data-testid="chatInviteShare"
                            on:click={share}
                        >
                            <IconShare font-size="18" />
                            {$LL.chat.inviteFooter.share()}
                        </button>
                    {/if}

                    <label class="invite-option mt-3 flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2">
                        <input
                            type="checkbox"
                            class="invite-switch m-0 shrink-0"
                            bind:checked={arriveNextToMe}
                            data-testid="chatInviteNextToMe"
                        />
                        <span class="flex min-w-0 flex-col">
                            <span class="text-sm font-semibold text-white">{$LL.chat.inviteFooter.nextToMe()}</span>
                            <span class="text-xs text-white/55">{$LL.chat.inviteFooter.nextToMeHint()}</span>
                        </span>
                    </label>

                    {#if startPositions.length > 1}
                        <label class="invite-option mt-2 flex items-center gap-3 rounded-xl px-3 py-2">
                            <span class="grow text-sm font-semibold text-white"
                                >{$LL.chat.inviteFooter.entryPoint()}</span
                            >
                            <select
                                bind:value={entryPoint}
                                class="m-0 max-w-[50%] rounded-lg border border-solid border-white/15 bg-contrast/80 px-2 py-1 text-xs text-white"
                                data-testid="chatInviteEntryPoint"
                            >
                                {#each startPositions as name (name)}
                                    <option value={name}>{name}</option>
                                {/each}
                            </select>
                        </label>
                    {/if}
                </section>
            {/if}

            <!-- The "+" menu opens upward from this row. -->
            <div class="relative flex items-center gap-2">
                {#if $inviteUserActivated}
                    <button
                        type="button"
                        class="invite-button m-0 flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-3 text-sm font-bold text-white lg:gap-1.5 lg:px-2"
                        aria-expanded={open}
                        aria-controls="chatInviteTitle"
                        data-testid="chatInviteButton"
                        on:click|stopPropagation={() => toggle().catch((e) => console.error(e))}
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

    .invite-card {
        box-shadow: 0 18px 40px -16px rgb(0 0 0 / 0.6);
    }

    .invite-link {
        background: rgb(0 0 0 / 0.25);
        border: 1px solid rgb(255 255 255 / 0.08);
    }

    .invite-option {
        background: rgb(255 255 255 / 0.04);
        transition: background-color 150ms ease;
    }
    .invite-option:hover {
        background: rgb(255 255 255 / 0.08);
    }

    /* A small brand switch for the checkbox. */
    .invite-switch {
        appearance: none;
        -webkit-appearance: none;
        position: relative;
        width: 2.25rem;
        height: 1.25rem;
        border-radius: 999px;
        background: rgb(255 255 255 / 0.15);
        cursor: pointer;
        transition: background 200ms ease;
    }
    .invite-switch::after {
        content: "";
        position: absolute;
        top: 2px;
        inset-inline-start: 2px;
        width: 1rem;
        height: 1rem;
        border-radius: 999px;
        background: #fff;
        transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .invite-switch:checked {
        background: linear-gradient(90deg, #8629fc, #4156f6);
    }
    .invite-switch:checked::after {
        transform: translateX(1rem);
    }
    :global([dir="rtl"]) .invite-switch:checked::after {
        transform: translateX(-1rem);
    }
    .invite-switch:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 2px;
    }
</style>
