import OpenAI from "openai";

type AIOperation = "post" | "image" | "plan";

function safeDiagnosticValue(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  return /^[a-zA-Z0-9_.-]{1,80}$/.test(value)
    ? value
    : null;
}

function getSafeAPIDiagnostic(error: {
  status?: number;
  code?: unknown;
  type?: unknown;
  param?: unknown;
}) {
  const fields = [
    `status=${error.status ?? "unknown"}`,
    safeDiagnosticValue(error.code)
      ? `code=${safeDiagnosticValue(error.code)}`
      : null,
    safeDiagnosticValue(error.type)
      ? `type=${safeDiagnosticValue(error.type)}`
      : null,
    safeDiagnosticValue(error.param)
      ? `param=${safeDiagnosticValue(error.param)}`
      : null,
  ].filter(Boolean);

  return fields.join(", ");
}

export function getSafeOpenAIErrorMessage(
  error: unknown,
  operation: AIOperation,
) {
  const subject =
    operation === "image"
      ? "image"
      : operation === "plan"
        ? "weekly content plan"
        : "post draft";

  if (error instanceof OpenAI.AuthenticationError) {
    return `OpenAI could not authenticate while generating the ${subject}. Check the configured Worker secret.`;
  }

  if (error instanceof OpenAI.PermissionDeniedError) {
    return `The OpenAI project does not have access to the model required to generate this ${subject}.`;
  }

  if (error instanceof OpenAI.NotFoundError) {
    return `The configured OpenAI model for this ${subject} is unavailable.`;
  }

  if (error instanceof OpenAI.RateLimitError) {
    if (
      error.code === "insufficient_quota" ||
      error.type === "insufficient_quota"
    ) {
      return `OpenAI billing or quota prevented generation of the ${subject}. Check the API project's billing and usage limits.`;
    }

    return `OpenAI is rate-limiting ${subject} generation. Wait briefly and try again.`;
  }

  if (
    error instanceof OpenAI.APIConnectionTimeoutError ||
    error instanceof OpenAI.APIConnectionError
  ) {
    return `OpenAI could not be reached while generating the ${subject}. Try again shortly.`;
  }

  if (error instanceof OpenAI.BadRequestError) {
    const message = error.message.toLowerCase();

    if (
      message.includes("organization") &&
      message.includes("verif")
    ) {
      return `The OpenAI organization must be verified before it can generate this ${subject}. Complete organization verification in the OpenAI Platform settings.`;
    }

    if (
      message.includes("model") &&
      (
        message.includes("access") ||
        message.includes("does not exist") ||
        message.includes("not found")
      )
    ) {
      return `The OpenAI project does not have access to the configured model for this ${subject}.`;
    }

    if (
      message.includes("safety") ||
      message.includes("content policy") ||
      message.includes("moderation")
    ) {
      return `OpenAI declined this ${subject} request under its content-safety rules. Adjust the topic or visual instructions and try again.`;
    }

    if (
      message.includes("parameter") ||
      message.includes("unsupported") ||
      message.includes("invalid value")
    ) {
      return `OpenAI rejected a generation setting for the ${subject}. The model configuration needs to be updated.`;
    }

    return `OpenAI rejected the ${subject} request (${getSafeAPIDiagnostic(error)}).`;
  }

  if (error instanceof OpenAI.APIError && error.status === 429) {
    return `OpenAI billing, quota, or rate limits prevented generation of the ${subject}. Check the API project and try again.`;
  }

  if (error instanceof OpenAI.APIError && error.status >= 500) {
    return `OpenAI encountered a temporary error while generating the ${subject}. Try again shortly.`;
  }

  return `The ${subject} could not be generated. Try again or review the Worker logs.`;
}
