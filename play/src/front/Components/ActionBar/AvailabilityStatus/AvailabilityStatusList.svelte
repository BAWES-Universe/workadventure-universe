<script lang="ts">
    import { AvailabilityStatus } from "@workadventure/messages";
    import { resetAllStatusStoreExcept } from "../../../Rules/StatusRules/statusChangerFunctions";
    import type { RequestedStatus } from "../../../Rules/StatusRules/statusRules";
    import { availabilityStatusStore } from "../../../Stores/MediaStore";
    import { getColorHexOfStatus, getStatusLabel } from "../../../Utils/AvailabilityStatus";
    import LL from "../../../../i18n/i18n-svelte";
    import ExternalComponents from "../../ExternalModules/ExternalComponents.svelte";
    import HeaderMenuItem from "../MenuIcons/HeaderMenuItem.svelte";
    import { openedMenuStore } from "../../../Stores/MenuStore";
    import type { StatusInformationInterface } from "./Interfaces/AvailabilityStatusPropsInterface";
    import AvailabilityStatusCircle from "./AvailabilityStatusCircle.svelte";
    import { IconCheck } from "@wa-icons";

    export let statusInformation: Array<StatusInformationInterface>;
    export let align: "end" | "start" = "start";

    const handleKeyPress = (e: KeyboardEvent, newStatus: RequestedStatus | AvailabilityStatus.ONLINE | null) => {
        if (newStatus === AvailabilityStatus.ONLINE) newStatus = null;
        if (e.key === "Enter") {
            resetAllStatusStoreExcept(newStatus);
            openedMenuStore.close("profileMenu");
        }
    };
    const handleClick = (newStatus: RequestedStatus | AvailabilityStatus.ONLINE | null) => {
        if (newStatus === AvailabilityStatus.ONLINE) newStatus = null;
        resetAllStatusStoreExcept(newStatus);
        openedMenuStore.close("profileMenu");
    };
</script>

<div>
    <ExternalComponents zone="availabilityStatus" />

    <HeaderMenuItem label={$LL.actionbar.listStatusTitle.enable()} />
    <!-- Some status (silent, in a meeting...) are locking the status bar to only one option -->
    {#if [AvailabilityStatus.SPEAKER, AvailabilityStatus.JITSI, AvailabilityStatus.LIVEKIT, AvailabilityStatus.BBB, AvailabilityStatus.DENY_PROXIMITY_MEETING, AvailabilityStatus.SILENT].includes($availabilityStatusStore)}
        <button class="status-button u-menu-row u-selected min-h-[38px] pointer-events-auto">
            <span class="status-dot-slot">
                <AvailabilityStatusCircle
                    cursorType="pointer"
                    position="relative"
                    colorHex={getColorHexOfStatus($availabilityStatusStore)}
                />
            </span>
            <span class="u-menu-label">{getStatusLabel($availabilityStatusStore)}</span>
            <IconCheck font-size="16" class="shrink-0 text-[#c4b5fd]" />
        </button>
    {:else}
        {#each statusInformation as statusInformationValue (statusInformationValue.AvailabilityStatus)}
            {@const isCurrent = $availabilityStatusStore === statusInformationValue.AvailabilityStatus}
            <button
                class="status-button u-menu-row min-h-[38px] font-normal pointer-events-auto"
                class:justify-end={align === "end"}
                class:disabled={isCurrent}
                class:u-selected={isCurrent}
                on:keyup={(e) => {
                    handleKeyPress(e, statusInformationValue.AvailabilityStatus);
                }}
                on:click|stopPropagation={() => handleClick(statusInformationValue.AvailabilityStatus)}
            >
                <span class="status-dot-slot">
                    <AvailabilityStatusCircle
                        cursorType="pointer"
                        position="relative"
                        colorHex={statusInformationValue.colorHex}
                        isActive={isCurrent}
                    />
                </span>
                <span class="u-menu-label" class:grow={align === "start"}>
                    {statusInformationValue.label}
                </span>
                <!-- Always there, hidden on the other rows, so every row has the same layout. -->
                <IconCheck font-size="16" class="shrink-0 text-[#c4b5fd] {isCurrent ? '' : 'opacity-0'}" />
            </button>
        {/each}
    {/if}
</div>

<style>
    /* The colour dot sits where the menu rows have their icon tile, so the labels line up. */
    .status-dot-slot {
        flex: none;
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
    }
</style>
