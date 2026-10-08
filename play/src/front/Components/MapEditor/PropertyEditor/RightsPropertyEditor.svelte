<script lang="ts">
    import type { RestrictedRightsPropertyData } from "@workadventure/map-editor";
    import { createEventDispatcher } from "svelte";
    import RolePicker from "../../Input/RolePicker.svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import type { InputTagOption } from "../../Input/InputTagOption";
    import { toTags } from "../../Input/InputTagOption";
    import PropertyEditorBase from "./PropertyEditorBase.svelte";
    import { IconInfoCircle, IconLockCog } from "@wa-icons";

    export let restrictedRightsPropertyData: RestrictedRightsPropertyData;

    let writeTags: InputTagOption[] | undefined = restrictedRightsPropertyData.writeTags.map((writeTag) => ({
        value: writeTag,
        label: writeTag,
        created: false,
    }));
    let readTags: InputTagOption[] | undefined = restrictedRightsPropertyData.readTags.map((readTag) => ({
        value: readTag,
        label: readTag,
        created: false,
    }));

    function onChangeWriteReadTags() {
        restrictedRightsPropertyData.readTags = readTags ? toTags(readTags) : [];
        restrictedRightsPropertyData.writeTags = writeTags ? toTags(writeTags) : [];
        dispatch("change");
    }

    const dispatch = createEventDispatcher<{
        change: undefined;
        close: undefined;
    }>();
</script>

<PropertyEditorBase
    on:close={() => {
        dispatch("close");
    }}
>
    <span slot="header" class="flex justify-center items-center">
        <IconLockCog class="w-6 mr-1" />
        {$LL.mapEditor.properties.restrictedRightsPropertyData.label()}
    </span>
    <span slot="content" class="flex flex-col gap-5">
        <RolePicker
            label={$LL.mapEditor.properties.restrictedRightsPropertyData.rightWriteTitle()}
            emptyText={$LL.mapEditor.properties.rolePicker.everyoneEdit()}
            bind:value={writeTags}
            handleChange={onChangeWriteReadTags}
            testId="writeTags"
        >
            <span slot="info">
                <IconInfoCircle font-size="15" />
                {$LL.mapEditor.properties.restrictedRightsPropertyData.rightWriteDescription()}
            </span>
        </RolePicker>

        <RolePicker
            label={$LL.mapEditor.properties.restrictedRightsPropertyData.rightReadTitle()}
            emptyText={$LL.mapEditor.properties.rolePicker.everyoneCome()}
            bind:value={readTags}
            handleChange={onChangeWriteReadTags}
            testId="readTags"
        >
            <span slot="info">
                <IconInfoCircle font-size="15" />
                {$LL.mapEditor.properties.restrictedRightsPropertyData.rightReadDescription()}
            </span></RolePicker
        >
    </span>
</PropertyEditorBase>
