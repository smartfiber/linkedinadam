# Net-X Back Office foundation

LinkedInAdam remains the existing Worker and repository. This foundation adds
the first internal Development Control Center without changing the existing
LinkedIn publishing or content workflows.

## Cloudflare Access

Production Back Office runtime variables are defined in `wrangler.json`, which
is the source of truth used by automatic Workers Builds from `main`. Keep the
Access team domain, Access audience, owner/admin mappings, and production
environment there so a future `wrangler deploy` cannot drop dashboard-only
text bindings. Secrets remain encrypted Worker secrets and must never be added
to Wrangler source configuration.

Production requests are expected to arrive through Cloudflare Access. The
Worker independently verifies the `Cf-Access-Jwt-Assertion` signature against
Cloudflare Access JWKS before accepting any identity. It checks the configured
issuer, audience, RS256 algorithm, expiration, not-before (when supplied), and
required subject/email claims. Email/name/subject headers are not
authoritative and are ignored for identity after JWT verification.

Configure these server-only Worker values:

```text
CLOUDFLARE_ACCESS_TEAM_DOMAIN=your-team.cloudflareaccess.com
CLOUDFLARE_ACCESS_AUD=<Access application audience tag>
```

The team domain is the Access hostname, with or without `https://`. The
audience is the tag shown in the Access application's JWT/OIDC configuration.
Keys are obtained from
`https://<team-domain>/cdn-cgi/access/certs`; the JOSE remote-key provider
caches keys safely and refreshes for key rotation or an unknown key id. JWKS
retrieval or verification failure fails closed.

After verification, the JWT email is mapped to `OWNER`, `ADMIN`, `DEVELOPER`,
`MARKETING`, `SALES`, or `VIEWER`. Unmapped identities fail closed. Configure
email mappings as Worker environment variables/secrets; never submit an actor
name or role from a form and treat it as identity.

The LinkedIn OAuth callback remains the only public callback path. It validates
the one-time OAuth state before changing a LinkedIn connection. Configure a
Cloudflare Access policy for the internal application, but do not rely on that
dashboard policy as the Worker authentication mechanism: the Worker performs
its own JWT verification. If required by the LinkedIn flow, bypass only the
callback path.

### Local development

Use an explicit loopback-only identity. This mechanism requires all of the
following:

```sh
BACKOFFICE_LOCAL_AUTH=true \
BACKOFFICE_ENVIRONMENT=development \
BACKOFFICE_LOCAL_USER_EMAIL=adam@net-x.io \
BACKOFFICE_LOCAL_USER_NAME=Adam \
BACKOFFICE_OWNER_EMAIL=adam@net-x.io \
npm run dev
```

The helper also requires a `localhost`, `127.0.0.1`, or `[::1]` request. It
cannot activate for a production hostname, and production defaults to fail
closed when Access headers or a configured role are absent.

## Development migration

Migration `0015_add_development_foundation.sql` adds normalized requests,
external links, branch-state placeholders, QA handoffs, append-only approvals,
and development activity events. It intentionally does not contact GitHub or
populate branch state.

For a local D1 database, run from the repository root:

```sh
npx wrangler d1 migrations apply linkedinadam-db --local
```

For the remote production database, review the SQL and apply it manually only
after a backup/rehearsal:

```sh
npx wrangler d1 migrations apply linkedinadam-db --remote
```

Production migration application is intentionally not part of deployment and
was not performed by this change.

## Approval safety

Development records and future agent actions default to human approval. A
merge, production action, external email, LinkedIn publication, newsletter
send, or destructive data change must not be inferred from a draft or from a
provider event. Existing LinkedIn autopilot behavior is preserved for this
slice and remains a separately tracked hardening item.

## Future GitHub adapter

The development schema is ready for a read-only GitHub App installed only on
`colossalbreacker/net-x`. A future adapter should combine webhooks with the
existing scheduled polling capability, preserve provider snapshots, and keep
Main merge state separate from Main verification.

## Read-only GitHub development sync

The Development Control Center has a server-only GitHub App adapter for the
`colossalbreacker/net-x` repository. It reads issues, pull requests, reviews,
checks, changed files, branches, and comparisons. It never requests or
performs GitHub writes.

Configure the repository identity as Worker variables (these are also the
defaults):

```text
GITHUB_REPOSITORY_OWNER=colossalbreacker
GITHUB_REPOSITORY_NAME=net-x
GITHUB_SYNC_ENABLED=true
```

The read-only GitHub App requires these server-only values:

```text
GITHUB_APP_ID=<GitHub App id>
GITHUB_APP_PRIVATE_KEY=<GitHub App private key>
GITHUB_APP_INSTALLATION_ID=<installation id for colossalbreacker/net-x>
```

Create the App under the account or organization that should control it. Use
the deployed Worker URL as the homepage, do not request user authorization,
and leave webhooks inactive. Set **Repository permissions** to `Read-only` for
**Contents** (commits, branches, and compare), **Issues**, **Pull requests**
(including reviews), **Checks**, and **Commit statuses**. Metadata read access
is supplied by GitHub. Give the App no organization or account permissions.
Select **Only on this account** when the App is owned by the target account;
otherwise select **Any account** so the repository owner can approve it.

