import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const actionbar: DeepPartial<Translation["actionbar"]> = {
    botEditor: "Botowy editor",
    botEditorModule: {
        visionMarker: "👁 widźenje",
        providerDisabled: "(znjemóžnjeny)",
        visionHelper:
            "Poskićowarjo, kotřiž móža wobrazy widźeć, su z 👁 woznamjenjeni — wobrazy, kotrež hrajerjo sćelu, so awtomatisce předźěłaja, žane přidatne nastajenje njetrjeba.",
        aiProviderLabel: "KI-poskićowar",
        aiProviderHelp: "(Wubjer KI-poskićowarja za tutoho bota)",
        loadingProviders: "Poskićowarjo so začitaja...",
        retry: "Hišće raz spytać",
        noProvidersConfigured:
            "Žane KI-poskićowarjo konfigurowani. Prošu nastaj najprjedy poskićowarjow w administraciskej API.",
        errorNotInitialized: "Bot-API-słužba njeje inicializowana",
        errorNoProviders: "Žane KI-poskićowarjo k dispoziciji. Prošu konfiguruj poskićowarjow w administraciskej API.",
        errorLoadFailed: "KI-poskićowarjo njeda so začitać",
        providerVisionHeading: "KI-poskićowar a widźenje",
        chatInstructions: "Chat-pokiwy",
        chatInstructionsHelp: "(Što měł bot rjec a kak měł komunikować)",
        chatInstructionsPlaceholder:
            "Přikład: Sy přećelny witanjowy bot z mjenom 'WelcomeBot'. Twoja nadawka je nowych wopytowarjow w lobby witać. Budź wjesoły a přećelny. Wotmołw na prašenja wo rumje. Njejespytuj samsne witanje pola někoho, koho sy dźensa hižo witał.",
        noChatInstructions: "Žane chat-pokiwy nastajene",
    },
    //menu: "meni wočinić/začinić",
    calendar: "kalender wočinić/začinić",
    subtitle: {
        microphone: "mikrofon",
        speaker: "wótřerěčak",
    },
    help: {
        chat: {
            title: "chat wočinić/začinić",
        },
        emoji: {
            title: "emojijowy meni wočinić/začinić",
        },
        audioManager: {
            title: "Hłošnosć wokolnych zwukow",
            desc: "Konfigurujće awdijowu hłošnosć, kliknje tu.",
            pause: "Klikńće tu, zo byšće awdijo zastajił",
            play: "Klikńće tu, zo byšće awdijo wothrał",
            stop: "Klikńće tu, zo byšće awdijo zastajił",
        },
        follow: {
            title: "sćěhować",
        },
        unfollow: {
            title: "nic wjac sćěhować",
        },
        lock: {
            title: "diskusiju zawrěć/wotewrić",
        },
        mic: {
            title: "něme šaltowanje startować/skónčić",
        },
        cam: {
            title: "kameru startować/skónčić",
        },
        share: {
            title: "přenošowanje wobrazowki startować/skónčić",
        },
        audioManagerNotAllowed: {
            title: "Wokolne zwuki zablokowane",
            desc: "Waš wobhladowak je wokolne zwuki wothrać zawoborał. Klikńće na symbol, zo byšće wothraće startował.",
        },
        pictureInPicture: {
            title: "Wobraz we wobrazu",
            descDisabled:
                "Bohužel tuta funkcija njeje na wašim gratu k dispoziciji ❌. Prošu spytajće druhi grat abo wobhladowak wužiwać, na přikład Chrome abo Edge, zo byšće přistup k tutej funkciji dóstał.",
            desc: "Móžeće funkciju wobraz we wobrazu wužiwać, zo byšće widejo abo prezentaciju woglědowali, mjeztym zo sće w rozmołwje. Klikńće jenož na symbol wobraz we wobrazu a wužiwajće swój wobsah.",
        },
    },
    personalDesk: {
        label: "K swojemu pisaćemu blidkej",
        unclaim: "Mój pisaće blidko wotwołać",
        errorNoUser: "Wužiwarske informacije njejsu so namakali",
        errorNotFound: "Nimaće hišće wosobinske pisaće blidko",
        errorMoving: "Wosobinske pisaće blidko njeje so docpěło",
        errorUnclaiming: "Wosobinske pisaće blidko njeje so wotwołało",
    },
};

export default actionbar;
