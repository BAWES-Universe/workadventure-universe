import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const actionbar: DeepPartial<Translation["actionbar"]> = {
    //layout: "Tegelweergave schakelen",
    //disableLayout: "Niet beschikbaar als er slechts één persoon in de vergadering is",
    //disableMegaphone: "Schakel megafoon uit",
    //menu: "Openen / Sluiten menu",
    calendar: "Openen / Sluiten kalender",
    mapEditor: "Openen / Sluiten kaartbeheerder",
    botEditor: "Bot-editor",
    botEditorModule: {
        visionMarker: "👁 visie",
        providerDisabled: "(Uitgeschakeld)",
        visionHelper:
            "Aanbieders die afbeeldingen kunnen zien zijn gemarkeerd met 👁 — afbeeldingen die spelers sturen worden automatisch verwerkt, geen extra instellingen nodig.",
        aiProviderLabel: "AI-aanbieder",
        aiProviderHelp: "(Selecteer de AI-aanbieder voor deze bot)",
        loadingProviders: "Aanbieders laden...",
        retry: "Opnieuw proberen",
        noProvidersConfigured: "Geen AI-aanbieders geconfigureerd. Stel eerst aanbieders in in de beheer-API.",
        errorNotInitialized: "Bot-API-service niet geïnitialiseerd",
        errorNoProviders: "Geen AI-aanbieders beschikbaar. Configureer aanbieders in de beheer-API.",
        errorLoadFailed: "AI-aanbieders laden mislukt",
        providerVisionHeading: "AI-aanbieder en visie",
        chatInstructions: "Chatinstructies",
        chatInstructionsHelp: "(Wat de bot moet zeggen en hoe hij moet communiceren)",
        chatInstructionsPlaceholder:
            "Voorbeeld: je bent een vriendelijke begroetingsbot genaamd 'WelcomeBot'. Je taak is om nieuwe bezoekers in de lobby te verwelkomen. Wees vrolijk en behulpzaam. Beantwoord vragen over de ruimte. Herhaal niet dezelfde begroeting bij iemand die je vandaag al hebt begroet.",
        noChatInstructions: "Geen chatinstructies ingesteld",
    },
    mapEditorMobileLocked: "Kaarteditor is vergrendeld in mobiele modus",
    mapEditorLocked: "Kaarteditor is vergrendeld 🔐",
    subtitle: {
        microphone: "Microfoon",
        speaker: "Luidspreker",
    },
    app: "Openen / Sluiten applicaties",
    listStatusTitle: {
        enable: "Wijzig je status",
    },

    status: {
        ONLINE: "Online",
        BACK_IN_A_MOMENT: "Zo terug",
        DO_NOT_DISTURB: "Niet storen",
        BUSY: "Bezet",
    },
    globalMessage: "Stuur een globale boodschap",
    //roomList: "Openen / Sluiten kamer lijst",
    help: {
        mic: {
            title: "Dempen / Dempen opheffen",
        },
        cam: {
            title: "Camera starten / stoppen",
        },
        chat: {
            title: "Openen / Sluiten chat",
        },
        follow: {
            title: "Volgen",
        },
        unfollow: {
            title: "Ontvolgen",
        },
        lock: {
            title: "Vergrendel / Ontgrendel discussie",
        },
        share: {
            title: "Starten / Stoppen met scherm delen",
        },
        emoji: {
            title: "Openen / Sluiten emoji",
        },
        audioManager: {
            title: "Volume van omgevingsgeluiden",
            desc: "Configureer het audiovolume door hier te klikken.",
            pause: "Klik hier om de audio te pauzeren",
            play: "Klik hier om de audio af te spelen",
            stop: "Klik hier om de audio te stoppen",
        },
        audioManagerNotAllowed: {
            title: "Omgevingsgeluiden geblokkeerd",
            desc: "Uw browser heeft voorkomen dat omgevingsgeluiden worden afgespeeld. Klik op het pictogram om de weergave te starten.",
        },
        pictureInPicture: {
            title: "Picture in picture",
            descDisabled:
                "Helaas is deze functie niet beschikbaar op uw apparaat ❌. Probeer een ander apparaat of browser te gebruiken, zoals Chrome of Edge, om toegang te krijgen tot deze functie.",
            desc: "U kunt de picture-in-picture functie gebruiken om een video of presentatie te bekijken terwijl u in een gesprek bent. Klik gewoon op het picture-in-picture pictogram en geniet van uw inhoud.",
        },
    },
    personalDesk: {
        label: "Naar mijn bureau gaan",
        unclaim: "Mijn bureau vrijgeven",
        errorNoUser: "Kan uw gebruikersinformatie niet vinden",
        errorNotFound: "U heeft nog geen persoonlijk bureau",
        errorMoving: "Kan uw persoonlijke bureau niet bereiken",
        errorUnclaiming: "Kan uw persoonlijke bureau niet vrijgeven",
    },
};

export default actionbar;
