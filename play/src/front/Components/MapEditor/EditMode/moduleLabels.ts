import { get } from "svelte/store";
import { extensionModuleStore } from "../../../Stores/GameSceneStore";
import type { ExtensionModuleAreaProperty } from "../../../ExternalModule/ExtensionModule";

/** The module's own name, line and icon for one of its area settings (the portal: "Portal to any room"). */
export function moduleSettingLabel(subtype: string): ExtensionModuleAreaProperty["label"] | undefined {
    for (const extensionModule of get(extensionModuleStore)) {
        const label = extensionModule.areaMapEditor?.()?.[subtype]?.label;
        if (label) return label;
    }
    return undefined;
}
