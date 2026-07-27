export async function findScheduleConflict(
  database: D1Database,
  employeeId: number,
  scheduledFor: string | null,
  excludedDraftId?: number,
) {
  if (!scheduledFor) {
    return null;
  }

  return database
    .prepare(`
      SELECT id, title, scheduled_for
      FROM content_drafts
      WHERE employee_id = ?
        AND status != 'published'
        AND scheduled_for IS NOT NULL
        AND ABS(
          (
            julianday(REPLACE(scheduled_for, 'T', ' '))
            - julianday(REPLACE(?, 'T', ' '))
          ) * 1440
        ) < 30
        AND (? IS NULL OR id != ?)
      ORDER BY scheduled_for ASC
      LIMIT 1
    `)
    .bind(
      employeeId,
      scheduledFor,
      excludedDraftId ?? null,
      excludedDraftId ?? null,
    )
    .first<{
      id: number;
      title: string | null;
      scheduled_for: string;
    }>();
}
