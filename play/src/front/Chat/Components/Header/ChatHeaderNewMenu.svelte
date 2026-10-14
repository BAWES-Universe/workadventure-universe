<script lang="ts">
    import { onMount, tick } from "svelte";
    import type { ComponentType } from "svelte";
    import { openModal } from "svelte-modals";
    import LL from "../../../../i18n/i18n-svelte";
    import { findGroupOpenStore, navChat, peopleViewStore } from "../../Stores/ChatStore";
    import CreateRoomModal from "../Room/CreateRoomModal.svelte";
    import CreateFolderModal from "../Room/CreateFolderModal.svelte";
    import type { NewChatOption } from "./ChatHeaderNewMenu";
    import { focusChatSearchRequest, nextMenuIndex } from "./ChatHeaderNewMenu";
    import { IconFolder, IconPlus, IconSearch, IconSend, IconUsersGroup } from "@wa-icons";

    /** Which choices to show; the parent hides the whole "+" when this is empty. */
    export let options: NewChatOption[];

    let open = false;
    let triggerRef: HTMLButtonElement | undefined;
    let containerRef: HTMLDivElement | undefined;
    let itemRefs: HTMLButtonElement[] = [];
    const menuId = `chat-new-menu-${Math.random().toString(36).slice(2, 9)}`;

    // Existing e2e helpers open the root "create room / folder" menu by these ids, so they stay.
    const testIds: Record<NewChatOption, string> = {
        newMessage: "openNewMessageButton",
        newGroup: "openCreateRoomModalButton",
        findGroup: "openFindGroupButton",
        newFolder: "openCreateFolderModalButton",
    };
    const icons: Record<NewChatOption, ComponentType> = {
        newMessage: IconSend,
        newGroup: IconUsersGroup,
        findGroup: IconSearch,
        newFolder: IconFolder,
    };

    function label(option: NewChatOption): string {
        switch (option) {
            case "newMessage":
                return $LL.chat.header.newMessage();
            case "newGroup":
                return $LL.chat.header.newGroup();
            case "findGroup":
                return $LL.chat.header.findGroup();
            case "newFolder":
                return $LL.chat.header.newFolder();
        }
    }

    function hint(option: NewChatOption): string {
        switch (option) {
            case "newMessage":
                return $LL.chat.header.newMessageHint();
            case "newGroup":
                return $LL.chat.header.newGroupHint();
            case "findGroup":
                return $LL.chat.header.findGroupHint();
            case "newFolder":
                return $LL.chat.header.newFolderHint();
        }
    }

    // The menu opens upward and the list column clips it: on a low sheet it gets the room there is above the "+" and
    // scrolls inside it.
    let maxHeight: number | undefined;
    function measureRoom() {
        let bound: HTMLElement | null = triggerRef?.parentElement ?? null;
        while (bound && !/(auto|scroll|hidden)/.test(getComputedStyle(bound).overflowY)) bound = bound.parentElement;
        const triggerTop = triggerRef?.getBoundingClientRect().top;
        // Room above the button, less the gap under the menu (8px) and a little air at the top.
        maxHeight =
            bound && triggerTop !== undefined
                ? Math.max(112, Math.floor(triggerTop - bound.getBoundingClientRect().top - 8 - 8))
                : undefined;
    }

    async function openMenu(focusIndex: number) {
        measureRoom();
        open = true;
        await tick();
        itemRefs[focusIndex]?.focus();
    }

    function closeMenu(returnFocus: boolean) {
        if (!open) return;
        open = false;
        if (returnFocus) triggerRef?.focus();
    }

    function toggleMenu() {
        if (open) closeMenu(false);
        else openMenu(0).catch((e) => console.error(e));
    }

    function onTriggerKeyDown(event: KeyboardEvent) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            // Keep arrows away from the game, so the avatar doesn't walk while the menu is used.
            event.preventDefault();
            event.stopPropagation();
            openMenu(event.key === "ArrowDown" ? 0 : options.length - 1).catch((e) => console.error(e));
        }
    }

    function onMenuKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeMenu(true);
            return;
        }
        if (event.key === "Tab") {
            closeMenu(false);
            return;
        }
        const current = itemRefs.findIndex((item) => item === document.activeElement);
        const next = nextMenuIndex(current, event.key, options.length);
        if (next !== undefined) {
            event.preventDefault();
            event.stopPropagation();
            itemRefs[next]?.focus();
        }
    }

    function choose(option: NewChatOption) {
        closeMenu(false);
        switch (option) {
            case "newMessage":
                // Pick a person on the People tab; its "Send message" opens the existing direct chat flow.
                // The search covers everyone, not only the friends a chip was left on.
                peopleViewStore.set("everyone");
                focusChatSearchRequest.set(true);
                navChat.switchToUserList();
                break;
            case "newGroup":
                openModal(CreateRoomModal, { parentID: undefined });
                break;
            case "findGroup":
                findGroupOpenStore.set(true);
                break;
            case "newFolder":
                openModal(CreateFolderModal, { parentID: undefined });
                break;
        }
    }

    // Close on a click anywhere else.
    function onDocumentClick(event: MouseEvent) {
        if (!open || containerRef === undefined) return;
        if (event.target instanceof Node && containerRef.contains(event.target)) return;
        closeMenu(false);
    }

    onMount(() => {
        document.addEventListener("click", onDocumentClick);
        return () => document.removeEventListener("click", onDocumentClick);
    });

    $: if (options.length === 0) open = false;
