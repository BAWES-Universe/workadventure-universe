<script lang="ts">
    // The Objects panel: search, categories, pictures with names, "Add your own", and the settings of an object you
    // tapped on the map. Picking an object starts placing it; on phones the panel steps aside while you place.
    import { onDestroy } from "svelte";
    import type { EntityPrefab } from "@workadventure/map-editor";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import type { EntityVariant } from "../../../Phaser/Game/MapEditor/Entities/EntityVariant";
    import { mobileLayoutStore } from "../../../Stores/MobileLayoutStore";
    import {
        mapEditorDeleteCustomEntityEventStore,
        mapEditorEntityModeStore,
        mapEditorModifyCustomEntityEventStore,
        mapEditorSelectedEntityPrefabStore,
        mapEditorSelectedEntityStore,
        mapEditorVisibilityStore,
        selectCategoryStore,
    } from "../../../Stores/MapEditorStore";
    import {
        editObjectsViewStore,
        editPickedVariantStore,
        editRecentObjectsStore,
    } from "../../../Stores/EditModeStore";
    import CustomEntityEditionForm from "../EntityEditor/CustomEntityEditionForm/CustomEntityEditionForm.svelte";
    import EntityPropertiesEditor from "../EntityEditor/EntityPropertiesEditor.svelte";
    import USelect from "../../UI/USelect.svelte";
    import PanelHeader from "./PanelHeader.svelte";
    import ObjectTile from "./ObjectTile.svelte";
    import UploadGuide from "./UploadGuide.svelte";
    import UploadVariants from "./UploadVariants.svelte";
    import { IconCloudUpload, IconPencil, IconRefresh, IconSearch } from "@wa-icons";

    const CUSTOM = "Custom";
    const PREVIEW_COUNT = 6;

    const entitiesCollectionsManager = gameManager.getCurrentGameScene().getEntitiesCollectionsManager();
    const variantsStore = entitiesCollectionsManager.getEntitiesPrefabsVariantStore();

    let searchTerm = "";
    let editingUpload = false;
    let editingVariants = false;

    $: view = $editObjectsViewStore;
    $: variants = $variantsStore;
    $: picked = $editPickedVariantStore;
    $: settingsOpen = $mapEditorEntityModeStore === "EDIT" && $mapEditorSelectedEntityStore !== undefined;

    // When the object on the map is deselected (Esc, a tap elsewhere), the panel goes back to the picker.
    $: if (!settingsOpen && view === "settings") editObjectsViewStore.set("pick");

    // Adding or removing a picture of an upload rebuilds its object; the pick follows the rebuilt one, keeping its
    // colour and side when they still exist, so Turn and the colour dots in the placing bar see the new pictures.
    $: if (picked) {
        const fresh = variants.find((variant) => variant.id === picked.variant.id);
        if (fresh && fresh !== picked.variant) {
            const color = fresh.colors.includes(picked.color) ? picked.color : fresh.defaultPrefab.color;
            const current = $mapEditorSelectedEntityPrefabStore;
            const sides = fresh.getEntityPrefabsPositions(color);
            editPickedVariantStore.set({ variant: fresh, color });
            if (current && !sides.some((side) => side.id === current.id)) {
                mapEditorSelectedEntityPrefabStore.set(
                    sides.find((side) => side.direction === current.direction) ?? sides[0]
                );
            }
        }
    }

    function label(tag: string): string {
        if (tag === CUSTOM) return $LL.mapEditor.edit.objects.yourUploads();
        return tag.charAt(0).toUpperCase() + tag.slice(1);
    }

    function byTag(all: EntityVariant[]): { tag: string; items: EntityVariant[] }[] {
        const groups = new Map<string, EntityVariant[]>();
        for (const variant of all) {
            // Your uploads show in the categories you gave them too, as they did in the old picker.
            // A prefab repeats a tag when the collection carries it too; one tile per section.
            for (const tag of new Set(variant.defaultPrefab.tags)) {
                const list = groups.get(tag) ?? [];
                list.push(variant);
                groups.set(tag, list);
            }
        }
        const sections = [...groups.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([tag, items]) => ({ tag, items }));
        const uploads = all.filter((variant) => variant.defaultPrefab.type === CUSTOM);
        if (uploads.length > 0) sections.push({ tag: CUSTOM, items: uploads });
        return sections;
    }

    function matches(variant: EntityVariant, term: string): boolean {
        const t = term.trim().toLowerCase();
        if (!t) return true;
        const prefab = variant.defaultPrefab;
        return prefab.name.toLowerCase().includes(t) || prefab.tags.join(",").toLowerCase().includes(t);
    }

    $: sections = byTag(variants);
    $: category = $selectCategoryStore;
    $: recent = $editRecentObjectsStore
        .map((id) => variants.find((variant) => variant.id === id))
        .filter((variant): variant is EntityVariant => variant !== undefined);
    $: searching = searchTerm.trim() !== "";
    $: searchResults = searching ? variants.filter((variant) => matches(variant, searchTerm)) : [];
    $: categoryOptions = [
        { value: "", label: $LL.mapEditor.edit.objects.allCategories() },
        ...sections.map((section) => ({
            value: section.tag,
            label: `${label(section.tag)} · ${section.items.length}`,
        })),
    ];
    $: categoryItems = category ? sections.find((section) => section.tag === category)?.items ?? [] : [];

    function pick(variant: EntityVariant) {
        const color = variant.defaultPrefab.color;
        const sides = variant.getEntityPrefabsPositions(color);
        const prefab: EntityPrefab = sides[0] ?? variant.defaultPrefab;
        editPickedVariantStore.set({ variant, color });
        mapEditorSelectedEntityStore.set(undefined);
        mapEditorEntityModeStore.set("ADD");
        mapEditorSelectedEntityPrefabStore.set(prefab);
        editingUpload = false;
        editingVariants = false;
        if ($mobileLayoutStore) mapEditorVisibilityStore.set(false);
    }

    function backFromSettings() {
        mapEditorSelectedEntityStore.set(undefined);
        mapEditorEntityModeStore.set("ADD");
        editObjectsViewStore.set("pick");
    }

    /** Every picture of an upload: its first one and the sides and colours added to it. */
    function picturesOf(id: string): string[] {
        const pictures = variants.find((variant) => variant.id === id)?.prefabs.map((prefab) => prefab.id) ?? [];
        return pictures.length > 0 ? pictures : [id];
    }

    function saveUploadChanges(customEntity: EntityPrefab) {
        // Name, category, blocking and depth belong to the whole object, so every picture gets them.
        for (const id of picturesOf(customEntity.id)) {
            mapEditorModifyCustomEntityEventStore.set({ ...customEntity, id });
        }
        editingUpload = false;
    }
    function removeUpload(id: string) {
        for (const picture of picturesOf(id)) {
            mapEditorDeleteCustomEntityEventStore.set({ id: picture });
        }
        editPickedVariantStore.set(undefined);
        mapEditorSelectedEntityPrefabStore.set(undefined);
        editingUpload = false;
    }

    const unsubscribePrefab = mapEditorSelectedEntityPrefabStore.subscribe((prefab) => {
        if (!prefab) editPickedVariantStore.set(undefined);
    });
    onDestroy(() => {
        unsubscribePrefab();
    });
