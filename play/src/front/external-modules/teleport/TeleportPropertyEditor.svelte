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

    // Extract teleport data from property
    type TeleportData = {
        universe?: string;
        world?: string;
        room?: string;
        startArea?: string;
    };

    // Initialize property.data if it doesn't exist
    if (!property.data) {
        property.data = {};
    }

    // Get teleport data with defaults - similar to how ExitPropertyEditor accesses property.url
    function getData(): TeleportData {
        return (property.data as TeleportData) || {};
    }

    // Create bindable variables - initialize from property.data
    // Similar to ExitPropertyEditor which binds directly to property.url
    // We can't bind directly to property.data.universe (nested), so we use local variables
    // The component is keyed by property.id, so it will be recreated when property changes
    const data = getData();
    let universe = data.universe || "";
    let world = data.world || "";
    let room = data.room || "";
    let startArea = data.startArea || "";

    function onValueChange() {
        // Update property.data - create new object to ensure reactivity
        // Similar to how ExitPropertyEditor updates property.url directly
        property.data = {
            universe: universe.trim(),
            world: world.trim(),
            room: room.trim(),
            startArea: startArea.trim(),
        };
        dispatch("change");
    }

    // Computed URL preview - use local variables for reactivity
    $: previewUrl = (() => {
        if (!universe.trim() || !world.trim() || !room.trim()) {
            return "";
        }
        let url = `@/${universe.trim()}/${world.trim()}/${room.trim()}`;
        if (startArea.trim()) {
            url += `#${startArea.trim()}`;
        }
        return url;
    })();

    // Validation - use local variables for reactivity
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
                onBlur={onValueChange}
                onChange={onValueChange}
            />
            <Input
                id="teleport-world"
                label="World"
                type="text"
                placeholder="e.g., bawes-world"
                bind:value={world}
                required={true}
                onBlur={onValueChange}
                onChange={onValueChange}
            />
            <Input
                id="teleport-room"
                label="Room"
                type="text"
                placeholder="e.g., headquarters"
                bind:value={room}
                required={true}
                onBlur={onValueChange}
                onChange={onValueChange}
            />
            <Input
                id="teleport-start-area"
                label="Start Area (optional)"
                type="text"
                placeholder="e.g., startSpawnArea"
                bind:value={startArea}
                onBlur={onValueChange}
                onChange={onValueChange}
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
