<script lang="ts">
    import type { LockableAreaPropertyData } from "@workadventure/map-editor";
    import { createEventDispatcher } from "svelte";
    import RolePicker from "../../Input/RolePicker.svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import type { InputTagOption } from "../../Input/InputTagOption";
    import { toTags } from "../../Input/InputTagOption";
    import PropertyEditorBase from "./PropertyEditorBase.svelte";
    import { IconInfoCircle, IconLock } from "@wa-icons";

    export let property: LockableAreaPropertyData;

    const dispatch = createEventDispatcher<{
        change: undefined;
        close: undefined;
    }>();

    let tags: InputTagOption[] | undefined = (property.allowedTags ?? []).map((tag) => ({
        value: tag,
        label: tag,
        created: false,
    }));

    function onChange() {
        property.allowedTags = tags ? toTags(tags) : [];
        dispatch("change");
    }
</script>

<PropertyEditorBase on:close={() => dispatch("close")}>
    <span slot="header" class="flex justify-center items-center">
        <IconLock font-size="18" class="mr-2" />
        {$LL.mapEditor.edit.properties.lockableAreaPropertyData.title()}
    </span>
    <span slot="content" class="op">
        <RolePicker
            label={$LL.mapEditor.properties.lockableAreaPropertyData.label()}
            emptyText={$LL.mapEditor.properties.lockableAreaPropertyData.empty()}
            bind:value={tags}
            handleChange={onChange}
            testId="lockTags"
        >
            <span slot="info">
                <IconInfoCircle font-size="15" />
                {$LL.mapEditor.properties.lockableAreaPropertyData.insideOnly()}
            </span>
        </RolePicker>
        <p class="op-hint" data-testid="lock-help">
            <IconInfoCircle font-size="16" class="shrink-0" />
            <span>{$LL.mapEditor.properties.lockableAreaPropertyData.help()}</span>
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
