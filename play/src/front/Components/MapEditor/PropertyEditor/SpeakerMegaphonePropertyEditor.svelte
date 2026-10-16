<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { SpeakerMegaphonePropertyData } from "@workadventure/map-editor";
    import { areaSpaceName } from "@workadventure/shared-utils/src/Space/areaSpaceName";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import Input from "../../Input/Input.svelte";
    import InputSwitch from "../../Input/InputSwitch.svelte";
    import { IconMicrophone } from "../../Icons";
    import PropertyEditorBase from "./PropertyEditorBase.svelte";

    export let property: SpeakerMegaphonePropertyData;

    const dispatch = createEventDispatcher<{
        change: undefined;
        close: undefined;
    }>();

    // The name is kept as typed: it is what players see on the Stage chat and in the Audience's Stage list. The
    // voice and chat space is named from a safe form of it (areaSpaceName), so spaces, capitals and Arabic are fine.
    let savedName = property.name;
    let nameError: string | null = null;

    // The area panel hands in a fresh copy of the property after every change to the area (a save, an undo, another
    // editor's change): that copy holds the saved name, and a refused name it replaced is dropped.
    let shownProperty = property;
    $: if (property !== shownProperty) {
        shownProperty = property;
        savedName = property.name;
        nameError = null;
    }

    // Two Stages of a room with names that only differ by capitals or spaces read the same to players, and
    // names that end up with the same space would share one voice and chat: both count as taken.
    function compact(name: string): string {
        return name.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
    }

    function takenBy(name: string): string | undefined {
        const wanted = compact(name);
        const wantedSpace = areaSpaceName(name, "");
        for (const area of gameManager.tryGetCurrentGameScene()?.getGameMap().getGameMapAreas()?.getAreas().values() ??
            []) {
            const raw = area.properties?.find((candidate) => candidate.type === "speakerMegaphone");
            if (!raw) continue;
            const parsed = SpeakerMegaphonePropertyData.safeParse(raw);
            if (!parsed.success || parsed.data.id === property.id) continue;
            const other = parsed.data.name;
            if (compact(other) === wanted || areaSpaceName(other, "") === wantedSpace) return other;
        }
        return undefined;
    }

    function onNameChange() {
        property.name = property.name.trim();
        if (property.name === "") {
            nameError = $LL.mapEditor.properties.speakerMegaphone.nameEmpty();
            return;
        }
        const existing = takenBy(property.name);
        if (existing !== undefined) {
            nameError = $LL.mapEditor.properties.speakerMegaphone.nameTaken({ name: existing });
            return;
        }
        nameError = null;
        savedName = property.name;
        dispatch("change");
    }

    function onChatChange() {
        // A name that was refused is not saved along with the switch.
        if (nameError !== null) {
            property.name = savedName;
            nameError = null;
        }
        dispatch("change");
    }
</script>

<PropertyEditorBase
    on:close={() => {
        dispatch("close");
    }}
>
    <span slot="header" class="flex justify-center items-center">
        <IconMicrophone font-size="18" class="mr-2" />
        {$LL.mapEditor.properties.speakerMegaphone.label()}
    </span>
    <span slot="content">
        <div class="value-input">
            <Input
                id="tabLink"
                type="text"
                label={$LL.mapEditor.properties.speakerMegaphone.nameLabel()}
                placeholder={$LL.mapEditor.properties.speakerMegaphone.namePlaceholder()}
                status={nameError ? "error" : ""}
                errorHelperText={nameError}
                bind:value={property.name}
                onChange={onNameChange}
            />
        </div>
        <div class="value-switch">
            <InputSwitch
                id="chatEnabled"
                label={$LL.mapEditor.properties.chatEnabled()}
                bind:value={property.chatEnabled}
                onChange={onChatChange}
            />
        </div>
    </span>
</PropertyEditorBase>
