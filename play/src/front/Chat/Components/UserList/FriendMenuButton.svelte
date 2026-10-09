<script lang="ts">
    import { onDestroy } from "svelte";
    import type { ComponentType } from "svelte";
    import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
    import PersonActionButton from "./PersonActionButton.svelte";
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
        const menu = menuElement;
        computePosition(buttonElement, menu, { middleware: [offset(6), flip(), shift({ padding: 5 })] })
            .then(({ x, y }) => Object.assign(menu.style, { left: `${x}px`, top: `${y}px` }))
            .catch((error) => console.error("Failed to place the friend menu", error));
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
            class="wa-dropdown-menu fixed z-40 mr-1 rounded-xl border border-white/10 bg-contrast/95 p-1 shadow-2xl backdrop-blur"
        >
            {#each items as item (item.key)}
                <button
                    type="button"
                    role="menuitem"
                    class="wa-dropdown-item m-0 flex min-h-10 w-full items-center gap-2 rounded border-0 bg-transparent px-3 text-start text-sm text-nowrap hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 {item.danger
                        ? 'text-pop-red'
                        : 'text-white'}"
                    disabled={item.disabled}
                    data-testid={`friend-menu-${item.key}`}
                    on:click|stopPropagation={() => choose(item)}
                >
                    <svelte:component this={item.icon} font-size="14" />
                    {item.label}
                </button>
            {/each}
        </div>
    {/if}
</div>
