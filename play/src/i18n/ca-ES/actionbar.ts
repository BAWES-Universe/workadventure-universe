import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const actionbar: DeepPartial<Translation["actionbar"]> = {
    botEditor: "Editor de bots",
    botEditorModule: {
        visionMarker: "👁 visió",
        providerDisabled: "(Desactivat)",
        visionHelper:
            "Els proveïdors que poden veure imatges estan marcats amb 👁 — les imatges enviades pels jugadors es processen automàticament, sense configuració addicional.",
        aiProviderLabel: "Proveïdor d'IA",
        aiProviderHelp: "(Selecciona el proveïdor d'IA per a aquest bot)",
        loadingProviders: "Carregant proveïdors...",
        retry: "Torna-ho a provar",
        noProvidersConfigured:
            "No hi ha proveïdors d'IA configurats. Configura els proveïdors a l'API d'administració primer.",
        errorNotInitialized: "El servei de l'API del bot no està inicialitzat",
        errorNoProviders: "No hi ha proveïdors d'IA disponibles. Configura els proveïdors a l'API d'administració.",
        errorLoadFailed: "No s'han pogut carregar els proveïdors d'IA",
        providerVisionHeading: "Proveïdor d'IA i visió",
        chatInstructions: "Instruccions de xat",
        chatInstructionsHelp: "(Què ha de dir el bot i com s'ha de comunicar)",
        chatInstructionsPlaceholder:
            "Exemple: ets un bot d'acollida amable anomenat 'WelcomeBot'. La teva feina és donar la benvinguda als nous visitants del vestíbul. Sigues alegre i útil. Respon preguntes sobre l'espai. No repeteixis la mateixa salutació a algú a qui ja has saludat avui.",
        noChatInstructions: "No s'han definit instruccions de xat",
    },
    help: {
        audioManager: {
            title: "Volum dels sons ambientals",
            desc: "Configureu el volum d'àudio fent clic aquí.",
            pause: "Feu clic aquí per posar en pausa l'àudio",
            play: "Feu clic aquí per reproduir l'àudio",
            stop: "Feu clic aquí per aturar l'àudio",
        },
        audioManagerNotAllowed: {
            title: "Sons ambientals bloquejats",
            desc: "El vostre navegador ha impedit la reproducció de sons ambientals. Feu clic a la icona per iniciar la reproducció.",
        },
    },
    personalDesk: {
        label: "Anar al meu escriptori",
        unclaim: "Alliberar el meu escriptori",
        errorNoUser: "No es poden trobar les vostres dades d'usuari",
        errorNotFound: "Encara no teniu un escriptori personal",
        errorMoving: "No es pot arribar al vostre escriptori personal",
        errorUnclaiming: "No es pot alliberar el vostre escriptori personal",
    },
};

export default actionbar;
