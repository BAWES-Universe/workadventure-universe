<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";
    import type { ExtensionModuleAreaPropertyData } from "@workadventure/map-editor";
    import PropertyEditorBase from "../../Components/MapEditor/PropertyEditor/PropertyEditorBase.svelte";
    import { IconRoute } from "../../Components/Icons";

    export let property: ExtensionModuleAreaPropertyData;

    const dispatch = createEventDispatcher<{
        change: undefined;
        close: undefined;
    }>();

    type PortalData = {
        url?: string;
        startArea?: string;
    };

    // Initialize property.data if it doesn't exist
    if (!property.data) {
        property.data = {};
    }

    const data = (property.data as PortalData) || {};
    let url = data.url || "";
    let startArea = data.startArea || "";
    let urlInput: HTMLInputElement;

    // Just added: the cursor is already in the link field, as in the name field of a new area.
    onMount(() => {
        if (url === "") requestAnimationFrame(() => urlInput?.focus());
    });

    function onValueChange() {
        // A new object, so the change is seen.
        property.data = {
            url: url.trim(),
            startArea: startArea.trim(),
        };
        dispatch("change");
    }

    // The room a link goes to: /@/universe/world/room, absolute or relative to this page.
    function destinationOf(link: string): { universe: string; world: string; room: string } | null {
        try {
            const parsed = new URL(link, window.location.origin);
            const match = parsed.pathname.match(/^\/@\/([^/]+)\/([^/]+)\/([^/]+)$/);
            if (match) return { universe: match[1], world: match[2], room: match[3] };
        } catch {
            // Not a link yet.
        }
        return null;
    }

    $: destination = url.trim() ? destinationOf(url.trim()) : null;
</script>

<PropertyEditorBase
    on:close={() => {
        dispatch("close");
    }}
>
    <span slot="header" class="flex justify-center items-center">
        <IconRoute font-size="18" class="mr-2" />
        Portal to any room
    </span>
    <span slot="content">
        <div class="pt">
            <div class="pt-field">
                <label class="pt-label" for="portal-url">Room link</label>
                <div class="u-join-field">
                    <input
                        id="portal-url"
                        class="pt-input"
                        type="text"
                        inputmode="url"
                        autocomplete="off"
                        autocapitalize="off"
                        spellcheck="false"
                        placeholder="Paste a room link"
                        data-testid="portal-url"
                        bind:this={urlInput}
                        bind:value={url}
                        on:change={onValueChange}
                        on:blur={onValueChange}
                    />
                </div>
                {#if !destination}
                    <p class="pt-hint">
                        Open the room people should reach, a friend’s or your own, copy the link from the address bar
                        and paste it here. It can be in any universe.
                    </p>
                {/if}
            </div>

            {#if destination}
                <div class="pt-goes" data-testid="portal-destination">
                    <span class="pt-goes-title">Walking in takes people to</span>
                    <span class="pt-goes-row"><span>Universe</span><b>{destination.universe}</b></span>
                    <span class="pt-goes-row"><span>World</span><b>{destination.world}</b></span>
                    <span class="pt-goes-row"><span>Room</span><b>{destination.room}</b></span>
                </div>
            {/if}

            <div class="pt-field">
                <label class="pt-label" for="portal-start-area"
                    >Arrive at <span class="pt-optional">Optional</span></label
                >
                <div class="u-join-field">
                    <input
                        id="portal-start-area"
                        class="pt-input"
                        type="text"
                        autocomplete="off"
                        autocapitalize="off"
                        spellcheck="false"
                        placeholder="Name of a start point"
                        data-testid="portal-start-area"
                        bind:value={startArea}
                        on:change={onValueChange}
                        on:blur={onValueChange}
                    />
                </div>
                <p class="pt-hint">Leave it empty and people arrive where that room usually puts them.</p>
            </div>
        </div>
    </span>
</PropertyEditorBase>

<style>
    .pt {
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 4px 0 0;
    }
    .pt-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .pt-label {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
    }
    .pt-optional {
        padding: 1px 7px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: rgba(244, 242, 250, 0.68);
    }
    .pt-input {
        flex: 1;
        min-width: 0;
        height: 100%;
        padding: 0;
        border: 0;
        background: transparent;
        font: inherit;
        font-size: 15px;
        color: #fff;
        outline: none;
        box-shadow: none;
    }
    .pt-input::placeholder {
        color: rgba(244, 242, 250, 0.45);
    }
    .pt-hint {
        margin: 0;
        font-size: 12px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.68);
    }
    .pt-goes {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 10px 12px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
    }
    .pt-goes-title {
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #a78bfa;
    }
    .pt-goes-row {
        display: flex;
        gap: 10px;
        font-size: 14px;
        color: #fff;
    }
    .pt-goes-row span {
        width: 72px;
        flex: none;
        color: rgba(244, 242, 250, 0.68);
    }
    .pt-goes-row b {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        font-weight: 600;
    }
</style>
