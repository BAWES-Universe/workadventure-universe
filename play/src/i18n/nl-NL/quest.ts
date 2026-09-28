import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const quest: DeepPartial<Translation["quest"]> = {
    quests: "Quests",

    welcome: "Welkom",
    close: "Sluiten",
    minutes: "{minutes} min",
    acceptedCount: "{count} geaccepteerde quest{{s}}",
    newActivity: "Nieuwe quest-activiteit",
    invitation: {
        line: "Welkom! Zin in een korte rondleiding?",
        secondary: "Een paar minuten, in je eigen tempo.",
        showOptions: "Laten we beginnen!",
        notNow: "Niet nu",
    },
    options: {
        title: "Wat wil je doen?",
        tryAnother: "Nog een proberen?",
    },
    paths: {
        meet: {
            title: "Ontmoet iemand",
            description: "Zeg hoi tegen wie er is.",
            objective: "Zeg hoi tegen iemand",
            body: "Loop naar iemand toe. Zeg hoi als de bubbel opent.",
            waiting: "Hoi verstuurd. Wachten op antwoord.",
            payoff: "Leuk je te ontmoeten.",
            payoffNeutral: "Je zei hoi. Welkom.",
            lastTime: "Vorige keer zei je hoi.",
        },
        explore: {
            title: "Verken deze plek",
            description: "Vind: {area}.",
            objective: "Vind: {area}",
            body: "Loop naar {area} en stap naar binnen.",
            walk: "Loop naar {area}",
            notOnThisMap: "{area} is in een andere ruimte.",
            payoff: "Je hebt {area} gevonden.",
            lastTime: "Vorige keer vond je {area}.",
        },
        build: {
            title: "Probeer te bouwen",
            description: "Voeg één ding toe aan de kaart.",
            objective: "Voeg één ding toe",
            body: "Open de kaarteditor en plaats één ding.",
            noPosition: "Open Tools, dan de kaarteditor.",
            payoff: "Dat is nu van jou. Het blijft staan.",
            lastTime: "Vorige keer heb je iets toegevoegd.",
            needs: "Vereist: bewerkrechten in deze ruimte",
        },
    },
    stamps: {
        meet: "Eerste hoi",
        explore: "Ontdekker",
        build: "Bouwer",
        badge: "Badge {stamp}",
    },
    pill: {
        open: "Quests openen",
        close: "Quests sluiten",
        inProgress: "bezig",
        done: "klaar",
        toDo: "{count} te doen",
    },
    card: {
        openEditor: "Kaarteditor openen",
        walkThere: "Loop erheen",
        stopWalking: "Stop met lopen",
        chooseAnother: "Kies een andere",
        nobodyHere: "Er is nu niemand",
        direction: "{target} ligt ten {direction} van je, ongeveer {steps} stap{{pen}}",
    },
    directions: {
        north: "noorden",
        northEast: "noordoosten",
        east: "oosten",
        southEast: "zuidoosten",
        south: "zuiden",
        southWest: "zuidwesten",
        west: "westen",
        northWest: "noordwesten",
    },
    log: {
        inProgress: "Bezig",
        onMap: "Op de kaart",
        tapToStart: "Tik om te starten",
        progress: "{done} van {total} klaar",
        allDone: "Je hebt hier alles gedaan. Kom terug als er meer is.",
        available: "Beschikbaar",
        done: "Klaar",

        fromHost: "{host} · {room}",
        here: "{room}",
        signInRow: "Log in om je voortgang op al je apparaten te bewaren",
        needsAccount: "Vereist: een account",
        nothingHere: "Hier is nog niets te doen",
    },
    celebration: {
        questComplete: "Quest voltooid",
        badgeEarned: "Badge {stamp} verdiend",
        chapterTitle: "Welkomsthoofdstuk voltooid",
        chapterLine: "Je zei hoi, vond je weg en liet iets achter.",
        continue: "Doorgaan",
    },
    announce: {
        tracking: "Op de kaart: {objective}",
        done: "Klaar: {objective}",
        finishedMany: "Je hebt {count} dingen gedaan.",
    },
};

export default quest;
