import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const quest: DeepPartial<Translation["quest"]> = {
    quests: "Nadawki",

    welcome: "Witaj",
    close: "Začinić",
    minutes: "{minutes} min",
    acceptedCount: "Přiwzate nadawki: {count}",
    newActivity: "Nowe w nadawkach",
    invitation: {
        line: "Witaj! Chceš so krótko rozhladać?",
        secondary: "Por mjeńšinow, w twojim tempje.",
        showOptions: "Započńmy!",
        notNow: "Nětko nic",
    },
    options: {
        title: "Što by rady činił?",
        tryAnother: "Hišće jedyn spytać?",
    },
    paths: {
        meet: {
            title: "Někoho zeznać",
            description: "Postrow někoho, kiž je tu.",
            objective: "Postrow někoho",
            body: "Dźi k někomu. Hdyž so bublina wočini, postrow.",
            waiting: "Postrow pósłany. Čakaj na wotmołwu.",
            payoff: "Rad će zeznaju.",
            payoffNeutral: "Sy postrowił. Witaj tu.",
            lastTime: "Posledni raz sy postrowił.",
        },
        explore: {
            title: "Tute městno wuslědźić",
            description: "Namakaj: {area}.",
            objective: "Namakaj: {area}",
            body: "Dźi k {area} a stupi nutř.",
            walk: "K {area} hić",
            notOnThisMap: "{area} je w druhej rumnosći.",
            payoff: "Sy namakał: {area}.",
            lastTime: "Posledni raz sy namakał: {area}.",
        },
        build: {
            title: "Twarjenje spytać",
            description: "Přidaj karće jednu wěc.",
            objective: "Jednu wěc přidać",
            body: "Wočiń editor karty a staj jednu wěc.",
            noPosition: "Wočiń Tools, potom editor karty.",
            payoff: "To je nětko twoje. Wostanje.",
            lastTime: "Posledni raz sy něšto přidał.",
            needs: "Trjeba: prawa za wobdźěłanje w tutej rumnosći",
        },
    },
    stamps: {
        meet: "Prěni postrow",
        explore: "Wuslědźer",
        build: "Twarc",
        badge: "Znamjo {stamp}",
    },
    pill: {
        open: "Nadawki wočinić",
        close: "Nadawki začinić",
        inProgress: "běži",
        done: "hotowe",
        toDo: "Hišće {count}",
    },
    card: {
        openEditor: "Editor karty wočinić",
        walkThere: "Tam hić",
        stopWalking: "Zastać",
        chooseAnother: "Druhi wubrać",
        nobodyHere: "Tuchwilu nikoho tu njeje",
        direction: "{target}: {direction}, něhdźe {steps} krokow",
    },
    directions: {
        north: "k sewjerej",
        northEast: "k sewjerowuchodej",
        east: "k wuchodej",
        southEast: "k juhowuchodej",
        south: "k juhej",
        southWest: "k juhozapadej",
        west: "k zapadej",
        northWest: "k sewjerozapadej",
    },
    log: {
        inProgress: "Běži",
        onMap: "Na karće",
        tapToStart: "Podótknyć za start",
        progress: "{done} z {total} hotowe",
        allDone: "Sy tu wšitko dokónčił. Přińdź zaso, hdyž wjace budźe.",
        available: "K dispoziciji",
        done: "Hotowe",

        fromHost: "{host} · {room}",
        here: "{room}",
        signInRow: "Přizjew so, zo by swój postup na wšěch gratach wobchował",
        needsAccount: "Trjeba: konto",
        nothingHere: "Tu hišće ničo činić njeje",
    },
    celebration: {
        questComplete: "Nadawk hotowy",
        badgeEarned: "Znamjo {stamp} dobyte",
        chapterTitle: "Kapitl Witaj dokónčeny",
        chapterLine: "Sy postrowił, puć namakał a swój slěd zawostajił.",
        continue: "Dale",
    },
    announce: {
        tracking: "Na karće: {objective}",
        done: "Hotowe: {objective}",
        finishedMany: "Sy dokónčił wěcy: {count}.",
    },
};

export default quest;
