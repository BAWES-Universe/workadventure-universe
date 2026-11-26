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
        livesIn: "Vive en",
        nowIn: "Ahora en",
        inThisRoom: "Estás en esta sala",
    },
    artifacts: {
        openPublic: "Público",
        openPublicHelp: "Cualquiera con el enlace ve solo lo que publicas",
        notPublished: "Aún no publicado",
        publishHelp:
            "La gente ve la versión que publicas. Los cambios posteriores siguen siendo privados hasta que publiques de nuevo.",
        publishVersion: "Publicar la versión {version}",
        publishedStatus: "Publicado · Versión {version} · {time}",
        unpublishedChanges: "La versión {version} aún no está publicada",
        linkFollows: "El enlace siempre muestra tu última versión.",
        publishBar: "Publicado: versión {version}. La versión {latest} aún no está publicada.",
        publish: "Publicar",
        publishing: "Publicando…",
        publishFailed: "No se pudo publicar. Inténtalo de nuevo.",
        publicUnavailable: "Versión pública no disponible",
        publicUnavailableHelp: "La gente ve «No disponible» hasta que publiques una versión.",
    },
};

export default chat;
