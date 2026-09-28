import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const quest: DeepPartial<Translation["quest"]> = {
    quests: "Missões",

    welcome: "Boas-vindas",
    close: "Fechar",
    minutes: "{minutes} min",
    acceptedCount: "{count} miss{{ão|ões}} aceit{{a|as}}",
    newActivity: "Novidades nas missões",
    invitation: {
        line: "Boas-vindas! Quer dar uma olhada rápida?",
        secondary: "Uns minutinhos, no seu ritmo.",
        showOptions: "Vamos começar!",
        notNow: "Agora não",
    },
    options: {
        title: "O que você gostaria de fazer?",
        tryAnother: "Quer tentar outra?",
    },
    paths: {
        meet: {
            title: "Conheça alguém",
            description: "Diga oi para quem estiver aqui.",
            objective: "Diga oi para alguém",
            body: "Vá até alguém. Quando a bolha abrir, diga oi.",
            waiting: "Oi enviado. Aguardando resposta.",
            payoff: "Prazer em conhecer você.",
            payoffNeutral: "Você disse oi. Seja bem-vindo.",
            lastTime: "Da última vez você disse oi.",
        },
        explore: {
            title: "Explore este lugar",
            description: "Encontre: {area}.",
            objective: "Encontre: {area}",
            body: "Caminhe até {area} e entre.",
            walk: "Ir até {area}",
            notOnThisMap: "{area} fica em outra sala.",
            payoff: "Você encontrou {area}.",
            lastTime: "Da última vez você encontrou {area}.",
        },
        build: {
            title: "Experimente construir",
            description: "Adicione uma coisa ao mapa.",
            objective: "Adicione uma coisa",
            body: "Abra o editor de mapa e coloque uma coisa.",
            noPosition: "Abra Mapa, depois Editor de mapa.",
            payoff: "Agora é seu. Vai ficar aí.",
            lastTime: "Da última vez você adicionou algo.",
            needs: "Requer: permissão de edição nesta sala",
        },
    },
    stamps: {
        meet: "Primeiro oi",
        explore: "Explorador",
        build: "Construtor",
        badge: "Selo {stamp}",
    },
    pill: {
        open: "Abrir missões",
        close: "Fechar missões",
        inProgress: "em andamento",
        done: "concluída",
        toDo: "{count} a fazer",
    },
    card: {
        openEditor: "Abrir o editor de mapa",
        walkThere: "Ir até lá",
        stopWalking: "Parar de andar",
        chooseAnother: "Escolher outra",
        nobodyHere: "Ninguém aqui agora",
        direction: "{target} fica ao {direction} de você, a cerca de {steps} passo{{s}}",
    },
    directions: {
        north: "norte",
        northEast: "nordeste",
        east: "leste",
        southEast: "sudeste",
        south: "sul",
        southWest: "sudoeste",
        west: "oeste",
        northWest: "noroeste",
    },
    log: {
        inProgress: "Em andamento",
        onMap: "No mapa",
        tapToStart: "Toque para começar",
        progress: "{done} de {total} concluídas",
        allDone: "Você já fez tudo por aqui. Volte quando houver mais.",
        available: "Disponíveis",
        done: "Concluídas",

        fromHost: "{host} · {room}",
        here: "{room}",
        signInRow: "Entre para manter seu progresso em todos os dispositivos",
        needsAccount: "Requer: uma conta",
        nothingHere: "Nada para fazer aqui ainda",
    },
    celebration: {
        questComplete: "Missão concluída",
        badgeEarned: "Selo {stamp} conquistado",
        chapterTitle: "Capítulo de boas-vindas concluído",
        chapterLine: "Você disse oi, se encontrou por aqui e deixou sua marca.",
        continue: "Continuar",
    },
    announce: {
        tracking: "No mapa: {objective}",
        done: "Concluída: {objective}",
        finishedMany: "Você concluiu {count} coisas.",
    },
};

export default quest;