</script>

<!-- The popover is positioned against the footer row that holds this "+" (InviteFooter). -->
<div class="chat-new-menu" bind:this={containerRef}>
    <button
        type="button"
        bind:this={triggerRef}
        data-testid="openOptionToCreateRoomOrFolder"
        class="chat-new-trigger u-glass-btn w-11"
        class:is-open={open}
        aria-label={$LL.chat.header.newChat()}
        title={$LL.chat.header.newChat()}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        on:click|preventDefault={toggleMenu}
        on:keydown={onTriggerKeyDown}
    >
        <IconPlus font-size="22" class="chat-new-plus" />
    </button>

    {#if open}
        <div
            id={menuId}
            role="menu"
            tabindex="-1"
            aria-label={$LL.chat.header.newChat()}
            style:max-height={maxHeight !== undefined ? `${maxHeight}px` : undefined}
            class="chat-new-popover overflow-y-auto focus:outline-none absolute bottom-full end-0 mb-2 z-50 p-1.5 rounded-2xl bg-contrast/90 backdrop-blur-xl border border-solid border-white/10 shadow-2xl"
            on:keydown={onMenuKeyDown}
        >
            {#each options as option, index (option)}
                <button
                    type="button"
                    role="menuitem"
                    tabindex="-1"
                    bind:this={itemRefs[index]}
                    data-testid={testIds[option]}
                    class="chat-new-item m-0 w-full min-h-14 flex items-center gap-3 px-2 py-2 rounded-xl text-start text-white bg-transparent hover:bg-white/10 focus:outline-none focus-visible:bg-white/10 {option ===
                    'newFolder'
                        ? 'chat-new-item-last'
                        : ''}"
                    on:click={() => choose(option)}
                >
                    <span class="h-10 w-8 shrink-0 text-white flex items-center justify-center" aria-hidden="true">
                        <svelte:component this={icons[option]} font-size="20" />
                    </span>
                    <span class="flex flex-col min-w-0">
                        <span class="text-sm font-bold leading-5 truncate">{label(option)}</span>
                        <span class="text-xs leading-4 text-white/60 truncate">{hint(option)}</span>
                    </span>
                </button>
            {/each}
        </div>
    {/if}
</div>

<style>
    /* New folder is the odd one out: a line keeps it apart from the three everyday actions. */
    .chat-new-item-last {
        margin-top: 0.375rem;
        border-top: 1px solid rgb(255 255 255 / 0.12);
        border-radius: 0 0 0.75rem 0.75rem;
    }

    /* Opens upward from the "+", right-aligned with it (the footer row is its anchor). */
    .chat-new-popover {
        width: min(16.375rem, 100%);
    }

    @media (prefers-reduced-motion: no-preference) {
        .chat-new-popover {
            animation: chat-new-pop 140ms cubic-bezier(0.2, 0, 0, 1);
            transform-origin: bottom right;
        }

        :global([dir="rtl"]) .chat-new-popover {
            transform-origin: bottom left;
        }

        .chat-new-trigger :global(.chat-new-plus) {
            transition: transform 160ms ease-out;
        }

        .chat-new-trigger.is-open :global(.chat-new-plus) {
            transform: rotate(45deg);
        }
    }

    @keyframes chat-new-pop {
        from {
            opacity: 0;
            transform: translateY(4px) scale(0.97);
        }
        to {
            opacity: 1;
            transform: none;
        }
    }
</style>
