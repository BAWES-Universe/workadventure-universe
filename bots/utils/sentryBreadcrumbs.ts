import type { Breadcrumb } from "@sentry/node";

/**
 * Sentry keeps the last console lines as breadcrumbs and attaches them to every error. A console line can hold what
 * somebody said or what a tool answered, so none are kept (#1841): errors still carry their stack, and warnings and
 * errors still reach Sentry as logs, whose lines are written without words.
 */
export function withoutConsoleBreadcrumbs(breadcrumb: Breadcrumb): Breadcrumb | null {
    return breadcrumb.category === "console" ? null : breadcrumb;
}
