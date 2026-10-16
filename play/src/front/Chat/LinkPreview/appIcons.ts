import youtubeSvg from "../../Components/images/applications/icon_youtube.svg";
import googleDocsSvg from "../../Components/images/applications/icon_google_docs.svg";
import googleSheetsSvg from "../../Components/images/applications/icon_google_sheets.svg";
import googleSlidesSvg from "../../Components/images/applications/icon_google_slides.svg";
import googleDriveSvg from "../../Components/images/applications/icon_google_drive.svg";
import klaxoonSvg from "../../Components/images/applications/icon_klaxoon.svg";
import eraserSvg from "../../Components/images/applications/icon_eraser.svg";
import excalidrawSvg from "../../Components/images/applications/icon_excalidraw.svg";
import cardsSvg from "../../Components/images/applications/icon_cards.svg";
import tldrawJpeg from "../../Components/images/applications/icon_tldraw.jpeg";
import type { AppId } from "./LinkKind";

export { youtubeSvg };

/** Each app's own icon, on its link card and on the preview above the message box. */
export const APP_ICONS: Record<AppId, string | undefined> = {
    googleDocs: googleDocsSvg,
    googleSheets: googleSheetsSvg,
    googleSlides: googleSlidesSvg,
    googleDrive: googleDriveSvg,
    klaxoon: klaxoonSvg,
    eraser: eraserSvg,
    excalidraw: excalidrawSvg,
    cards: cardsSvg,
    tldraw: tldrawJpeg,
    custom: undefined,
};
