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
        url?: string;
        startArea?: string;
    };

    // Initialize property.data if it doesn't exist
    if (!property.data) {
        property.data = {};
    }

    // Get teleport data with defaults
    function getData(): TeleportData {
        return (property.data as TeleportData) || {};
    }

    // Create bindable variables - initialize from property.data
    const data = getData();
    let url = data.url || "";
    let startArea = data.startArea || "";

    function onValueChange() {
        // Update property.data - create new object to ensure reactivity
        property.data = {
            url: url.trim(),
            startArea: startArea.trim(),
        };
        dispatch("change");
    }

    // Extract universe, world, room from URL
    function extractPathFromUrl(urlString: string): { universe: string; world: string; room: string } | null {
        try {
            const url = new URL(urlString);
            // Match pattern: /@/universe/world/room
            const match = url.pathname.match(/^\/@\/([^/]+)\/([^/]+)\/([^/]+)$/);
            if (match) {
                return {
                    universe: match[1],
                    world: match[2],
                    room: match[3],
                };
            }
        } catch {
            // Invalid URL format
        }
        return null;
    }

    // Computed extracted path components
    $: extractedPath = url.trim() ? extractPathFromUrl(url.trim()) : null;

    // Validation - check if URL is provided
    $: isValid = !!url.trim();
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
                id="teleport-url"
                label="Teleport URL"
                type="url"
                placeholder="https://universe.bawes.net/@/universe/world/room"
                bind:value={url}
                required={true}
                onBlur={onValueChange}
                onChange={onValueChange}
            />
            {#if extractedPath}
                <div
                    class="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-sm border border-blue-200 dark:border-blue-800"
                >
                    <div class="text-gray-700 dark:text-gray-300 mb-2 font-semibold">People will be teleported to:</div>
                    <div class="space-y-1 text-sm">
                        <div class="flex items-center gap-2">
                            <span class="text-gray-600 dark:text-gray-400 w-20">Universe:</span>
                            <span class="font-mono text-blue-600 dark:text-blue-400">{extractedPath.universe}</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="text-gray-600 dark:text-gray-400 w-20">World:</span>
                            <span class="font-mono text-blue-600 dark:text-blue-400">{extractedPath.world}</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="text-gray-600 dark:text-gray-400 w-20">Room:</span>
                            <span class="font-mono text-blue-600 dark:text-blue-400">{extractedPath.room}</span>
                        </div>
                    </div>
                </div>
            {/if}
            <Input
                id="teleport-start-area"
                label="Start Area (optional)"
                type="text"
                placeholder="e.g., startSpawnArea"
                bind:value={startArea}
                onBlur={onValueChange}
                onChange={onValueChange}
            />
            {#if !isValid}
                <div class="mt-2 text-sm text-amber-600 dark:text-amber-400">Teleport URL is required.</div>
            {/if}
        </div>
    </span>
</PropertyEditorBase>
