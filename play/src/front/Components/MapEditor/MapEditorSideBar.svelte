<script lang="ts">
    import type { ComponentType } from "svelte";
    import type { LocalizedString } from "typesafe-i18n";
    import { LL } from "../../../i18n/i18n-svelte";
    import type { TranslationFunctions } from "../../../i18n/i18n-types";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { EditorToolName } from "../../Phaser/Game/MapEditor/MapEditorModeManager";
    import { mapEditorSelectedToolStore, mapEditorVisibilityStore } from "../../Stores/MapEditorStore";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { mapEditorIsMobileLayoutStore, mapEditorToolsStore } from "./MapEditorTools";
    import { IconX, IconTexture, IconLamp, IconMapSearch, IconSettings, IconTrash } from "@wa-icons";

    const toolIcons: Partial<Record<EditorToolName, ComponentType>> = {
        [EditorToolName.ExploreTheRoom]: IconMapSearch,
        [EditorToolName.AreaEditor]: IconTexture,
        [EditorToolName.EntityEditor]: IconLamp,
        [EditorToolName.WAMSettingsEditor]: IconSettings,
        [EditorToolName.TrashEditor]: IconTrash,
    };

    // Takes the translations as an argument so the reactive block below re-runs when the locale changes.
    function toolTooltip(ll: TranslationFunctions, toolName: EditorToolName): LocalizedString {
        switch (toolName) {
            case EditorToolName.AreaEditor:
                return ll.mapEditor.sideBar.areaEditor();
            case EditorToolName.EntityEditor:
                return ll.mapEditor.sideBar.entityEditor();
            case EditorToolName.WAMSettingsEditor:
                return ll.mapEditor.sideBar.configureMyRoom();
            case EditorToolName.TrashEditor:
                return ll.mapEditor.sideBar.trashEditor();
            default:
                return ll.mapEditor.sideBar.exploreTheRoom();
        }
    }

    // Built from permissions only; screen size decides layout, not which tools exist.
    $: availableTools = $mapEditorToolsStore.map((tool) => ({
        ...tool,
        iconComponent: toolIcons[tool.toolName],
        tooltiptext: toolTooltip($LL, tool.toolName),
        showDesktopHint: tool.worksBestOnDesktop && $mapEditorIsMobileLayoutStore,
    }));

    function switchTool(newTool: EditorToolName) {
        // The map sidebar is opened when the user clicks on the explorer for the first time.
        // If the user clicks on the Explorer again, we need to show the map sidebar.
        if (newTool === EditorToolName.ExploreTheRoom) {
            mapEditorVisibilityStore.set(!$mapEditorVisibilityStore);
        } else {
            mapEditorVisibilityStore.set(true);
        }
        analyticsClient.openMapEditorTool(newTool);
        gameManager.getCurrentGameScene().getMapEditorModeManager().equipTool(newTool);
    }
</script>

<section class="side-bar-container z-[1999] pointer-events-auto" class:!right-20={!$mapEditorVisibilityStore}>
    <!--put a section to avoid lower div to be affected by some css-->
    <div class="flex flex-col items-center gap-4 pt-24 side-bar">
        <div class="close-window p-2 bg-contrast/80 rounded-2xl backdrop-blur-md">
            <button
                class="p-3 hover:bg-white/10 rounded aspect-square w-12 m-0"
                data-testid="closeMapEditorButton"
                on:click|preventDefault={() => switchTool(EditorToolName.CloseMapEditor)}
            >
                <IconX font-size="20" />
            </button>
        </div>
        <div class="p-2 bg-contrast/80 rounded-2xl flex flex-col gap-2 backdrop-blur-md">
            {#each availableTools as tool (tool.toolName)}
                <div class="tool-button relative">
                    <button
                        class="peer relative p-3 aspect-square w-12 rounded {$mapEditorSelectedToolStore ===
                        tool.toolName
                            ? 'bg-secondary'
                            : 'hover:bg-white/10'}"
                        id={tool.toolName}
                        class:active={$mapEditorSelectedToolStore === tool.toolName}
                        on:click|preventDefault={() => switchTool(tool.toolName)}
                        type="button"
                    >
                        <svelte:component this={tool.iconComponent} font-size="22" />
                        {#if tool.showDesktopHint}
                            <span
                                class="absolute top-1.5 end-1.5 h-2 w-2 rounded-full bg-pop-yellow"
                                data-testid="worksBestOnDesktopBadge"
                                aria-hidden="true"
                            />
                        {/if}
                    </button>
                    <div
                        class=" bg-contrast/90 backdrop-blur-xl text-white tooltip absolute text-nowrap p-2 invisible opacity-0 transition-all peer-hover:visible peer-hover:opacity-100 rounded top-1/2 -translate-y-1/2 right-[130%]"
                    >
                        {tool.tooltiptext}
                        {#if tool.showDesktopHint}
                            <span class="block text-xs opacity-70">{$LL.mapEditor.sideBar.worksBestOnDesktop()}</span>
                        {/if}
                    </div>
                </div>
            {/each}
        </div>
    </div>
</section>
