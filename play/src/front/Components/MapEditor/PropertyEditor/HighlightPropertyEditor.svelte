<script lang="ts">
    import type { HighlightPropertyData } from "@workadventure/map-editor";
    import { createEventDispatcher } from "svelte";
    import { LL } from "../../../../i18n/i18n-svelte";
    import RangeSlider from "../../Input/RangeSlider.svelte";
    import { IconFocus } from "../../Icons";
    import PropertyEditorBase from "./PropertyEditorBase.svelte";

    export let property: HighlightPropertyData;

    const dispatch = createEventDispatcher<{
        change: undefined;
        close: undefined;
    }>();

    function onValueChange() {
        dispatch("change");
    }

    $: isBlack = (property.color ?? "#000000").toLowerCase() === "#000000";

    function resetColour() {
        property.color = "#000000";
        onValueChange();
    }
</script>

<PropertyEditorBase
    on:close={() => {
        dispatch("close");
    }}
>
    <span slot="header" class="flex justify-center items-center">
        <IconFocus font-size="18" class="mr-2" />
        {$LL.mapEditor.properties.highlight.label()}
    </span>
    <span slot="content">
        <RangeSlider
            label={$LL.mapEditor.properties.highlight.opacityLabel()}
            min={0}
            max={1}
            step={0.01}
            valueFormatter={(v) => (v * 100).toFixed(0)}
            placeholder="0.6"
            bind:value={property.opacity}
            onChange={onValueChange}
            variant="secondary"
            buttonShape="square"
        />
        <RangeSlider
            label={$LL.mapEditor.properties.highlight.gradientWidthLabel()}
            min={0}
            max={100}
            step={1}
            placeholder="10"
            bind:value={property.gradientWidth}
            onChange={onValueChange}
            variant="secondary"
            buttonShape="square"
            unit="px"
        />
        <RangeSlider
            label={$LL.mapEditor.properties.highlight.durationLabel()}
            min={0}
            max={2000}
            step={1}
            placeholder="250"
            bind:value={property.duration}
            onChange={onValueChange}
            variant="secondary"
            buttonShape="square"
            unit="ms"
        />
        <!-- The colour as the game's field: the swatch and its name, so a colour other than the usual black is
             plain to see, with a way back to black. Tapping the swatch opens the colour picker, as before. -->
        <div class="hl-colour">
            <span class="hl-label">{$LL.mapEditor.properties.highlight.colorLabel()}</span>
            <label class="u-join-field hl-field">
                <span class="hl-swatch" style="background: {property.color}" />
                <input
                    class="hl-input"
                    type="color"
                    aria-label={$LL.mapEditor.properties.highlight.colorLabel()}
                    data-testid="highlightColor"
                    bind:value={property.color}
                    on:input={onValueChange}
                />
                <span class="hl-value"
                    >{isBlack ? $LL.mapEditor.properties.highlight.black() : property.color.toUpperCase()}</span
                >
            </label>
            {#if !isBlack}
                <button
                    type="button"
                    class="u-cta-secondary hl-reset h-11 m-0 px-4 rounded-full text-sm font-bold"
                    on:click={resetColour}>{$LL.mapEditor.properties.highlight.resetToBlack()}</button
                >
            {/if}
        </div>
    </span>
</PropertyEditorBase>

<style>
    .hl-colour {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 0 12px;
    }
    .hl-label {
        font-size: 14px;
        color: #fff;
    }
    .hl-field {
        position: relative;
        cursor: pointer;
    }
    .hl-swatch {
        flex: none;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
    }
    /* The browser's own colour box, invisible over the whole field: a tap anywhere opens the picker. */
    .hl-input {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        cursor: pointer;
    }
    .hl-value {
        font-size: 15px;
    }
    .hl-reset {
        align-self: flex-start;
    }
</style>
