# Net-X Dev OS (DEVOS)

Net-X Dev OS is the internal operating system for [Net-X](https://net-x.io/).
It combines the existing LinkedIn content workflows, the Development Control
Center, and approval-controlled agents. For operational details, see
[`docs/net-x-back-office.md`](docs/net-x-back-office.md).

The repository and Cloudflare Worker retain the historical `linkedinadam` name
while the application migrates to the broader Net-X internal platform.

## What is included

- LinkedIn content drafting, review, scheduling, publishing, and analytics
- Employee profiles and writing playbooks
- Content planning and post orchestration
- Connection-growth and daily-operations workflows
- A Cloudflare Access-protected development control center
- A read-only GitHub App integration for development status

GitHub synchronization is deliberately read-only. Merges, production actions,
external messages, publications, and destructive changes remain human-approved
operations.

## Stack

- React 19 and React Router 7
- TypeScript and Vite
- Cloudflare Workers
- Cloudflare D1 for relational data
- Cloudflare R2 for generated images
- Vitest

## Local development

Install the locked dependencies:

```sh
npm ci
```

Apply migrations to a local D1 database:

```sh
npx wrangler d1 migrations apply linkedinadam-db --local
```

For loopback-only development, configure the local identity in `.dev.vars`:

```text
BACKOFFICE_LOCAL_AUTH=true
BACKOFFICE_ENVIRONMENT=development
BACKOFFICE_LOCAL_USER_EMAIL=adam@net-x.io
BACKOFFICE_LOCAL_USER_NAME=Adam
BACKOFFICE_OWNER_EMAIL=adam@net-x.io
```

Do not commit `.dev.vars`; it is ignored by Git. Start the application with:

```sh
npm run dev
```

The local server is available at `http://localhost:5173`.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm test` | Run the complete test suite |
| `npm run typecheck` | Generate route types and run TypeScript checks |
| `npm run build` | Create the production application build |
| `npm run check` | Type-check, build, and perform a Wrangler deployment dry-run |
| `npm run preview` | Build and preview the production bundle locally |
| `npm run deploy` | Deploy the Worker with Wrangler |

## GitHub App connection

The Development Control Center uses a server-side GitHub App rather than a
personal access token. The App is installed only on `colossalbreacker/net-x`
and must have read-only repository permissions for
Contents, Issues, Pull requests, Checks, and Commit statuses, with no
organization or account permissions.

Install the App only on the intended repository and configure these encrypted
Cloudflare Worker secrets:

```text
GITHUB_APP_ID
GITHUB_APP_PRIVATE_KEY
GITHUB_APP_INSTALLATION_ID
```

The repository owner, repository name, and disabled sync switch are ordinary
Worker variables in `wrangler.json`. Installation alone does not activate the
integration: keep `GITHUB_SYNC_ENABLED=false` until all credentials and read
permissions pass the documented readiness gate. GitHub's downloaded PKCS#1 PEM
key is supported directly and converted to PKCS#8 in memory for signing.

See [the DEVOS operations guide](docs/net-x-back-office.md#read-only-github-development-sync)
for the complete registration, installation, migration, and security steps.

## Deployment safety

- Keep credentials in encrypted Worker secrets; never add them to source files
  or expose them through `VITE_` variables.
- Run `npm run check` before deployment.
- Review and back up production D1 data before applying remote migrations.
- Apply remote migrations manually; deployment does not apply them.
- Leave GitHub webhooks disabled until a public signature-verifying route is
  intentionally enabled.

The production environment is expected to sit behind Cloudflare Access. See
[the full DEVOS guide](docs/net-x-back-office.md) for identity mapping,
database migration, approval, and provider-integration details.
