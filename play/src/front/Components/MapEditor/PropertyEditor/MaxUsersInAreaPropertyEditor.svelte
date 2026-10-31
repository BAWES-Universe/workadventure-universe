<script lang="ts">
    import type { MaxUsersInAreaPropertyData } from "@workadventure/map-editor";
    import { createEventDispatcher } from "svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import PropertyEditorBase from "./PropertyEditorBase.svelte";
    import { IconInfoCircle, IconUsers } from "@wa-icons";

    export let property: MaxUsersInAreaPropertyData;

    const dispatch = createEventDispatcher<{
        change: undefined;
        close: undefined;
    }>();

    // Empty means no limit. Anything else is a whole number of 1 or more: 0 would close the room, which "Who can
    // enter" already does.
    // A number field: Svelte gives a number, or null while it is empty.
    let value: number | null = property.maxUsers && property.maxUsers >= 1 ? property.maxUsers : null;

    function onValueChange() {
        if (value === null || !Number.isFinite(value)) {
            property.maxUsers = null;
            value = null;
        } else {
            property.maxUsers = Math.max(1, Math.floor(value));
            value = property.maxUsers;
        }
        dispatch("change");
    }
</script>

<PropertyEditorBase on:close={() => dispatch("close")}>
    <span slot="header" class="flex justify-center items-center">
        <IconUsers font-size="18" class="mr-2" />
        {$LL.mapEditor.edit.properties.maxUsersInAreaPropertyData.title()}
    </span>
    <span slot="content" class="op">
        <div class="op-field">
            <label for="maxUsersInArea" class="op-label">
                {$LL.mapEditor.properties.maxUsersInAreaPropertyData.label()}
            </label>
            <div class="u-join-field">
                <input
                    id="maxUsersInArea"
                    data-testid="maxUsersInArea"
                    type="number"
                    inputmode="numeric"
                    min="1"
                    step="1"
                    placeholder={$LL.mapEditor.properties.maxUsersInAreaPropertyData.placeholder()}
                    bind:value
                    on:change={onValueChange}
                />
            </div>
        </div>
        <p class="op-hint" data-testid="max-users-help">
            <IconInfoCircle font-size="16" class="shrink-0" />
            <span>{$LL.mapEditor.properties.maxUsersInAreaPropertyData.help()}</span>
        </p>
    </span>
</PropertyEditorBase>

<style lang="scss">
    .op {
        display: flex;
        flex-direction: column;
        gap: 14px;
        min-width: 0;
    }
    .op-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
    }
    .op-label {
        padding-inline-start: 2px;
        font-size: 0.8125rem;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.72);
    }
    .op-hint {
        display: flex;
        gap: 8px;
        margin: 0;
        padding-inline-start: 2px;
        font-size: 0.8125rem;
        line-height: 1.45;
        color: rgba(255, 255, 255, 0.6);
    }
</style>
