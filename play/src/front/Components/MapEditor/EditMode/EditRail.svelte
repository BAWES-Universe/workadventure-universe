<script lang="ts">
    // The tools on the right edge: round buttons with names in an ink pill, like the zoom column. The open one is grey.
    // The e2e tests find the buttons as "section.side-bar-container .side-bar .tool-button button#<ToolName>".
    import { LL } from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { EditorToolName } from "../../../Phaser/Game/MapEditor/MapEditorModeManager";
    import { mapEditorSelectedToolStore, mapEditorVisibilityStore } from "../../../Stores/MapEditorStore";
    import { mapEditorActivated, mapEditorActivatedForThematics } from "../../../Stores/MenuStore";
    import { editHintSeenStore, editToolsStore } from "../../../Stores/EditModeStore";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import { IconLamp, IconTexture, IconTrash } from "@wa-icons";

    $: canEditAreas = $mapEditorActivated;
    $: canEditObjects = $mapEditorActivated || $mapEditorActivatedForThematics;

    function pick(tool: EditorToolName) {
        editHintSeenStore.set(true);
        analyticsClient.openMapEditorTool(tool);
        mapEditorVisibilityStore.set(true);
        gameManager.getCurrentGameScene().getMapEditorModeManager().equipTool(tool);
    }

    function pickExternal(onSelect: () => void) {
        editHintSeenStore.set(true);
        onSelect();
    }
</script>

<section class="side-bar-container em-rail u-surface pointer-events-auto" data-testid="edit-rail">
    <div class="side-bar em-rail-items">
        {#if canEditObjects}
            <div class="tool-button em-it" class:on={$mapEditorSelectedToolStore === EditorToolName.EntityEditor}>
                <button
                    type="button"
                    id={EditorToolName.EntityEditor}
                    class="em-circ"
                    aria-pressed={$mapEditorSelectedToolStore === EditorToolName.EntityEditor}
                    on:click|preventDefault={() => pick(EditorToolName.EntityEditor)}
                >
                    <IconLamp font-size="22" />
                </button>
                <span>{$LL.mapEditor.edit.tools.objects()}</span>
            </div>
        {/if}
        {#if canEditAreas}
            <div class="tool-button em-it" class:on={$mapEditorSelectedToolStore === EditorToolName.AreaEditor}>
                <button
                    type="button"
                    id={EditorToolName.AreaEditor}
                    class="em-circ"
                    aria-pressed={$mapEditorSelectedToolStore === EditorToolName.AreaEditor}
                    on:click|preventDefault={() => pick(EditorToolName.AreaEditor)}
                >
                    <IconTexture font-size="22" />
                </button>
                <span>{$LL.mapEditor.edit.tools.areas()}</span>
            </div>
        {/if}
        {#each $editToolsStore as tool (tool.id)}
            <div class="tool-button em-it" class:on={$mapEditorSelectedToolStore === tool.id}>
                <button
                    type="button"
                    id={tool.id}
                    class="em-circ"
                    aria-pressed={$mapEditorSelectedToolStore === tool.id}
                    on:click|preventDefault={() => pickExternal(tool.onSelect)}
                >
                    <svelte:component this={tool.icon} font-size="22" />
                </button>
                <span>{tool.label}</span>
            </div>
        {/each}
        {#if canEditObjects}
            <div class="tool-button em-it em-del" class:on={$mapEditorSelectedToolStore === EditorToolName.TrashEditor}>
                <button
                    type="button"
                    id={EditorToolName.TrashEditor}
                    class="em-circ"
                    aria-pressed={$mapEditorSelectedToolStore === EditorToolName.TrashEditor}
                    on:click|preventDefault={() => pick(EditorToolName.TrashEditor)}
                >
                    <IconTrash font-size="22" />
                </button>
                <span>{$LL.mapEditor.edit.tools.delete()}</span>
            </div>
        {/if}
    </div>
</section>

<style>
    .em-rail {
        position: absolute;
        top: 64px;
        right: 14px;
        width: 62px;
        border-radius: 31px;
        padding: 8px 0;
        color: #fff;
        z-index: 3;
    }
    :global(.em-phone) .em-rail {
        top: calc(78px + env(safe-area-inset-top, 0px));
        right: 10px;
    }
    .em-rail-items {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
    }
    .em-it {
        width: 62px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        padding: 5px 0;
        font-size: 10.5px;
        font-weight: 600;
        line-height: 1.05;
        text-align: center;
        color: rgba(244, 242, 250, 0.64);
    }
    .em-it.on {
        color: #fff;
    }
    .em-it.em-del {
        color: #f7a48f;
    }
    .em-circ {
        display: grid;
        place-items: center;
        width: 46px;
        height: 46px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: transparent;
        color: inherit;
        cursor: pointer;
        transition: background-color 150ms ease;
        -webkit-tap-highlight-color: transparent;
    }
    @media (hover: hover) {
        .em-circ:hover {
            background: rgba(255, 255, 255, 0.08);
        }
    }
    .em-circ:active {
        background: rgba(255, 255, 255, 0.12);
    }
    .em-it.on .em-circ {
        background: rgba(255, 255, 255, 0.14);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    }
    .em-circ:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 2px;
    }
</style>
