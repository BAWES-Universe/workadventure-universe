<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import type { ExtensionModuleAreaPropertyData } from "@workadventure/map-editor";
    import { IconMap } from "../../Components/Icons";
    import PropertyEditorBase from "../../Components/MapEditor/PropertyEditor/PropertyEditorBase.svelte";
    import Input from "../../Components/Input/Input.svelte";

    export let property: ExtensionModuleAreaPropertyData;

    const dispatch = createEventDispatcher<{
        change: undefined;
        close: undefined;
    }>();

    // Extract teleport data from property and create bindable variables
    type TeleportData = {
        universe?: string;
        world?: string;
        room?: string;
        startArea?: string;
    };

    const initialData = (property.data as TeleportData) || {};
    let universe = initialData.universe || "";
    let world = initialData.world || "";
    let room = initialData.room || "";
    let startArea = initialData.startArea || "";

    function onValueChange() {
        // Update property data
        property.data = {
            universe: universe.trim(),
            world: world.trim(),
            room: room.trim(),
            startArea: startArea.trim(),
        };
        dispatch("change");
    }

    // Computed URL preview
    $: previewUrl = (() => {
        if (!universe.trim() || !world.trim() || !room.trim()) {
            return "";
        }
        let url = `@/${universe.trim()}/${world.trim()}/${room.trim()}`;
        if (startArea.trim() !== "") {
            url += `#${startArea.trim()}`;
        }
        return url;
    })();

    // Validation
    $: isValid = !!(universe.trim() && world.trim() && room.trim());
</script>

<PropertyEditorBase
    on:close={() => {
        dispatch("close");
    }}
>
    <span slot="header" class="flex justify-center items-center">
        <IconMap font-size="18" class="mr-2" />
        Teleport
    </span>
    <span slot="content">
        <div class="space-y-4">
            <Input
                id="teleport-universe"
                label="Universe"
                type="text"
                placeholder="e.g., bawes-univ"
                bind:value={universe}
                required={true}
                on:input={onValueChange}
                on:blur={onValueChange}
            />
            <Input
                id="teleport-world"
                label="World"
                type="text"
                placeholder="e.g., bawes-world"
                bind:value={world}
                required={true}
                on:input={onValueChange}
                on:blur={onValueChange}
            />
            <Input
                id="teleport-room"
                label="Room"
                type="text"
                placeholder="e.g., headquarters"
                bind:value={room}
                required={true}
                on:input={onValueChange}
                on:blur={onValueChange}
            />
            <Input
                id="teleport-start-area"
                label="Start Area (optional)"
                type="text"
                placeholder="e.g., startSpawnArea"
                bind:value={startArea}
                on:input={onValueChange}
                on:blur={onValueChange}
            />
            {#if previewUrl}
                <div class="mt-4 p-2 bg-gray-100 dark:bg-gray-800 rounded text-sm">
                    <div class="text-gray-600 dark:text-gray-400 mb-1">Preview URL:</div>
                    <div class="font-mono text-blue-600 dark:text-blue-400">{previewUrl}</div>
                </div>
            {/if}
            {#if !isValid}
                <div class="mt-2 text-sm text-amber-600 dark:text-amber-400">
                    Universe, World, and Room are required fields.
                </div>
            {/if}
        </div>
    </span>
</PropertyEditorBase>
