import { derived } from "svelte/store";
import { mapEditorActivated, mapEditorActivatedForThematics } from "../../Stores/MenuStore";
import { windowSize } from "../../Stores/CoWebsiteStore";
import { getMapEditorTools, MAP_EDITOR_MOBILE_MAX_WIDTH } from "./MapEditorToolList";

export const mapEditorToolsStore = derived(
    [mapEditorActivated, mapEditorActivatedForThematics],
    ([$mapEditorActivated, $mapEditorActivatedForThematics]) =>
        getMapEditorTools({
            mapEditorActivated: $mapEditorActivated,
            mapEditorActivatedForThematics: $mapEditorActivatedForThematics,
        })
);

export const mapEditorIsMobileLayoutStore = derived(
    windowSize,
    ($windowSize) => $windowSize.width < MAP_EDITOR_MOBILE_MAX_WIDTH
);
