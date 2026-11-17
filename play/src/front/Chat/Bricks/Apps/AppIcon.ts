import type { ComponentType } from "svelte";
import {
    IconBrandDropbox,
    IconBrandGithub,
    IconBrandGmail,
    IconBrandGoogleDrive,
    IconBrandNotion,
    IconBrandSlack,
    IconCalendarEvent,
    IconPlug,
    IconWorldSearch,
} from "@wa-icons";

/**
 * The picture beside an app: a known name gets its own mark, anything else (an app a person pasted a link for) the plug.
 * It only looks at the name, so a new app never needs a change here to show up.
 */
export function appIcon(name: string): ComponentType {
    const lower = name.toLowerCase();
    if (lower.includes("gmail")) return IconBrandGmail;
    if (lower.includes("calendar")) return IconCalendarEvent;
    if (lower.includes("github")) return IconBrandGithub;
    if (lower.includes("notion")) return IconBrandNotion;
    if (lower.includes("slack")) return IconBrandSlack;
    if (lower.includes("drive")) return IconBrandGoogleDrive;
    if (lower.includes("dropbox")) return IconBrandDropbox;
    if (lower.includes("tavily") || lower.includes("search")) return IconWorldSearch;
    return IconPlug;
}
