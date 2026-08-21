export type EnvironmentQaRow = {
  request_id: string;
  external_key: string | null;
  title: string;
  priority: string;
  overall_status: string;
  environment_id: number;
  environment_slug: string;
  environment_name: string;
  owner_name: string;
  base_url: string;
  stage: string;
  handoff_id: number | null;
  test_path: string | null;
  test_user: string | null;
  navigation: string | null;
  prerequisites: string | null;
  test_steps: string | null;
  expected_result: string | null;
  automated_coverage: string | null;
  qa_status: string;
  tester_email: string | null;
  tester_name: string | null;
  tested_at: string | null;
  qa_notes: string | null;
};

export function composeEnvironmentTestUrl(
  baseUrl: string,
  storedTestUrl: string | null,
) {
  const base = new URL(baseUrl);
  if (!storedTestUrl?.trim())
    return { url: base.toString().replace(/\/$/, ""), specific: false };
  let path = storedTestUrl.trim();
  if (/^https?:\/\//i.test(path)) {
    try {
      const storedUrl = new URL(path);
      path = `${storedUrl.pathname}${storedUrl.search}${storedUrl.hash}`;
    } catch {
      return { url: base.toString().replace(/\/$/, ""), specific: false };
    }
  }
  if (!path.startsWith("/") || path.startsWith("//") || path === "/")
    return { url: base.toString().replace(/\/$/, ""), specific: false };
  return { url: new URL(path, base).toString(), specific: true };
}
