import { getSafeOpenAIErrorMessage } from "./aiErrors.server";
import { validateGeneratedPlan } from "./contentPlanner";
import { generateLinkedInPost } from "./generateLinkedInPost.server";
import { generateStrategyBrief } from "./generateStrategyBrief.server";
import { generateWeeklyContentPlan } from "./generateWeeklyContentPlan.server";

export type OrchestrationEnvironment = {
  linkedinadam_db: D1Database;
  OPENAI_API_KEY?: string;
};

type Run = {
  id: number;
  employee_id: number;
  week_start: string;
  playbook_snapshot: string;
  requested_by: string;
};

type Employee = {
  name: string;
  role_name: string;
  writing_style_prompt_override: string | null;
};

function snapshotValue(
  snapshot: Record<string, unknown>,
  key: string,
) {
  const value = snapshot[key];
  return typeof value === "string" ? value : null;
}

function snapshotNumber(
  snapshot: Record<string, unknown>,
  key: string,
) {
  const value = Number(snapshot[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

async function stageVersion(
  db: D1Database,
  runId: number,
  type: string,
) {
  const row = await db
    .prepare(`
      SELECT COALESCE(MAX(version), 0) AS version
      FROM orchestration_stages
      WHERE orchestration_run_id = ? AND stage_type = ?
    `)
    .bind(runId, type)
    .first<{ version: number }>();
  return (row?.version ?? 0) + 1;
}

async function getRunContext(db: D1Database, runId: number) {
  const run = await db
    .prepare(`
      SELECT id, employee_id, week_start, playbook_snapshot, requested_by
      FROM orchestration_runs
      WHERE id = ? AND status != 'superseded'
    `)
    .bind(runId)
    .first<Run>();
  if (!run) throw new Error("The orchestration run could not be found.");
  const employee = await db
    .prepare(`
      SELECT name, role_name, writing_style_prompt_override
      FROM employees WHERE id = ? AND status = 'active'
    `)
    .bind(run.employee_id)
    .first<Employee>();
  if (!employee) throw new Error("The employee is inactive or missing.");
  return {
    run,
    employee,
    snapshot: JSON.parse(run.playbook_snapshot) as Record<string, unknown>,
  };
}

async function latestApprovedStage(
  db: D1Database,
  runId: number,
  type: string,
) {
  return db
    .prepare(`
      SELECT id, version, output_json
      FROM orchestration_stages
      WHERE orchestration_run_id = ?
        AND stage_type = ?
        AND status = 'approved'
      ORDER BY version DESC LIMIT 1
    `)
    .bind(runId, type)
    .first<{
      id: number;
      version: number;
      output_json: string;
    }>();
}

export async function runStrategyStage(
  env: OrchestrationEnvironment,
  runId: number,
  actor: string,
  instructions: string | null,
) {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  const { run, employee, snapshot } = await getRunContext(
    env.linkedinadam_db,
    runId,
  );
  const version = await stageVersion(env.linkedinadam_db, runId, "strategy");
  const input = {
    employee: employee.name,
    role: employee.role_name,
    week_start: run.week_start,
    playbook_snapshot: snapshot,
    instructions,
  };
  const stage = await env.linkedinadam_db
    .prepare(`
      INSERT INTO orchestration_stages (
        orchestration_run_id, stage_type, version, status, model,
        input_json, started_at
      )
      VALUES (?, 'strategy', ?, 'running', 'gpt-5-mini', ?, CURRENT_TIMESTAMP)
      RETURNING id
    `)
    .bind(runId, version, JSON.stringify(input))
    .first<{ id: number }>();
  if (!stage) throw new Error("The strategy stage could not be saved.");

  try {
    const output = await generateStrategyBrief({
      apiKey: env.OPENAI_API_KEY,
      employeeName: employee.name,
      roleName: employee.role_name,
      weekStart: run.week_start,
      playbookSnapshot: snapshot,
      instructions,
    });
    await env.linkedinadam_db.batch([
      env.linkedinadam_db
        .prepare(`
          UPDATE orchestration_stages SET status='needs_review',
            output_json=?, completed_at=CURRENT_TIMESTAMP,
            updated_at=CURRENT_TIMESTAMP WHERE id=?
        `)
        .bind(JSON.stringify(output), stage.id),
      env.linkedinadam_db
        .prepare(`
          UPDATE orchestration_stages SET status='invalidated',
            updated_at=CURRENT_TIMESTAMP
          WHERE orchestration_run_id=? AND stage_type IN ('planner','drafting')
            AND status != 'invalidated'
        `)
        .bind(runId),
      env.linkedinadam_db
        .prepare(`
          UPDATE orchestration_runs SET status='strategy_review',
            updated_at=CURRENT_TIMESTAMP WHERE id=?
        `)
        .bind(runId),
      env.linkedinadam_db
        .prepare(`
          INSERT INTO orchestration_events (
            orchestration_run_id,orchestration_stage_id,event_type,actor_name,detail
          ) VALUES (?,?,'strategy_generated',?,?)
        `)
        .bind(runId, stage.id, actor, `Strategy version ${version}`),
    ]);
  } catch (error) {
    const safe = getSafeOpenAIErrorMessage(error, "plan");
    await env.linkedinadam_db.batch([
      env.linkedinadam_db.prepare(`
        UPDATE orchestration_stages SET status='failed',safe_error=?,
          completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).bind(safe, stage.id),
      env.linkedinadam_db.prepare(`
        UPDATE orchestration_runs SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).bind(runId),
    ]);
    throw new Error(safe);
  }
}

export async function runPlannerStage(
  env: OrchestrationEnvironment,
  runId: number,
  actor: string,
) {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  const { run, employee, snapshot } = await getRunContext(env.linkedinadam_db, runId);
  const strategy = await latestApprovedStage(env.linkedinadam_db, runId, "strategy");
  if (!strategy) throw new Error("Approve the Strategy Agent output first.");
  const strategyOutput = JSON.parse(strategy.output_json);
  const version = await stageVersion(env.linkedinadam_db, runId, "planner");
  const input = { strategy_version: strategy.version, strategy: strategyOutput };
  const stage = await env.linkedinadam_db.prepare(`
    INSERT INTO orchestration_stages (
      orchestration_run_id,stage_type,version,status,model,input_json,started_at
    ) VALUES (?,'planner',?,'running','gpt-5-mini',?,CURRENT_TIMESTAMP)
    RETURNING id
  `).bind(runId, version, JSON.stringify(input)).first<{id:number}>();
  if (!stage) throw new Error("The planner stage could not be saved.");

  try {
    const generated = await generateWeeklyContentPlan({
      apiKey: env.OPENAI_API_KEY,
      employeeName: employee.name,
      roleName: employee.role_name,
      weekStart: run.week_start,
      originalPostTarget: snapshotNumber(snapshot, "weekly_original_posts"),
      shortPostTarget: snapshotNumber(snapshot, "weekly_short_posts"),
      primaryAudience: snapshotValue(snapshot, "primary_audience"),
      primaryExpertise: snapshotValue(snapshot, "primary_expertise"),
      contentSources: snapshotValue(snapshot, "content_sources"),
      primaryPostFormats: snapshotValue(snapshot, "primary_post_formats"),
      exampleTopics: JSON.stringify(strategyOutput.content_pillars ?? []),
      positioningStatement: String(strategyOutput.point_of_view ?? ""),
      recurringSeries: snapshotValue(snapshot, "recurring_series"),
      softCta: String(strategyOutput.cta_strategy ?? ""),
      guardrail: JSON.stringify(strategyOutput.prohibited_claims ?? []),
      recentTopics: [],
      occupiedTimes: [],
      analyticsInsights: [],
      planningInstructions:
        `Follow approved Strategy Agent version ${strategy.version}: ${strategy.output_json}`,
    });
    validateGeneratedPlan(generated.items, {
      weekStart: run.week_start,
      originalPostTarget: snapshotNumber(snapshot, "weekly_original_posts"),
      shortPostTarget: snapshotNumber(snapshot, "weekly_short_posts"),
      recentTopics: [],
      occupiedTimes: [],
    });
    const output = { strategy_stage_id: strategy.id, items: generated.items };
    await env.linkedinadam_db.batch([
      env.linkedinadam_db.prepare(`
        UPDATE orchestration_stages SET status='needs_review',output_json=?,
          completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).bind(JSON.stringify(output), stage.id),
      env.linkedinadam_db.prepare(`
        INSERT INTO orchestration_handoffs (
          orchestration_run_id,from_stage_id,to_stage_type,payload_json
        ) VALUES (?,?,'planner',?)
      `).bind(runId, strategy.id, strategy.output_json),
      env.linkedinadam_db.prepare(`
        UPDATE orchestration_runs SET status='planner_review',updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).bind(runId),
      env.linkedinadam_db.prepare(`
        INSERT INTO orchestration_events (
          orchestration_run_id,orchestration_stage_id,event_type,actor_name,detail
        ) VALUES (?,?,'planner_generated',?,?)
      `).bind(runId, stage.id, actor, `Planner version ${version}`),
    ]);
  } catch (error) {
    const safe = getSafeOpenAIErrorMessage(error, "plan");
    await env.linkedinadam_db.batch([
      env.linkedinadam_db.prepare(`
        UPDATE orchestration_stages SET status='failed',safe_error=?,
          completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).bind(safe, stage.id),
      env.linkedinadam_db.prepare(`
        UPDATE orchestration_runs SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).bind(runId),
    ]);
    throw new Error(safe);
  }
}

export async function runDraftingStage(
  env: OrchestrationEnvironment,
  runId: number,
  actor: string,
) {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  const db = env.linkedinadam_db;
  const { run, employee, snapshot } = await getRunContext(db, runId);
  const strategy = await latestApprovedStage(db, runId, "strategy");
  const planner = await latestApprovedStage(db, runId, "planner");
  if (!strategy || !planner) throw new Error("Approve Strategy and Planner outputs first.");
  const existing = await db.prepare(
    "SELECT COUNT(*) AS count FROM orchestration_draft_items WHERE orchestration_run_id=?"
  ).bind(runId).first<{count:number}>();
  if (existing?.count) throw new Error("This run already produced drafts.");
  const plan = JSON.parse(planner.output_json) as {
    items: Array<{
      post_format: "original_post"|"short_post"; topic:string; angle:string;
      rationale:string; suggested_scheduled_for:string;
    }>;
  };
  const version = await stageVersion(db, runId, "drafting");
  const input = {
    strategy_stage_id: strategy.id,
    planner_stage_id: planner.id,
    strategy: JSON.parse(strategy.output_json),
    plan,
  };
  const stage = await db.prepare(`
    INSERT INTO orchestration_stages (
      orchestration_run_id,stage_type,version,status,model,input_json,started_at
    ) VALUES (?,'drafting',?,'running','gpt-5-mini',?,CURRENT_TIMESTAMP)
    RETURNING id
  `).bind(runId, version, JSON.stringify(input)).first<{id:number}>();
  if (!stage) throw new Error("The drafting stage could not be saved.");

  const createdDraftIds: number[] = [];
  try {
    const outputs = [];
    for (const [index, item] of plan.items.entries()) {
      const body = await generateLinkedInPost({
        apiKey: env.OPENAI_API_KEY,
        employeeName: employee.name,
        roleName: employee.role_name,
        topic: `${item.topic}\nAngle: ${item.angle}\nApproved strategy: ${strategy.output_json}`,
        postFormat: item.post_format,
        primaryAudience: snapshotValue(snapshot, "primary_audience"),
        primaryExpertise: snapshotValue(snapshot, "primary_expertise"),
        contentSources: snapshotValue(snapshot, "content_sources"),
        primaryPostFormats: snapshotValue(snapshot, "primary_post_formats"),
        exampleTopics: snapshotValue(snapshot, "example_topics"),
        positioningStatement: snapshotValue(snapshot, "positioning_statement"),
        recurringSeries: snapshotValue(snapshot, "recurring_series"),
        leadMagnet: snapshotValue(snapshot, "lead_magnet"),
        softCta: snapshotValue(snapshot, "soft_cta"),
        guardrail: snapshotValue(snapshot, "guardrail"),
        writingStylePrompt:
          employee.writing_style_prompt_override ||
          snapshotValue(snapshot, "writing_style_prompt"),
      });
      const draft = await db.prepare(`
        INSERT INTO content_drafts (
          employee_id,title,body,post_format,topic,status,scheduled_for
        ) VALUES (?,?,?,?,?,'draft',?) RETURNING id
      `).bind(
        run.employee_id,item.topic,body,item.post_format,item.topic,
        item.suggested_scheduled_for
      ).first<{id:number}>();
      if (!draft) throw new Error("A generated draft could not be saved.");
      createdDraftIds.push(draft.id);
      await db.prepare(`
        INSERT INTO orchestration_draft_items (
          orchestration_run_id,drafting_stage_id,sequence,content_draft_id
        ) VALUES (?,?,?,?)
      `).bind(runId,stage.id,index+1,draft.id).run();
      outputs.push({ sequence:index+1, content_draft_id:draft.id, body });
    }
    await db.batch([
      db.prepare(`
        UPDATE orchestration_stages SET status='needs_review',output_json=?,
          completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).bind(JSON.stringify({items:outputs}),stage.id),
      db.prepare(`
        INSERT INTO orchestration_handoffs (
          orchestration_run_id,from_stage_id,to_stage_type,payload_json
        ) VALUES (?,?,'drafting',?)
      `).bind(runId,planner.id,planner.output_json),
      db.prepare(`
        UPDATE orchestration_runs SET status='drafting_review',updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).bind(runId),
      db.prepare(`
        INSERT INTO orchestration_events (
          orchestration_run_id,orchestration_stage_id,event_type,actor_name,detail
        ) VALUES (?,?,'drafts_generated',?,?)
      `).bind(runId,stage.id,actor,`${outputs.length} drafts generated`),
    ]);
  } catch (error) {
    const safe = getSafeOpenAIErrorMessage(error, "post");
    for (const draftId of createdDraftIds) {
      await db.prepare("DELETE FROM content_drafts WHERE id = ?")
        .bind(draftId)
        .run();
    }
    await db.batch([
      db.prepare(`
        UPDATE orchestration_stages SET status='failed',safe_error=?,
          completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).bind(safe,stage.id),
      db.prepare(`
        UPDATE orchestration_runs SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).bind(runId),
    ]);
    throw new Error(safe);
  }
}
