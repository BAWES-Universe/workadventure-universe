<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";
    import type { PersonalAreaPropertyData } from "@workadventure/map-editor";
    import { PersonalAreaAccessClaimMode } from "@workadventure/map-editor";
    import { closeModal, openModal } from "svelte-modals";
    import { Color } from "@workadventure/shared-utils";
    import LL from "../../../../i18n/i18n-svelte";
    import RolePicker from "../../Input/RolePicker.svelte";
    import MemberAutocomplete from "../../Input/MemberAutocomplete.svelte";
    import type { InputTagOption } from "../../Input/InputTagOption";
    import { toTags } from "../../Input/InputTagOption";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { mapEditorSelectedAreaPreviewStore } from "../../../Stores/MapEditorStore";
    import ActionPopupOnPersonalAreaWithEntities from "../ActionPopupOnPersonalAreaWithEntities.svelte";
    import PropertyEditorBase from "./PropertyEditorBase.svelte";
    import { IconCheck, IconInfoCircle, IconDesk } from "@wa-icons";

    export let personalAreaPropertyData: PersonalAreaPropertyData;

    let _tags: InputTagOption[] | undefined = personalAreaPropertyData.allowedTags
        ? personalAreaPropertyData.allowedTags.map((allowedTag) => ({
              value: allowedTag,
              created: false,
              label: allowedTag,
          }))
        : undefined;

    let personalAreaOwner: string | null = personalAreaPropertyData.ownerId;
    // The owner is shown as "Name (email)", an email or an id, as before; the card splits the name from the email.
    $: ownerMatch = personalAreaOwner ? /^(.*) \((.*)\)\s*$/.exec(personalAreaOwner) : null;
    $: ownerName = (ownerMatch ? ownerMatch[1] : personalAreaOwner ?? "").trim();
    $: ownerEmail = ownerMatch ? ownerMatch[2] : "";

    const dispatch = createEventDispatcher<{
        change: boolean | undefined;
        close: boolean | undefined;
    }>();
    const entitiesManager = gameManager.getCurrentGameScene().getGameMapFrontWrapper().getEntitiesManager();

    onMount(async () => {
        if (personalAreaPropertyData.ownerId) {
            const connection = gameManager.getCurrentGameScene().connection;
            if (connection) {
                const member = await connection.queryMember(personalAreaPropertyData.ownerId);
                personalAreaOwner = member.name
                    ? `${member.name} ${member.email ? `(${member.email})` : ""}`
                    : member.email
                    ? member.email
                    : member.id;
            }
        }
    });

    function setOwnerId(selectedOwner: { value: string; label: string }) {
        personalAreaPropertyData.ownerId = selectedOwner.value;
        personalAreaOwner = selectedOwner.label;
        dispatch("change");
    }

    function handleTagChange(tags: InputTagOption[] | undefined) {
        if (tags) {
            personalAreaPropertyData.allowedTags = toTags(tags);
        } else {
            personalAreaPropertyData.allowedTags = [];
        }
        dispatch("change");
    }

    function revokeOwner() {
        if (isPersonalAreaContainsEntities()) {
            openModalForActionOnAreaEntities("change", resetAreaOwner);
        } else {
            resetAreaOwner();
            dispatch("change");
        }
    }

    function onRemoveProperty() {
        if (personalAreaOwner !== null && isPersonalAreaContainsEntities()) {
            openModalForActionOnAreaEntities("close");
        } else {
            dispatch("close");
        }
    }

    function onClaimModeChange() {
        dispatch("change");
    }

    function resetAreaOwner() {
        personalAreaPropertyData.ownerId = null;
        personalAreaOwner = null;
    }

    function openModalForActionOnAreaEntities(dispatchType: "change" | "close", callback?: () => void) {
        openModal(ActionPopupOnPersonalAreaWithEntities, {
            onDeleteEntities: () => {
                if (callback) {
                    callback();
                }
                dispatch(dispatchType, true);
                closeModal();
            },
            onKeepEntities: () => {
                if (callback) {
                    callback();
                }
                dispatch(dispatchType);
                closeModal();
            },
            onCancel: () => {
                closeModal();
            },
        });
    }

    function isPersonalAreaContainsEntities() {
        const areaId = $mapEditorSelectedAreaPreviewStore?.getId();
        if (areaId) {
            return entitiesManager.getEntitiesInsideArea(areaId).size > 0;
        }
        return false;
    }
</script>

