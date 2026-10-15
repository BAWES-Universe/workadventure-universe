<script lang="ts">
    import { slide } from "svelte/transition";
    import LL from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { inviteUserActivated, userIsConnected } from "../../Stores/MenuStore";
    import { chatSearchBarValue, chatSearchOpenStore, inviteCardRequestStore, navChat } from "../Stores/ChatStore";
    import ChatHeader from "./ChatHeader.svelte";
    import ChatHeaderNewMenu from "./Header/ChatHeaderNewMenu.svelte";
    import { focusChatSearchRequest, getNewChatOptions } from "./Header/ChatHeaderNewMenu";
    import { isChatSearchOpen } from "./Header/ChatSearchOpen";
    import InviteCard from "./InviteCard.svelte";
    import { IconSearch, IconUserPlus } from "@wa-icons";

    /**
     * The footer of the Chats and People lists, pinned to the bottom of the chat panel: "Invite someone to join", a
     * round search button and, on Chats, a round "+". Tapping search turns the whole row into the search field with
     * its Cancel (ChatHeader.svelte). Invite opens a small card right above it: the link to this room, one-tap copy
     * or share, and two options (arrive next to me, pick an entry point), InviteCard.svelte, which the installed
     * app's title bar opens too. Same link rules as the menu's invite page; no page change, nothing to close.
     */
    const gameScene = gameManager.tryGetCurrentGameScene();
    const chatStatusStore = gameManager.chatConnection.connectionStatus;
    const isMatrixGuest = gameManager.chatConnection.isGuest;
    const isPeopleListEnabled = gameScene?.room.isChatOnlineListEnabled ?? false;

    let open = false;
    let container: HTMLDivElement | undefined;

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

    function toggle() {
        open = !open;
    }

    function close() {
        open = false;
    }

    // A map script asked for the invite menu: open the card.
    $: if ($inviteCardRequestStore) {
        inviteCardRequestStore.set(false);
        // Not while the search field has the footer: the card would be hidden and pop up after Cancel.
        if (!open && !searchOpen) toggle();
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
                <div class="mb-2" transition:slide={{ duration: 180 }}>
                    <InviteCard on:close={close} />
                </div>
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
                        on:click|stopPropagation={toggle}
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
</style>
