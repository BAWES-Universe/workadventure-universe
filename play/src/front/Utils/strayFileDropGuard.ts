/**
 * A file dropped where nothing takes it would make the browser open that file in place of the game. Whatever accepts
 * a drop (the map in edit mode, the chat, an upload box) cancels the drag over itself first; everywhere else the
 * cursor says no and the drop does nothing.
 */
let installed = false;

export function isFileDrag(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes("Files") ?? false;
}

function refuseDragOver(event: DragEvent): void {
    if (event.defaultPrevented || !isFileDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
}

function swallowDrop(event: DragEvent): void {
    if (!isFileDrag(event)) return;
    event.preventDefault();
}

export function installStrayFileDropGuard(): void {
    if (installed) return;
    installed = true;
    window.addEventListener("dragover", refuseDragOver);
    window.addEventListener("drop", swallowDrop);
}

export function uninstallStrayFileDropGuard(): void {
    if (!installed) return;
    installed = false;
    window.removeEventListener("dragover", refuseDragOver);
    window.removeEventListener("drop", swallowDrop);
}
