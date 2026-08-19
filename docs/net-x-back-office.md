# Net-X Back Office foundation

LinkedInAdam remains the existing Worker and repository. This foundation adds
the first internal Development Control Center without changing the existing
LinkedIn publishing or content workflows.

## Cloudflare Access

Production requests are expected to arrive through Cloudflare Access. The
Worker reads the Access identity headers server-side and maps the email to one
of these roles: `OWNER`, `ADMIN`, `DEVELOPER`, `MARKETING`, `SALES`, or `VIEWER`.
Unmapped identities fail closed. Configure the email mappings as Worker
environment variables/secrets; never submit an actor name or role from a form
and treat it as identity.

The LinkedIn OAuth callback remains the only public callback path. It validates
the one-time OAuth state before changing a LinkedIn connection. Configure a
Cloudflare Access policy for the internal application and, if required by the
LinkedIn flow, bypass only that callback path.

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
