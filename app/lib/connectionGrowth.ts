export type ImportedProspect = {
  name: string;
  jobTitle: string | null;
  companyName: string | null;
  location: string | null;
  linkedinProfileUrl: string | null;
};

const LINKEDIN_HOSTS = new Set([
  "linkedin.com",
  "www.linkedin.com",
]);

export function normalizeLinkedInProfileUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(
      trimmed.startsWith("http") ? trimmed : `https://${trimmed}`,
    );

    if (!LINKEDIN_HOSTS.has(url.hostname.toLowerCase())) {
      throw new Error("Profile URLs must use linkedin.com.");
    }

    const normalizedPath = url.pathname
      .replace(/\/+/g, "/")
      .replace(/\/$/, "");

    if (!normalizedPath.startsWith("/in/")) {
      throw new Error(
        "Use a LinkedIn member profile URL containing /in/.",
      );
    }

    return `https://www.linkedin.com${normalizedPath}`.toLowerCase();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Use a LinkedIn")
    ) {
      throw error;
    }

    if (
      error instanceof Error &&
      error.message.startsWith("Profile URLs")
    ) {
      throw error;
    }

    throw new Error("Enter a valid LinkedIn profile URL.");
  }
}

function cleanCell(value: string | undefined) {
  const cleaned = (value ?? "").trim();
  return cleaned || null;
}

export function parseProspectRows(value: string) {
  const rows = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!rows.length) {
    throw new Error("Paste at least one prospect.");
  }

  if (rows.length > 100) {
    throw new Error("Import no more than 100 prospects at a time.");
  }

  const prospects: ImportedProspect[] = [];
  const errors: string[] = [];

  rows.forEach((row, index) => {
    const delimiter = row.includes("\t") ? "\t" : ",";
    const cells = row.split(delimiter);
    const name = cells[0]?.trim();

    if (!name) {
      errors.push(`Row ${index + 1} is missing a name.`);
      return;
    }

    let linkedinProfileUrl: string | null = null;

    try {
      linkedinProfileUrl = normalizeLinkedInProfileUrl(
        cells[4] ?? "",
      );
    } catch (error) {
      errors.push(
        `Row ${index + 1}: ${
          error instanceof Error
            ? error.message
            : "Invalid profile URL."
        }`,
      );
      return;
    }

    prospects.push({
      name,
      jobTitle: cleanCell(cells[1]),
      companyName: cleanCell(cells[2]),
      location: cleanCell(cells[3]),
      linkedinProfileUrl,
    });
  });

  if (errors.length) {
    throw new Error(errors.slice(0, 5).join(" "));
  }

  return prospects;
}

export async function findOrCreateProspect(
  db: D1Database,
  prospect: ImportedProspect,
) {
  const normalizedUrl = prospect.linkedinProfileUrl
    ? normalizeLinkedInProfileUrl(prospect.linkedinProfileUrl)
    : null;

  let existing: { id: number } | null;

  if (normalizedUrl) {
    existing = await db
      .prepare(`
        SELECT id
        FROM connection_prospects
        WHERE normalized_profile_url = ?
      `)
      .bind(normalizedUrl)
      .first<{ id: number }>();
  } else {
    existing = await db
      .prepare(`
        SELECT id
        FROM connection_prospects
        WHERE LOWER(name) = LOWER(?)
          AND LOWER(COALESCE(company_name, ''))
            = LOWER(COALESCE(?, ''))
          AND LOWER(COALESCE(job_title, ''))
            = LOWER(COALESCE(?, ''))
        LIMIT 1
      `)
      .bind(
        prospect.name,
        prospect.companyName,
        prospect.jobTitle,
      )
      .first<{ id: number }>();
  }

  if (existing) {
    await db
      .prepare(`
        UPDATE connection_prospects
        SET
          job_title = COALESCE(?, job_title),
          company_name = COALESCE(?, company_name),
          location = COALESCE(?, location),
          linkedin_profile_url =
            COALESCE(?, linkedin_profile_url),
          normalized_profile_url =
            COALESCE(?, normalized_profile_url),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(
        prospect.jobTitle,
        prospect.companyName,
        prospect.location,
        prospect.linkedinProfileUrl,
        normalizedUrl,
        existing.id,
      )
      .run();

    return { id: existing.id, created: false };
  }

  const result = await db
    .prepare(`
      INSERT INTO connection_prospects (
        name,
        job_title,
        company_name,
        location,
        linkedin_profile_url,
        normalized_profile_url
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(
      prospect.name,
      prospect.jobTitle,
      prospect.companyName,
      prospect.location,
      prospect.linkedinProfileUrl,
      normalizedUrl,
    )
    .run();

  return {
    id: Number(result.meta.last_row_id),
    created: true,
  };
}

export async function recordRecommendationEvent(
  db: D1Database,
  recommendationId: number,
  fromStatus: string | null,
  toStatus: string,
  actorName: string,
  note: string | null,
) {
  await db
    .prepare(`
      INSERT INTO connection_recommendation_events (
        recommendation_id,
        from_status,
        to_status,
        actor_name,
        note
      )
      VALUES (?, ?, ?, ?, ?)
    `)
    .bind(
      recommendationId,
      fromStatus,
      toStatus,
      actorName,
      note,
    )
    .run();
}
