export class LinkedInAPIError extends Error {
  status: number;
  code: string;
  uncertain: boolean;

  constructor(
    message: string,
    options: {
      status?: number;
      code: string;
      uncertain?: boolean;
    },
  ) {
    super(message);
    this.name = "LinkedInAPIError";
    this.status = options.status ?? 0;
    this.code = options.code;
    this.uncertain = options.uncertain ?? false;
  }
}

export function getSafeLinkedInErrorMessage(
  error: unknown,
  operation: "connect" | "publish" = "publish",
) {
  const fallback =
    operation === "connect"
      ? "The LinkedIn connection could not be completed."
      : "LinkedIn could not publish this post.";

  if (!(error instanceof LinkedInAPIError)) {
    return `${fallback} Try again shortly.`;
  }

  if (error.uncertain) {
    return "LinkedIn may have received this post, but confirmation was interrupted. Check LinkedIn before resolving or retrying.";
  }

  if (error.status === 401) {
    return "The LinkedIn connection has expired or was revoked. Reconnect the employee’s account.";
  }

  if (error.status === 403) {
    return "LinkedIn denied this action. Reconnect the account and confirm Share on LinkedIn access is enabled.";
  }

  if (error.status === 429) {
    return "LinkedIn is rate-limiting publication. Wait before trying again.";
  }

  if (error.status >= 500) {
    return "LinkedIn is temporarily unavailable. Try again later.";
  }

  if (error.code === "image_rejected") {
    return "LinkedIn rejected the approved image. Check its format and dimensions.";
  }

  if (error.code === "post_rejected") {
    return "LinkedIn rejected the post. Review the copy and image, then try again.";
  }

  if (error.code === "wrong_account") {
    return "That LinkedIn member does not match this employee’s existing connection or is already assigned to another employee.";
  }

  return fallback;
}
