import { describe,expect,it } from "vitest";
import { readFileSync } from "node:fs";
const development=readFileSync("app/routes/development.tsx","utf8");
const branch=readFileSync("app/routes/development-branch-sync.tsx","utf8");
const consoleRoute=readFileSync("app/routes/development-console.tsx","utf8");
const css=readFileSync("app/app.css","utf8");
describe("Development Copilot UI",()=>{
  it("quick-captures requests in Needs Prompt with multiple images",()=>{expect(development).toContain("Request / Idea");expect(development).toContain('name="attachments"');expect(development).toContain("multiple");expect(development).toContain("Default work state:");});
  it("supports prompt history, model responses, failures, archive and owner delete",()=>{for(const label of ["Generate Prompt","Copy Prompt","Mark Sent","Add Response","Report Failure","Generate Follow-up Prompt","Archive","Permanent delete"])expect(development).toContain(label);});
  it("shares the Development Conversation with the safe console",()=>{expect(development).toContain("Development Conversation");expect(consoleRoute).toContain("PERSISTENT REQUEST THREAD");expect(consoleRoute).toContain("Not connected:");});
  it("adds row and batch Branch Sync prompts without replacing the matrix",()=>{expect(branch).toContain("Generate Sync Prompt");expect(branch).toContain("Generate Reconciliation Prompt for selected");expect(branch).toContain('className="branch-matrix"');});
  it("bounds sticky headers to their table scroll container so row one is visible",()=>{expect(css).toContain(".development-table-panel .table-wrap { max-height");expect(css).toContain(".branch-matrix-wrap { max-width: 1800px; max-height");expect(css).toContain(".branch-matrix th { position: sticky; top: 0");expect(css).toContain("scroll-margin-top: 48px");});
});