<PropertyEditorBase on:close={onRemoveProperty}>
    <span slot="header" class="flex justify-center items-center">
        <IconDesk class="w-6 mr-1" />
        {$LL.mapEditor.properties.personalAreaPropertyData.label()}
    </span>
    <span slot="content">
        {#if personalAreaPropertyData !== undefined}
            <div class="overflow-y-auto overflow-x-hidden flex flex-col gap-2">
                <p class="help-text">
                    <IconInfoCircle font-size="18" />
                    {$LL.mapEditor.properties.personalAreaPropertyData.description()}
                </p>
                {#if personalAreaOwner}
                    <!-- The owner as a person card. Revoke access sits in the card, next to whose access it takes
                         away; it frees the desk and is not red (nothing is deleted). Turning the desk off is the
                         page's own button at the very bottom. -->
                    <div class="pa-owner">
                        <span class="pa-label">{$LL.mapEditor.properties.personalAreaPropertyData.owner()}</span>
                        <div class="pa-owner-card">
                            <span
                                class="pa-face"
                                style="background: {Color.getColorByString(
                                    ownerName
                                )}; color: {Color.getTextColorByBackgroundColor(Color.getColorByString(ownerName))}"
                                >{ownerName.charAt(0).toUpperCase()}</span
                            >
                            <span class="pa-tx">
                                <span class="pa-t">{ownerName}</span>
                                {#if ownerEmail}<span class="pa-m">{ownerEmail}</span>{/if}
                            </span>
                            <button
                                type="button"
                                class="u-cta-secondary pa-revoke h-11 m-0 px-4 rounded-full text-sm font-bold"
                                data-testid="revokeAccessButton"
                                on:click={revokeOwner}
                            >
                                {$LL.mapEditor.properties.personalAreaPropertyData.revokeAccess()}
                            </button>
                        </div>
                        <span class="pa-m">{$LL.mapEditor.properties.personalAreaPropertyData.ownedHint()}</span>
                    </div>
                {:else}
                    <div
                        class="pa-modes"
                        role="radiogroup"
                        aria-label={$LL.mapEditor.properties.personalAreaPropertyData.accessClaimMode()}
                    >
                        <span class="pa-label"
                            >{$LL.mapEditor.properties.personalAreaPropertyData.accessClaimMode()}</span
                        >
                        <div class="pa-list">
                            {#each PersonalAreaAccessClaimMode.options as claimMode (claimMode)}
                                <!-- Picked the way you pick your status: tinted and bold, with a check. -->
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={personalAreaPropertyData.accessClaimMode === claimMode}
                                    class="u-menu-row pa-mode"
                                    class:u-selected={personalAreaPropertyData.accessClaimMode === claimMode}
                                    data-testid="accessClaimMode-{claimMode}"
                                    on:click={() => {
                                        personalAreaPropertyData.accessClaimMode = claimMode;
                                        onClaimModeChange();
                                    }}
                                >
                                    <span class="pa-tx">
                                        <span class="pa-t"
                                            >{claimMode === "dynamic"
                                                ? $LL.mapEditor.properties.personalAreaPropertyData.claimModeDynamicTitle()
                                                : $LL.mapEditor.properties.personalAreaPropertyData.claimModeStaticTitle()}</span
                                        >
                                        <span class="pa-m"
                                            >{claimMode === "dynamic"
                                                ? $LL.mapEditor.properties.personalAreaPropertyData.claimModeDynamicText()
                                                : $LL.mapEditor.properties.personalAreaPropertyData.claimModeStaticText()}</span
                                        >
                                    </span>
                                    {#if personalAreaPropertyData.accessClaimMode === claimMode}
                                        <IconCheck class="flex-none" font-size="18" />
                                    {/if}
                                </button>
                            {/each}
                        </div>
                    </div>
                    <div>
                        {#if personalAreaPropertyData.accessClaimMode === PersonalAreaAccessClaimMode.enum.static}
                            <label for="allowedUserInput" class="pa-label pa-field-label"
                                >{$LL.mapEditor.properties.personalAreaPropertyData.allowedUser()}</label
                            >
                            <MemberAutocomplete
                                value={personalAreaPropertyData.ownerId}
                                placeholder={$LL.mapEditor.properties.personalAreaPropertyData.searchMember()}
                                on:onSelect={({ detail: selectedUserId }) => setOwnerId(selectedUserId)}
                            />
                        {:else}
                            <RolePicker
                                label={$LL.mapEditor.properties.personalAreaPropertyData.allowedTags()}
                                emptyText={$LL.mapEditor.properties.rolePicker.everyoneClaim()}
                                bind:value={_tags}
                                handleChange={() => handleTagChange(_tags)}
                                testId="allowedTags"
                            >
                                <span slot="info">
                                    <IconInfoCircle font-size="15" />
                                    {$LL.mapEditor.properties.personalAreaPropertyData.allowedTagsInfo()}
                                </span>
                            </RolePicker>
                        {/if}
                    </div>
                {/if}
            </div>
        {/if}
    </span>
</PropertyEditorBase>

<style>
    .pa-modes,
    .pa-owner {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .pa-label {
        font-size: 14px;
        color: #fff;
    }
    .pa-field-label {
        display: block;
        margin-bottom: 8px;
    }
    .pa-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 4px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.04);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
    }
    .pa-mode {
        gap: 12px;
        min-height: 56px;
        margin: 0;
        padding: 8px 12px;
    }
    .pa-owner-card {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 64px;
        padding: 8px 8px 8px 12px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.06);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    }
    .pa-face {
        flex: none;
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        font-size: 15px;
        font-weight: 700;
        color: #fff;
    }
    .pa-revoke {
        flex: none;
    }
    .pa-tx {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }
    .pa-t {
        font-size: 14px;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .pa-m {
        font-size: 12.5px;
        line-height: 1.35;
        font-weight: 400;
        color: rgba(244, 242, 250, 0.64);
        overflow: hidden;
        text-overflow: ellipsis;
    }
</style>
