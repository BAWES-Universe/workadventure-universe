import type { BaseTranslation } from "../i18n-types";
import audio from "./audio";
import camera from "./camera";
import chat from "./chat";
import companion from "./companion";
import woka from "./woka";
import error from "./error";
import follow from "./follow";
import login from "./login";
import menu from "./menu";
import report from "./report";
import refreshPrompt from "./refreshPrompt";
import warning from "./warning";
import trigger from "./trigger";
import notification from "./notification";
import cowebsite from "./cowebsite";
import actionbar from "./actionbar";
import mapEditor from "./mapEditor";
import megaphone from "./megaphone";
import video from "./video";
import say from "./say";
import statusModal from "./statusModal";
import area from "./area";
import externalModule from "./externalModule";
import form from "./form";
import messageScreen from "./messageScreen";
import locate from "./locate";
import broadcast from "./broadcast";
import install from "./install";

const en_US: BaseTranslation = {
    area,
    audio,
    camera,
    chat,
    companion,
    woka,
    error,
    follow,
    login,
    menu,
    report,
    refreshPrompt,
    warning,
    trigger,
    notification,
    cowebsite,
    actionbar,
    mapEditor,
    megaphone,
    video,
    say,
    statusModal,
    externalModule,
    form,
    messageScreen,
    locate,
    broadcast,
    install,
    // The installed computer app's own title bar (TitleBar.svelte).
    titleBar: {
        here: "{count:number} here",
        hereLabel: "{count:number} here. Open the people list.",
        roomLabel: "{room:string}. Open Orbit.",
        inConversation: "In conversation",
        lookingAround: "Looking around",
        fullScreen: "Full screen",
    },
};

export default en_US;
