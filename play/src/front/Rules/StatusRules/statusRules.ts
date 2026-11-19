import { AvailabilityStatus } from "@workadventure/messages";

export interface StatusRulesVerificationInterface {
    canChangeStatus: (actualStatus: AvailabilityStatus) => { to: (futureStatus: AvailabilityStatus) => boolean };
}

export type TimedRules = {
    applyIn: number;
    rule: () => void;
};

const basicStatus: Array<AvailabilityStatus> = [
    AvailabilityStatus.SPEAKER,
    AvailabilityStatus.UNCHANGED,
    AvailabilityStatus.SILENT,
    AvailabilityStatus.AWAY,
    AvailabilityStatus.UNRECOGNIZED,
    AvailabilityStatus.DENY_PROXIMITY_MEETING,
];

/**
 * Statuses that availabilityStatusStore puts above a requested status (Busy, Do not disturb, Back in a moment).
 * The user keeps their requested status while one of these applies, so moving between them goes both ways.
 */
const overridingStatus: Array<AvailabilityStatus> = [
    AvailabilityStatus.SPEAKER,
    AvailabilityStatus.SILENT,
    AvailabilityStatus.DENY_PROXIMITY_MEETING,
];

const statusForbiddenFromRequestedStatus: Array<AvailabilityStatus> = basicStatus.filter(
    (status) => !overridingStatus.includes(status)
);

export type RequestedStatus =
    | AvailabilityStatus.DO_NOT_DISTURB
    | AvailabilityStatus.BACK_IN_A_MOMENT
    | AvailabilityStatus.BUSY;

export const setableStatus: Array<AvailabilityStatus> = [
    AvailabilityStatus.BUSY,
    AvailabilityStatus.DO_NOT_DISTURB,
    AvailabilityStatus.BACK_IN_A_MOMENT,
];

const invalidTransition: Map<AvailabilityStatus, Array<AvailabilityStatus>> = new Map([
    [AvailabilityStatus.UNCHANGED, [...setableStatus]],
    [AvailabilityStatus.ONLINE, []],
    [AvailabilityStatus.SILENT, []],
    [AvailabilityStatus.AWAY, [...setableStatus]],
    [AvailabilityStatus.JITSI, []],
    [AvailabilityStatus.BBB, []],
    [AvailabilityStatus.DENY_PROXIMITY_MEETING, []],
    [AvailabilityStatus.SPEAKER, []],
    [AvailabilityStatus.BUSY, [...statusForbiddenFromRequestedStatus]],
    [AvailabilityStatus.DO_NOT_DISTURB, [...statusForbiddenFromRequestedStatus]],
    [AvailabilityStatus.BACK_IN_A_MOMENT, [...statusForbiddenFromRequestedStatus]],
    [AvailabilityStatus.UNRECOGNIZED, []],
    [AvailabilityStatus.LIVEKIT, []],
]);

export const StatusRules = {
    canChangeStatus: (actualStatus: AvailabilityStatus) => {
        const listOfInvalidTransition: Array<AvailabilityStatus> = invalidTransition.get(actualStatus) || [];
        return {
            to: (futureStatus: AvailabilityStatus): boolean => {
                return !listOfInvalidTransition.includes(futureStatus);
            },
        };
    },
};
