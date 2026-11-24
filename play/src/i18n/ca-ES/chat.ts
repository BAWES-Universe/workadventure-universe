import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const chat: DeepPartial<Translation["chat"]> = {
    intro: "Aquí està el vostre històric del chat:",
    enter: "Escribiu el vostre missatge...",
    menu: {
        visitCard: "Targeta de visita",
        addFriend: "Afegir amic",
    },
    typing: "esta escribiendo...",
    userList: {
        editMyVisitCard: "Edita la meva targeta de visita",
        viewProfile: "Veure el perfil",
        follow: "Localitzar",
    },
    botStatus: {
        online: "En línia",
        resting: "Descansant",
        unready: "Encara no està a punt",
        gone: "Se n'ha anat",
        restingPlaceholder: "Les respostes estan en pausa",
        unreadyPlaceholder: "Encara no pot respondre",
        closed: "Aquest xat està tancat",
        left: "{name} se n'ha anat",
        visit: "Visita",
        visitAria: "Visita {name} a {room}",
        livesIn: "Viu a",
        nowIn: "Ara a",
        inThisRoom: "Ets en aquesta sala",
    },
    artifacts: {
        openPublic: "Públic",
        openPublicHelp: "Qualsevol persona amb l'enllaç només veu el que publiques",
        notPublished: "Encara no publicat",
        publishHelp:
            "La gent veu la versió que publiques. Els canvis posteriors es mantenen privats fins que tornis a publicar.",
        publishVersion: "Publica la versió {version}",
        publishedStatus: "Publicat · Versió {version} · {time}",
        unpublishedChanges: "La versió {version} encara no està publicada",
        linkFollows: "L'enllaç sempre mostra la teva última versió.",
        publishBar: "Publicat: versió {version}. La versió {latest} encara no està publicada.",
        publish: "Publica",
        publishing: "S'està publicant…",
        publishFailed: "No s'ha pogut publicar. Torna-ho a provar.",
        publicUnavailable: "Versió pública no disponible",
        publicUnavailableHelp: "La gent veu «No disponible» fins que publiquis una versió.",
    },
};

export default chat;
