<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { IconRoute } from "../../Components/Icons";
    import AddPropertyButton from "../../Components/MapEditor/PropertyEditor/AddPropertyButton.svelte";

    const dispatch = createEventDispatcher<{
        click: CustomEvent;
    }>();
</script>

<AddPropertyButton
    headerText="Teleport"
    descriptionText="Teleport people to another universe/world/room"
    img={IconRoute}
    style="z-index: 200;"
    testId="teleport"
    on:click={(event) => {
        dispatch("click", event);
    }}
/>
