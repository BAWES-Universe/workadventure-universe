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
    brick: {
        computer: {
            screenInControl: "Tienes el control · {name} espera",
            lastStepLine: "Paga y envía, luego devuelve el control. {name} espera hasta que termines.",
            trustTitle: "{name} tiene uso completo del ordenador",
            trustLine:
                "{name} puede instalar y ejecutar cualquier cosa en él y acceder a todo lo que hay allí. Un inicio de sesión hecho en él puede usarse en cualquier tarea de {name}.",
            screenControlLine:
                "Estás escribiendo en el ordenador de {name}. {name} puede acceder a todo lo que hay en él.",
            gettingItReady: "Preparando…",
            runningTitle: "Algo sigue en ejecución",
            runningLine:
                "Un programa que instaló {name} sigue en ejecución en este ordenador. Podría ver lo que escribes. Reiniciar lo cierra.",
            restartFirst: "Reiniciar primero",
            takeOverAnyway: "Tomar el control igualmente",
            restartingHead: "Reiniciando · {name} te lo pedirá de nuevo",
            restartingLine:
                "Reiniciando el ordenador de {name}. Todo se cierra y luego {name} prepara la página de nuevo y te lo pide.",
            restartingBar: "{job} · reiniciando el ordenador",
            runningAgainTitle: "Sigue en ejecución",
            runningAgainLine:
                "Volvió a arrancar tras el reinicio, así que aún podría ver lo que escribes. Continúa solo si te parece bien para este paso.",
            notNow: "Ahora no",
            screenInControlRunning: "Tienes el control · un programa sigue en ejecución",
            screenControlRunningLine:
                "Estás escribiendo en el ordenador de {name}. Un programa que instaló {name} sigue en ejecución y podría ver lo que escribes.",
            notReady: "No se pudo preparar el ordenador. No se cambió nada en él. Inténtalo de nuevo.",
        },
    },
};

export default chat;
