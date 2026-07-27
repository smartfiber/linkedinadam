export async function refreshContentPlanStatus(
  database: D1Database,
  planId: number,
) {
  const counts = await database
    .prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'proposed' THEN 1 ELSE 0 END)
          AS proposed,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END)
          AS approved,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END)
          AS rejected,
        SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END)
          AS converted
      FROM content_plan_items
      WHERE content_plan_id = ?
    `)
    .bind(planId)
    .first<{
      total: number;
      proposed: number;
      approved: number;
      rejected: number;
      converted: number;
    }>();

  if (!counts?.total) {
    return;
  }

  let status = "proposed";

  if (counts.converted === counts.total) {
    status = "converted";
  } else if (counts.converted > 0) {
    status = "partially_converted";
  } else if (counts.proposed === 0 && counts.approved > 0) {
    status = "approved";
  } else if (counts.rejected === counts.total) {
    status = "rejected";
  }

  await database
    .prepare(`
      UPDATE content_plans
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND status != 'superseded'
    `)
    .bind(status, planId)
    .run();
}
