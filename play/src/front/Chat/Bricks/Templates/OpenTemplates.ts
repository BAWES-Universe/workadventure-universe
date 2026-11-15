import { openModal } from "svelte-modals";
import TemplateList from "./TemplateList.svelte";
import TemplateSheet from "./TemplateSheet.svelte";

/** A template's look before creating (game #2008): its own sheet, with Create Brick, Star and Cancel. */
export function openTemplateSheet(templateId: string): void {
    openModal(TemplateSheet, { templateId });
}

/** "Start from a template": the three short lists. */
export function openTemplateList(): void {
    openModal(TemplateList);
}