From the App's **Install App** page, install it using **Only select
repositories** and choose only `colossalbreacker/net-x`. Generate a private
key, then copy the App ID from the App settings and the numeric installation ID
from the installation settings URL. The downloaded GitHub PKCS#1 PEM key can
be used directly; the adapter converts it to PKCS#8 in memory for Web Crypto.

Add the three credentials with `wrangler secret put GITHUB_APP_ID`, `wrangler
secret put GITHUB_APP_PRIVATE_KEY`, and `wrangler secret put
GITHUB_APP_INSTALLATION_ID`. The repository variables and
`GITHUB_SYNC_ENABLED` are committed in `wrangler.json`. Never prefix any of
these values with `VITE_`, commit a downloaded PEM file, or return the values
from a route loader. Before enabling production sync, confirm migrations
`0015_add_development_foundation.sql` and `0016_add_github_sync.sql` have been
applied to the remote D1 database after the documented backup/rehearsal.

Until those values exist, scheduled sync reports a configuration error and
does not create records. If webhooks are enabled later, create a separate
random `GITHUB_WEBHOOK_SECRET`, subscribe only to Issues, Pull requests, Pull
request reviews, Check runs/suites, and Push, and connect the public endpoint
only after the signature-verifying/idempotent delivery route is registered.

The existing Worker cron provides the polling fallback. Repeated polls are
idempotent and append meaningful activity only when GitHub timestamps change.
Webhook handling remains a future signed webhook seam and is not enabled by
this change.

## Existing LinkedIn / Content organization

Existing routes and tables remain authoritative and are not duplicated:

| Existing entity/feature | Current purpose | Future Back Office area | Action |
| --- | --- | --- | --- |
| `employees`, `linkedin_connections` | employee profiles and LinkedIn identities | Content & LinkedIn / Network | Reuse |
| `connection_prospects`, recommendations, conversations, signals, handoffs | network and lead signals | People / Engagement | Reuse later |
| `content_drafts`, review/schedule history | draft, review, and scheduling workflow | Content | Reuse |
| `content_plans`, planner routes | weekly planning | Content | Reuse |
| orchestration tables/routes | staged post orchestration | Publishing | Reuse |
| `post_metric_snapshots`, analytics route | performance history | Analytics | Reuse |
| automation tables, autopilot | existing scheduled automation | Automation | Preserve |

The Command Center navigation groups these existing routes under
`Content & LinkedIn`; bookmarks and route URLs remain unchanged. People,
Outreach, and Newsletters remain clearly marked Coming Soon.

### Route and service inventory

| Existing route | Working area | Primary tables/services |
| --- | --- | --- |
| `/` and `/content/:draftId/edit` | drafts, creation, image generation, review, scheduling, publishing, engagement queues, conversations/signals/handoffs, and activity | `content_drafts`, `content_review_history`, `content_schedule_history`, `engagement_opportunities`, `conversations`, `buying_signals`, `lead_handoffs`, `activity_events`; `generateLinkedInPost.server`, `generateLinkedInImage.server`, `linkedinPublishing.server`, `contentWorkflow.server` |
| `/auth/linkedin/start`, `/auth/linkedin/callback` | LinkedIn OAuth | `linkedin_oauth_states`, `linkedin_connections`; `linkedinOAuth.server`, `linkedinCrypto.server` |
| `/employees/:employeeId` | employee profile, writing style, assigned playbook, LinkedIn account | `employees`, `employee_playbooks`, `playbooks`, `linkedin_connections` |
| `/playbooks` | writing playbooks | `playbooks` |
| `/calendar` | content calendar and scheduling | `content_drafts`, `content_schedule_history` |
| `/planner` | weekly content planning | `content_plans`, `content_plan_items`, `content_plan_item_history`; `contentPlanner.server` |
| `/orchestration` | strategy → planner → drafting pipeline | `orchestration_runs`, `orchestration_stages`, `orchestration_handoffs`, `orchestration_draft_items`, `orchestration_events`; `postOrchestration.server` |
| `/connections` | connection sources, prospects, recommendations, approval queue | `connection_sources`, `connection_prospects`, `connection_prospect_sources`, `connection_recommendations`, `connection_recommendation_events`; `generateConnectionRecommendations.server` |
| `/analytics` | post metrics and performance | `post_metric_snapshots`; `postAnalytics.server`, `postAnalytics` |
| `/operations` | existing autopilot and daily content automation | `automation_settings`, `automation_runs`, `automation_tasks`, `automation_events`; `autopilot.server` |

No route or table above is renamed or replaced in Phase 2. LinkedIn OAuth tokens,
publishing credentials, and generated-image storage remain server-side.

### Future attachment map

- **People / CRM** extends `connection_prospects`, `employees`, LinkedIn identities,
  `conversations`, and `buying_signals`; it does not replace them.
- **Outreach** will attach to People/Companies, engagement, and a future email
  provider. No email provider or sending path exists in this phase.
- **Newsletters** will reuse drafting, review, approval, and scheduling concepts,
  then add recipient models later.
- **Agents** may eventually operate across Development, Content & LinkedIn,
  People, Outreach, and Newsletters. Existing orchestration/autopilot remains
  the only executable automation in this phase.
