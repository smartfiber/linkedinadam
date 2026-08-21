import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const development=readFileSync("app/routes/development.tsx","utf8");
const branch=readFileSync("app/routes/development-branch-sync.tsx","utf8");
const picker=readFileSync("app/components/DevelopmentAttachmentPicker.tsx","utf8");
const css=readFileSync("app/app.css","utf8");

describe("Development UX refinement",()=>{
  it("opens and focuses the single composer from the top-level action",()=>{
    expect(development).toContain("New Development Request");
    expect(development).toContain("onClick={openComposer}");
    expect(development).toContain("composerRef.current.open=true");
    expect(development).toContain("querySelector<HTMLTextAreaElement>");
    expect((development.match(/id="new-request"/g)||[])).toHaveLength(1);
  });
  it("uses a larger work composer without duplicating form logic",()=>{
    expect(development).toContain('rows={9}');
    expect(css).toContain("min-height: 230px");
    expect(css).toContain("resize: vertical");
    expect(css).toContain("grid-column: 1 / -1");
  });
  it("resets form fields and attachment previews only after confirmed creation",()=>{
    expect(development).toContain("if(actionData?.requestId");
    expect(development).toContain("createFormRef.current?.reset()");
    expect(development).toContain("setAttachmentResetKey");
    expect(development).not.toMatch(/actionData\?\.error[^\n]+\.reset\(/);
    expect(picker).toContain("[resetKey]");
    expect(picker).toContain('input.current.value=""');
  });
  it("acknowledges creation and links to the new request",()=>{
    expect(development).toContain("Development Request created.");
    expect(development).toContain("Open Request");
  });
  it("provides accessible intent-specific pending feedback and prevents duplicates",()=>{
    for(const message of ["Generating summary and prompt context…","Generating follow-up prompt…","Analyzing response…"])expect(development).toContain(message);
    expect(development).toContain('aria-busy={isPending("generate_summary"');
    expect(development).toContain('disabled={isPending("generate_prompt"');
    expect(development).toContain('role="status"');
    expect(branch).toContain("Generating sync remediation prompt…");
    expect(branch).toContain("Generating reconciliation prompt…");
    expect(branch).toContain("disabled={reconciliationPending}");
  });
  it("reveals the existing Current Prompt after generation",()=>{
    expect(development).toContain("Prompt generated. Current Prompt is ready below.");
    expect(development).toContain("currentPromptRef.current?.scrollIntoView");
    expect((development.match(/development_prompts/g)||[])).toHaveLength(0);
  });
});
