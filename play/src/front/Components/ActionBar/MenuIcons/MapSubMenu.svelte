<script lang="ts">
    import { clickOutside } from "svelte-outside";
    import { getContext, setContext } from "svelte";
    import { mapMenuVisibleStore, openedMenuStore } from "../../../Stores/MenuStore";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { createFloatingUiActions } from "../../../Utils/svelte-floatingui";
    import MapSubMenuContent from "./MapSubMenuContent.svelte";
    import HeaderMenuItem from "./HeaderMenuItem.svelte";
    import { IconChevronDown, IconTools } from "@wa-icons";

    // The ActionBarButton component is displayed differently in the menu.
    // We use the context to decide how to render it.
    setContext("inMenu", true);

    const inProfileMenu = getContext("profileMenu");

    // Useless properties. They are here only to avoid a warning because we set the "first" or "classList" prop on all the right menu items
    // svelte-ignore unused-export-let
    export let first: boolean | undefined = undefined;
    // svelte-ignore unused-export-let
    export let classList: string | undefined = undefined;

    const [floatingUiRef, floatingUiContent, arrowAction] = createFloatingUiActions(
        {
            placement: "bottom-end",
            //strategy: 'fixed',
        },
        8
    );

    function closeMapMenu() {
        openedMenuStore.close("mapMenu");
    }
</script>

{#if $mapMenuVisibleStore}
    {#if !inProfileMenu}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
            data-testid="map-menu"
            class="items-center relative cursor-pointer pointer-events-auto"
            use:floatingUiRef
            on:click|preventDefault={() => {
                openedMenuStore.toggle("mapMenu");
            }}
        >
            <div class="group u-surface-flat rounded-xl h-16 @sm/actions:h-14 @xl/actions:h-16 p-2">
                <!-- Open: the pressed grey, like every button whose menu or window is showing. -->
                <div
                    class="tools-pill flex items-center h-full rounded-full pl-4 pr-4 gap-2"
                    class:open={$openedMenuStore === "mapMenu"}
                >
                    <IconTools font-size="20" class="text-white" />
                    <div class="pr">
                        <div
                            class="font-bold text-white leading-3 whitespace-nowrap select-none text-base @sm/actions:text-sm @xl/actions:text-base"
                        >
                            {$LL.actionbar.map()}
                        </div>
                    </div>

                    <IconChevronDown
                        stroke={2}
                        class="h-4 w-4 aspect-square transition-all opacity-50 {$openedMenuStore === 'mapMenu'
                            ? 'rotate-180'
                            : ''}"
                        height="16px"
                        width="16px"
                    />
                </div>
            </div>
        </div>
        {#if $openedMenuStore === "mapMenu"}
            <div
                class="absolute u-surface rounded-2xl w-auto max-w-full text-white"
                data-testid="map-sub-menu"
                use:floatingUiContent
                use:clickOutside={closeMapMenu}
            >
                <div class="u-surface-arrow" use:arrowAction />
                <div class="p-1.5 m-0">
                    <MapSubMenuContent />
                </div>
            </div>
        {/if}
    {:else}
        <HeaderMenuItem label={$LL.actionbar.map()} />
        <MapSubMenuContent />
    {/if}
{/if}

<style>
    .tools-pill {
        transition: background-color 150ms ease;
    }
    @media (hover: hover) {
        .tools-pill:hover {
            background-color: rgba(255, 255, 255, 0.08);
        }
    }
    .tools-pill:active {
        background-color: rgba(255, 255, 255, 0.12);
    }
    .tools-pill.open {
        background-color: rgba(255, 255, 255, 0.14);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    }
</style>
