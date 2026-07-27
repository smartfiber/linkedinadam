export function parseMetricCount(
  value: FormDataEntryValue | null,
  label: string,
) {
  const raw = String(value ?? "").trim();

  if (!/^\d+$/.test(raw)) {
    throw new Error(`${label} must be a non-negative whole number.`);
  }

  const count = Number(raw);

  if (!Number.isSafeInteger(count)) {
    throw new Error(`${label} is too large.`);
  }

  return count;
}

export function parseCapturedAt(value: FormDataEntryValue | null) {
  const capturedAt = String(value ?? "").trim();

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(capturedAt)) {
    throw new Error("Choose a valid capture date and time.");
  }

  return capturedAt;
}
