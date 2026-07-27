export const CONTENT_TIME_ZONE = "America/Chicago";

export type ContentWorkflowDraft = {
  status: string;
  scheduled_for: string | null;
  image_key: string | null;
  image_status: string | null;
  body?: string;
};

export type ContentOperationalState =
  | "published"
  | "unscheduled"
  | "needs_post_approval"
  | "needs_image_approval"
  | "ready"
  | "overdue";

export function normalizeScheduledFor(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    throw new Error("Choose a valid schedule date and time.");
  }

  return trimmed;
}

export function getContentOperationalState(
  draft: ContentWorkflowDraft,
  currentLocalDateTime: string,
): ContentOperationalState {
  if (draft.status === "published") {
    return "published";
  }

  if (!draft.scheduled_for) {
    return "unscheduled";
  }

  if (draft.status !== "approved") {
    return "needs_post_approval";
  }

  if (
    draft.image_key &&
    draft.image_status !== "approved"
  ) {
    return "needs_image_approval";
  }

  return draft.scheduled_for < currentLocalDateTime
    ? "overdue"
    : "ready";
}

export function getPublishBlocker(
  draft: ContentWorkflowDraft,
) {
  if ("body" in draft && !draft.body?.trim()) {
    return "Add post copy before approving or publishing this draft.";
  }

  if (draft.status !== "approved") {
    return "A post must be approved before publication.";
  }

  if (!draft.scheduled_for) {
    return "Schedule the post before marking it published.";
  }

  if (
    draft.image_key &&
    draft.image_status !== "approved"
  ) {
    return "Approve the attached image before marking the post published.";
  }

  return null;
}