</script>

{#if view === "upload"}
    <UploadGuide on:done={() => editObjectsViewStore.set("pick")} />
{:else if view === "settings" && settingsOpen}
    <PanelHeader
        title={$mapEditorSelectedEntityStore?.getPrefab().name ?? ""}
        subtitle={$LL.mapEditor.edit.objects.settingsSubtitle()}
        onBack={backFromSettings}
        backLabel={$LL.mapEditor.edit.areas.back()}
    />
    <div class="em-scroll em-props" data-testid="object-settings-page">
        <EntityPropertiesEditor />
    </div>
{:else if editingVariants && picked?.variant.defaultPrefab.type === CUSTOM}
    <UploadVariants variantId={picked.variant.id} color={picked.color} on:done={() => (editingVariants = false)} />
{:else if editingUpload && picked?.variant.defaultPrefab.type === CUSTOM}
    <PanelHeader
        title={picked.variant.defaultPrefab.name}
        subtitle={$LL.mapEditor.edit.objects.editUpload()}
        onBack={() => (editingUpload = false)}
        backLabel={$LL.mapEditor.edit.areas.back()}
    />
    <div class="em-scroll em-props">
        <CustomEntityEditionForm
            customEntity={picked.variant.defaultPrefab}
            on:closeForm={() => (editingUpload = false)}
            on:removeEntity={({ detail: { entityId } }) => removeUpload(entityId)}
            on:applyEntityModifications={({ detail }) => saveUploadChanges(detail)}
        />
    </div>
{:else}
    <PanelHeader
        title={$LL.mapEditor.edit.objects.title()}
        subtitle={$mobileLayoutStore
            ? $LL.mapEditor.edit.objects.subtitlePhone()
            : $LL.mapEditor.edit.objects.subtitleDesktop()}
        onBack={category ? () => selectCategoryStore.set(undefined) : undefined}
        backLabel={$LL.mapEditor.edit.areas.back()}
    />
    <label class="em-search">
        <IconSearch font-size="16" />
        <input
            type="search"
            bind:value={searchTerm}
            placeholder={$LL.mapEditor.edit.objects.search()}
            data-testid="objects-search"
        />
    </label>
    {#if !searching}
        <div class="em-cat" data-testid="objects-category">
            <USelect
                label={$LL.mapEditor.edit.objects.allCategories()}
                value={$selectCategoryStore ?? ""}
                options={categoryOptions}
                onSelect={(tag) => selectCategoryStore.set(tag || undefined)}
            />
        </div>
    {/if}
    {#if picked?.variant.defaultPrefab.type === CUSTOM}
        <div class="em-links">
            <button type="button" class="em-link" data-testid="editEntity" on:click={() => (editingUpload = true)}>
                <IconPencil font-size="14" />{$LL.mapEditor.edit.objects.editUpload()}
            </button>
            <button
                type="button"
                class="em-link"
                data-testid="uploadVariants"
                on:click={() => (editingVariants = true)}
            >
                <IconRefresh font-size="14" />{$LL.mapEditor.edit.objects.sidesAndColours()}
            </button>
        </div>
    {/if}
    <div class="em-scroll em-sections">
        {#if searching}
            {#if searchResults.length === 0}
                <p class="em-empty">{$LL.mapEditor.edit.objects.none()}</p>
            {:else}
                <div class="em-grid">
                    {#each searchResults as variant (variant.id)}
                        <ObjectTile {variant} active={picked?.variant.id === variant.id} onPick={pick} />
                    {/each}
                </div>
            {/if}
        {:else if category}
            <div class="em-grid">
                {#each categoryItems as variant (variant.id)}
                    <ObjectTile {variant} active={picked?.variant.id === variant.id} onPick={pick} />
                {/each}
            </div>
        {:else}
            {#if recent.length > 0}
                <div class="em-sech"><span>{$LL.mapEditor.edit.objects.recentlyUsed()}</span></div>
                <div class="em-grid">
                    {#each recent as variant (variant.id)}
                        <ObjectTile {variant} active={picked?.variant.id === variant.id} onPick={pick} />
                    {/each}
                </div>
            {/if}
            {#each sections as section (section.tag)}
                <div class="em-sech">
                    <span>{label(section.tag)}</span>
                    <b>{section.items.length}</b>
                    {#if section.items.length > PREVIEW_COUNT}
                        <button type="button" class="em-all" on:click={() => selectCategoryStore.set(section.tag)}
                            >{$LL.mapEditor.edit.objects.all()}</button
                        >
                    {/if}
                </div>
                <div class="em-grid">
                    {#each section.items.slice(0, PREVIEW_COUNT) as variant (variant.id)}
                        <ObjectTile {variant} active={picked?.variant.id === variant.id} onPick={pick} />
                    {/each}
                </div>
            {/each}
        {/if}
    </div>
    <button
        type="button"
        class="em-upload-btn"
        data-testid="objects-add-your-own"
        on:click={() => editObjectsViewStore.set("upload")}
    >
        <IconCloudUpload font-size="16" />{$LL.mapEditor.edit.objects.addYourOwn()}
    </button>
{/if}

<style>
    .em-search {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: none;
        height: 40px;
        padding: 0 14px;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.25);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        color: rgba(244, 242, 250, 0.5);
    }
    .em-search input {
        flex: 1;
        min-width: 0;
        border: 0;
        background: transparent;
        font: inherit;
        font-size: 14px;
        color: #fff;
        outline: none;
    }
    .em-search input::placeholder {
        color: rgba(244, 242, 250, 0.45);
    }
    .em-cat {
        flex: none;
    }
    .em-links {
        display: flex;
        flex-wrap: wrap;
        gap: 2px 16px;
        flex: none;
    }
    .em-link {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        align-self: flex-start;
        margin: 0;
        padding: 4px 0;
        border: 0;
        background: transparent;
        font: inherit;
        font-size: 13px;
        color: #c4b5fd;
        cursor: pointer;
    }
    .em-scroll {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        scrollbar-width: thin;
    }
    .em-sections {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding-right: 2px;
    }
    .em-sech {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 6px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #a78bfa;
    }
    .em-sech b {
        font-weight: 600;
        color: #f5c451;
    }
    .em-all {
        margin: 0 0 0 auto;
        padding: 0;
        border: 0;
        background: transparent;
        font: inherit;
        font-size: 13px;
        font-weight: 500;
        letter-spacing: 0;
        text-transform: none;
        color: rgba(244, 242, 250, 0.64);
        cursor: pointer;
    }
    .em-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(68px, 1fr));
        gap: 8px 6px;
    }
    .em-empty {
        margin: 12px 0;
        font-size: 13px;
        color: rgba(244, 242, 250, 0.64);
    }
    .em-props {
        /* Today's settings form, on the panel's ink: no boxes of its own. */
        padding-right: 2px;
    }
    .em-upload-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        flex: none;
        height: 40px;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
    }
    @media (hover: hover) {
        .em-upload-btn:hover {
            background: rgba(255, 255, 255, 0.14);
        }
    }
</style>
