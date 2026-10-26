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
};

export default chat;
