import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const quest: DeepPartial<Translation["quest"]> = {
    quests: "Misiones",

    welcome: "Bienvenida",
    close: "Cerrar",
    minutes: "{minutes} min",
    acceptedCount: "{count} misi{{ón|ones}} aceptad{{a|as}}",
    newActivity: "Novedades en tus misiones",
    invitation: {
        line: "¡Bienvenido! ¿Echamos un vistazo?",
        secondary: "Un par de minutos, a tu ritmo.",
        showOptions: "¡Empecemos!",
        notNow: "Ahora no",
    },
    options: {
        title: "¿Qué te gustaría hacer?",
        tryAnother: "¿Quieres probar otra?",
    },
    paths: {
        meet: {
            title: "Conoce a alguien",
            description: "Saluda a quien esté por aquí.",
            objective: "Saluda a alguien",
            body: "Acércate a alguien. Cuando se abra la burbuja, saluda.",
            waiting: "Saludo enviado. Esperando respuesta.",
            payoff: "Encantado de conocerte.",
            payoffNeutral: "Has saludado. Bienvenido.",
            lastTime: "La última vez saludaste.",
        },
        explore: {
            title: "Explora este lugar",
            description: "Encuentra: {area}.",
            objective: "Encuentra: {area}",
            body: "Camina hasta {area} y entra.",
            walk: "Ir a {area}",
            notOnThisMap: "{area} está en otra sala.",
            payoff: "Has encontrado {area}.",
            lastTime: "La última vez encontraste {area}.",
        },
        build: {
            title: "Prueba a construir",
            description: "Añade una cosa al mapa.",
            objective: "Añade una cosa",
            body: "Abre el editor de mapas y coloca una cosa.",
            noPosition: "Abre Tools, luego el editor de mapas.",
            payoff: "Ya es tuyo. Se queda.",
            lastTime: "La última vez añadiste algo.",
            needs: "Requiere: permiso de edición en esta sala",
        },
    },
    stamps: {
        meet: "Primer saludo",
        explore: "Exploradora",
        build: "Constructora",
        badge: "Insignia {stamp}",
    },
    pill: {
        open: "Abrir misiones",
        close: "Cerrar misiones",
        inProgress: "en curso",
        done: "hecho",
        toDo: "{count} por hacer",
    },
    card: {
        openEditor: "Abrir el editor de mapas",
        walkThere: "Ir allí",
        stopWalking: "Dejar de caminar",
        chooseAnother: "Elegir otra",
        nobodyHere: "Ahora no hay nadie",
        direction: "{target} está al {direction}, a unos {steps} paso{{s}}",
    },
    directions: {
        north: "norte",
        northEast: "noreste",
        east: "este",
        southEast: "sureste",
        south: "sur",
        southWest: "suroeste",
        west: "oeste",
        northWest: "noroeste",
    },
    log: {
        inProgress: "En curso",
        onMap: "En el mapa",
        tapToStart: "Toca para empezar",
        progress: "{done} de {total} hechas",
        allDone: "Ya has hecho todo aquí. Vuelve cuando haya más.",
        available: "Disponibles",
        done: "Hechas",

        fromHost: "{host} · {room}",
        here: "{room}",
        signInRow: "Inicia sesión para conservar tu progreso en todos tus dispositivos",
        needsAccount: "Requiere: una cuenta",
        nothingHere: "Aquí aún no hay nada que hacer",
    },
    celebration: {
        questComplete: "Misión completada",
        badgeEarned: "Insignia {stamp} conseguida",
        chapterTitle: "Capítulo de bienvenida completado",
        chapterLine: "Has saludado, te has orientado y has dejado tu huella.",
        continue: "Continuar",
    },
    announce: {
        tracking: "En el mapa: {objective}",
        done: "Hecho: {objective}",
        finishedMany: "Has terminado {count} cosas.",
    },
};

export default quest;
