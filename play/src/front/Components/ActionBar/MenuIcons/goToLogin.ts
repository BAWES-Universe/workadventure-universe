import { analyticsClient } from "../../../Administration/AnalyticsClient";

/** Leaves the room for the sign-in page (the Login button, and the quest sign-in offer). */
export function goToLogin(): void {
    analyticsClient.login();
    window.location.href = "/login";
}
