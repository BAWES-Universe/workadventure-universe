<script lang="ts">
    import { onDestroy } from "svelte";
    import type { ComponentType } from "svelte";
    import { autoUpdate } from "@floating-ui/dom";
    import RoomOption from "../Room/RoomMenu/RoomOption.svelte";
    import PersonActionButton from "./PersonActionButton.svelte";
    import { placePersonMenu } from "./PersonMenuPlacement";
    import { openPersonMenuStore } from "./PersonMenuStore";
    import { IconDots } from "@wa-icons";

    /** One entry of a friends "more" (⋮) menu. Harsh ones (Block, Remove) are red. */
    interface MenuItem {
        key: string;
        label: string;
        icon: ComponentType;
        danger?: boolean;
        disabled?: boolean;
        act: () => void;
    }

    export let label: string;
    export let items: MenuItem[];
    export let testId: string | undefined = undefined;

    let open = false;
    let buttonElement: HTMLButtonElement | undefined;
    let menuElement: HTMLDivElement | undefined;
    let cleanup: (() => void) | undefined;
    // Opening this menu closes any other person's: only one is ever open.
    const menuId = `friend-menu-${Math.random().toString(36).slice(2, 9)}`;
    $: if (open && $openPersonMenuStore !== menuId) open = false;

    $: if (open && menuElement && buttonElement) {
        cleanup?.();
        cleanup = autoUpdate(buttonElement, menuElement, position);
    } else if (!open && cleanup) {
        cleanup();
        cleanup = undefined;
    }

    function position() {
        if (!buttonElement || !menuElement) return;
        placePersonMenu(buttonElement, menuElement);
    }

    function toggle() {
        open = !open;
        if (open) openPersonMenuStore.set(menuId);
        else if ($openPersonMenuStore === menuId) openPersonMenuStore.set(undefined);
    }

    function close() {
        open = false;
        if ($openPersonMenuStore === menuId) openPersonMenuStore.set(undefined);
    }

    function choose(item: MenuItem) {
        if (item.disabled) return;
        close();
        item.act();
    }

    function onOutside(event: MouseEvent | TouchEvent) {
        if (!open) return;
        const target = event.target as Node | null;
        if (target && !menuElement?.contains(target) && !buttonElement?.contains(target)) close();
    }

    onDestroy(() => {
        cleanup?.();
        if ($openPersonMenuStore === menuId) openPersonMenuStore.set(undefined);
    });
</script>

<svelte:window on:click={onOutside} on:touchstart={onOutside} />
<div class="wa-dropdown">
    <PersonActionButton {label} {testId} expanded={open} hasPopup bind:buttonElement on:click={toggle}>
        <IconDots font-size="18" />
    </PersonActionButton>
    {#if open}
        <div
            bind:this={menuElement}
            role="menu"
            class="wa-dropdown-menu u-surface fixed z-40 w-max min-w-48 rounded-2xl p-1"
        >
            {#each items as item, index (item.key)}
                {#if item.danger && index > 0 && !items[index - 1].danger}
                    <div class="u-menu-divider" />
                {/if}
                <RoomOption
                    role="menuitem"
                    IconComponent={item.icon}
                    title={item.label}
                    dataTestId={`friend-menu-${item.key}`}
                    bg={item.danger ? "u-danger" : item.disabled ? "opacity-50" : ""}
                    disabled={item.disabled}
                    on:click={() => choose(item)}
                />
            {/each}
        </div>
    {/if}
</div>
