import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const chat: DeepPartial<Translation["chat"]> = {
    intro: "Aquí está su histórico del chat:",
    enter: "Escriba su mensaje...",
    menu: {
        visitCard: "Tarjeta de visita",
        addFriend: "Añadir amigo",
    },
    typing: "està escrivint...",
    userList: {
        editMyVisitCard: "Editar mi tarjeta de visita",
        viewProfile: "Ver perfil",
        follow: "Localizar",
    },
    botStatus: {
        online: "En línea",
        resting: "Descansando",
        unready: "Aún no está listo",
        gone: "Se fue",
        restingPlaceholder: "Respuestas en pausa",
        unreadyPlaceholder: "Aún no puede responder",
        closed: "Este chat está cerrado",
        left: "{name} se fue",
        visit: "Visitar",
        visitAria: "Visitar a {name} en {room}",
        inThisRoom: "Estás en esta sala",
    },
};

export default chat;
