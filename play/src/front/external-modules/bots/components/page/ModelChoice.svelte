<script lang="ts">
    // One model in the radio list: its name, what the provider says is different about it, and the radio.
    import LL from "../../../../../i18n/i18n-svelte";
    import type { KeyModelOption } from "../../types";
    import type { Fact } from "../../modelPickerModel";
    import { IconAlertTriangle, IconEye, IconTool } from "@wa-icons";

    export let entry: KeyModelOption;
    /** What is different about this model: the facts it shows (what the list says once is left out) */
    export let facts: Fact[] = [];
    export let noTools = false;
    /** What is shown as its name (the list drops a maker's name from its models) */
    export let name: string;
    export let picked: boolean;
    export let onPick: (id: string) => void;
</script>

<button
    type="button"
    role="radio"
    class="mc"
    class:picked
    aria-checked={picked}
    data-testid="bot-model-{entry.id}"
    on:click={() => onPick(entry.id)}
>
    <span class="mc-t">
        <span class="mc-id">{name}</span>
        {#if facts.length > 0 || noTools}
            <span class="mc-tags">
                {#if facts.includes("tools")}
                    <span class="mc-tag"
                        ><IconTool font-size="14" />{$LL.mapEditor.edit.bots.page.mind.model.tools()}</span
                    >
                {/if}
                {#if facts.includes("vision")}
                    <span class="mc-tag"
                        ><IconEye font-size="14" />{$LL.mapEditor.edit.bots.page.mind.seesPictures()}</span
                    >
                {/if}
                {#if noTools}
                    <span class="mc-tag warn"
                        ><IconAlertTriangle font-size="14" />{$LL.mapEditor.edit.bots.page.mind.model.noTools()}</span
                    >
                {/if}
            </span>
        {/if}
    </span>
    <span class="mc-radio" class:on={picked} aria-hidden="true" />
</button>

<style>
    .mc {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 44px;
        margin: 0;
        padding: 8px 12px;
        border: 0;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
        font: inherit;
        color: #fff;
        text-align: left;
        cursor: pointer;
    }
    .mc.picked {
        background: rgba(134, 41, 252, 0.16);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.7);
    }
    .mc:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .mc-t {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }
    .mc-id {
        font-size: 15px;
        font-weight: 650;
        overflow-wrap: anywhere;
    }
    .mc-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
    }
    .mc-tag {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12.5px;
        font-weight: 600;
        color: rgba(244, 242, 250, 0.64);
    }
    .mc-tag.warn {
        color: #f5c451;
    }
    .mc-radio {
        flex: none;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.35);
    }
    .mc-radio.on {
        background: radial-gradient(circle, #fff 0 4px, #6d4aff 5px);
        box-shadow: none;
    }
</style>
