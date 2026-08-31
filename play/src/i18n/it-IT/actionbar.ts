import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const actionbar: DeepPartial<Translation["actionbar"]> = {
    //layout: "Attiva / Disattiva vista a griglia",
    //disableLayout: "Non disponibile se c'è solo una persona nella riunione",
    //disableMegaphone: "Disattiva megafono",
    //menu: "Apri / Chiudi menu",
    calendar: "Apri / Chiudi calendario",
    todoList: "Apri / Chiudi lista delle cose da fare",
    mapEditor: "Apri / Chiudi gestore delle mappe",
    botEditor: "Editor dei bot",
    botEditorModule: {
        visionMarker: "👁 visione",
        providerDisabled: "(Disabilitato)",
        visionHelper:
            "I provider che possono vedere le immagini sono contrassegnati con 👁 — le immagini inviate dai giocatori vengono elaborate automaticamente, senza configurazione aggiuntiva.",
        aiProviderLabel: "Provider IA",
        aiProviderHelp: "(Seleziona il provider IA per questo bot)",
        loadingProviders: "Caricamento provider...",
        retry: "Riprova",
        noProvidersConfigured:
            "Nessun provider IA configurato. Configura prima i provider nell'API di amministrazione.",
        errorNotInitialized: "Servizio API del bot non inizializzato",
        errorNoProviders: "Nessun provider IA disponibile. Configura i provider nell'API di amministrazione.",
        errorLoadFailed: "Impossibile caricare i provider IA",
        providerVisionHeading: "Provider IA e visione",
        chatInstructions: "Istruzioni di chat",
        chatInstructionsHelp: "(Cosa deve dire il bot e come deve comunicare)",
        chatInstructionsPlaceholder:
            "Esempio: sei un bot di benvenuto amichevole chiamato 'WelcomeBot'. Il tuo compito è accogliere i nuovi visitatori nell'atrio. Sii allegro e disponibile. Rispondi alle domande sullo spazio. Non ripetere lo stesso saluto a qualcuno che hai già salutato oggi.",
        noChatInstructions: "Nessuna istruzione di chat impostata",
    },
    mapEditorMobileLocked: "L'editor delle mappe è bloccato in modalità mobile",
    mapEditorLocked: "L'editor delle mappe è bloccato 🔐",
    subtitle: {
        microphone: "Microfono",
        speaker: "Altoparlante",
    },
    app: "Apri / Chiudi applicazioni",
    listStatusTitle: {
        enable: "Cambia il tuo stato",
    },

    status: {
        ONLINE: "Online",
        BACK_IN_A_MOMENT: "Torno subito",
        DO_NOT_DISTURB: "Non disturbare",
        BUSY: "Occupato",
    },
    globalMessage: "Invia un messaggio globale",
    //roomList: "Apri / Chiudi lista delle stanze",
    //appList: "Apri / Chiudi lista delle applicazioni",
    help: {
        audioManager: {
            title: "Volume dei suoni ambientali",
            desc: "Configura il volume dell'audio facendo clic qui.",
            pause: "Fai clic qui per mettere in pausa l'audio",
            play: "Fai clic qui per riprodurre l'audio",
            stop: "Fai clic qui per fermare l'audio",
        },
        audioManagerNotAllowed: {
            title: "Suoni ambientali bloccati",
            desc: "Il tuo browser ha impedito la riproduzione dei suoni ambientali. Fai clic sull'icona per avviare la riproduzione.",
        },
        mic: {
            title: "Disattiva / Attiva microfono",
        },
        cam: {
            title: "Avvia / Interrompi fotocamera",
        },
        chat: {
            title: "Apri / Chiudi chat",
        },
        follow: {
            title: "Segui",
        },
        unfollow: {
            title: "Smetti di seguire",
        },
        lock: {
            title: "Blocca / Sblocca discussione",
        },
        share: {
            title: "Avvia / Interrompi condivisione dello schermo",
        },
        emoji: {
            title: "Apri / Chiudi emoji",
        },
        pictureInPicture: {
            title: "Picture in picture",
            descDisabled:
                "Sfortunatamente, questa funzionalità non è disponibile sul tuo dispositivo ❌. Prova a utilizzare un altro dispositivo o browser, come Chrome o Edge, per accedere a questa funzionalità.",
            desc: "Puoi utilizzare la funzionalità picture in picture per guardare un video o una presentazione mentre sei in una conversazione. Basta cliccare sull'icona picture in picture e goderti il tuo contenuto.",
        },
    },
    personalDesk: {
        label: "Vai alla mia scrivania",
        unclaim: "Libera la mia scrivania",
        errorNoUser: "Impossibile trovare le informazioni utente",
        errorNotFound: "Non hai ancora una scrivania personale",
        errorMoving: "Impossibile raggiungere la tua scrivania personale",
        errorUnclaiming: "Impossibile liberare la tua scrivania personale",
    },
};

export default actionbar;
