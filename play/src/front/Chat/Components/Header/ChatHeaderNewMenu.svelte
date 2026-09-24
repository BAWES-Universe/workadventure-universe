<script lang="ts">
    import { onMount, tick } from "svelte";
    import type { ComponentType } from "svelte";
    import { openModal } from "svelte-modals";
    import LL from "../../../../i18n/i18n-svelte";
    import { navChat } from "../../Stores/ChatStore";
    import CreateRoomModal from "../Room/CreateRoomModal.svelte";
    import CreateFolderModal from "../Room/CreateFolderModal.svelte";
    import type { NewChatOption } from "./ChatHeaderNewMenu";
    import { focusChatSearchRequest, nextMenuIndex } from "./ChatHeaderNewMenu";
    import { IconFolder, IconMessagePlus, IconPlus, IconSend } from "@wa-icons";

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
        newRoom: "openCreateRoomModalButton",
        newFolder: "openCreateFolderModalButton",
    };
    const icons: Record<NewChatOption, ComponentType> = {
        newMessage: IconSend,
        newRoom: IconMessagePlus,
        newFolder: IconFolder,
    };

    function label(option: NewChatOption): string {
        switch (option) {
            case "newMessage":
                return $LL.chat.header.newMessage();
            case "newRoom":
                return $LL.chat.header.newRoom();
            case "newFolder":
                return $LL.chat.header.newFolder();
        }
    }

    function hint(option: NewChatOption): string {
        switch (option) {
            case "newMessage":
                return $LL.chat.header.newMessageHint();
            case "newRoom":
                return $LL.chat.header.newRoomHint();
            case "newFolder":
                return $LL.chat.header.newFolderHint();
        }
    }

    async function openMenu(focusIndex: number) {
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
                focusChatSearchRequest.set(true);
                navChat.switchToUserList();
                break;
            case "newRoom":
                openModal(CreateRoomModal, { parentID: undefined });
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

<div class="chat-new-menu" bind:this={containerRef}>
    <button
        type="button"
        bind:this={triggerRef}
        data-testid="openOptionToCreateRoomOrFolder"
        class="chat-new-trigger m-0 p-0 h-11 w-11 shrink-0 rounded-full flex items-center justify-center text-white bg-gradient-to-br from-primary to-secondary shadow-md hover:brightness-110 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
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
            class="chat-new-popover focus:outline-none absolute top-full end-2 mt-1 z-50 p-1.5 rounded-2xl bg-contrast/90 backdrop-blur-xl border border-solid border-white/10 shadow-2xl"
            on:keydown={onMenuKeyDown}
        >
            {#each options as option, index (option)}
                <button
                    type="button"
                    role="menuitem"
                    tabindex="-1"
                    bind:this={itemRefs[index]}
                    data-testid={testIds[option]}
                    class="chat-new-item m-0 w-full min-h-14 flex items-center gap-3 px-2 py-2 rounded-xl text-start text-white bg-transparent hover:bg-white/10 focus:outline-none focus-visible:bg-white/10"
                    on:click={() => choose(option)}
                >
                    <span
                        class="h-10 w-10 shrink-0 rounded-xl bg-gradient-to-br from-primary to-secondary text-white flex items-center justify-center"
                        aria-hidden="true"
                    >
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
    .chat-new-popover {
        width: min(18rem, calc(100% - 1rem));
    }

    @media (prefers-reduced-motion: no-preference) {
        .chat-new-popover {
            animation: chat-new-pop 140ms cubic-bezier(0.2, 0, 0, 1);
            transform-origin: top right;
        }

        :global([dir="rtl"]) .chat-new-popover {
            transform-origin: top left;
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
            transform: translateY(-4px) scale(0.97);
        }
        to {
            opacity: 1;
            transform: none;
        }
    }
</style>
