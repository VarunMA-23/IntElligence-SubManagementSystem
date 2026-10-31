
## Architecture

```text
apps/
  api/          Express API, workers and CLI entrypoints
  web/          Next.js App Router dashboard
packages/
  shared/       Zod schemas, shared types, money and error helpers
  db/           Mongoose connection and models
  billing/      Pricing engines, invoice totals, periods, state machines
  metering/     Metric aggregation and ingestion windows
  integrations/ Local email, webhook signing/delivery, PDFs, secret encryption
scripts/        Developer and smoke-test scripts
tests/          Integration and end-to-end suites
```

### Runtime services

| Service | Port | Purpose |
| --- | --- | --- |
| Web | `8080` | Next.js dashboard |
| API | `8081` | REST API at `/api/v1`, health at `/health` |
| Worker | n/a | Outbox dispatch and webhook delivery polling |
| MongoDB | `27017` | Primary datastore |
| MailHog | `1025` / `8025` | Local SMTP and web inbox (optional) |

## Requirements

- Node.js 20 or newer
- pnpm 11 (`corepack enable` is recommended)
- MongoDB 7, or the bundled memory database for local development
- Docker Desktop only if you want the compose services

## Quick start

```bash
pnpm install

# Optional: start MongoDB and MailHog
docker compose up -d

# Configure environment
cp .env.example .env

# Create indexes and seed demo data
pnpm db:migrate
pnpm db:seed

# Run API, worker and web together
pnpm dev
```

Open <http://localhost:8080> and sign in with the seeded account:

| Field | Value |
| --- | --- |
| Email | `demo@brightloop.local` |
| Password | `Demo1234` |
| Organization | `brightloop-demo` |

### Running without MongoDB

Set `USE_MEMORY_DB=true` in `.env` to start an in-memory MongoDB instance with the API. This is convenient for tests and demos, but the database is destroyed when the process exits. Seed data created in one process is not visible to a separately started server.

To seed and browse a populated memory database, run the API, migration and seed steps in the same process, or point `MONGODB_URI` at a real MongoDB instance.

## Environment

Copy `.env.example` to `.env`. Important settings:

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `PORT` | `8081` | API port |
| `WEB_ORIGIN` | `http://localhost:8080` | CORS origin and email link base |
| `MONGODB_URI` | `mongodb://localhost:27017/brightloop` | MongoDB connection string |
| `USE_MEMORY_DB` | `false` | Start an ephemeral in-memory MongoDB |
| `JWT_SECRET` | development secret | Replace in production |
| `JWT_ACCESS_TTL` | `15m` | Access token lifetime |
| `JWT_REFRESH_TTL` | `30d` | Refresh token lifetime |
| `INTERNAL_SECRET` | development secret | Required by internal worker endpoints |
| `STORAGE_DIR` | `./storage` | Invoice, credit note and PDF storage |
| `MAILER_TRANSPORT` | `console` | `console` or `smtp` |
| `ALLOW_LOCAL_WEBHOOKS` | `false` | Allow localhost webhook targets in development |
| `WEBHOOK_MAX_ATTEMPTS` | `5` | Delivery retry limit |
| `PORTAL_TOKEN_TTL_MINUTES` | `1440` | Customer portal link lifetime |

The web app reads `NEXT_PUBLIC_API_URL` and defaults to `http://localhost:8081/api/v1`.

## Commands

| Command | Description |
| --- | --- |
| `pnpm dev` | Run API, worker and web concurrently |
| `pnpm dev:api` | Run only the API with hot reload |
| `pnpm dev:web` | Run only the Next.js dashboard |
| `pnpm build` | Build all workspace packages |
| `pnpm typecheck` | Type-check API and shared packages |
| `pnpm --filter @brightloop/web typecheck` | Type-check the dashboard |
| `pnpm db:migrate` | Create collections and sync indexes |
| `pnpm db:seed` | Seed the demo organization |
| `pnpm exec tsx scripts/smoke-api.ts` | Run the end-to-end API smoke flow against a memory database |

## API overview

All application endpoints are under `/api/v1`. Tenant-scoped routes require a bearer access token that contains an organization and tenant, plus a valid membership role.

### Authentication and organizations

```text
POST   /auth/register
POST   /auth/verify-email
POST   /auth/login
POST   /auth/refresh
POST   /auth/forgot-password
POST   /auth/reset-password
POST   /auth/invites/accept
POST   /auth/switch-tenant
GET    /auth/me
POST   /auth/organizations
GET    /organizations
GET    /organizations/:id
PATCH  /organizations/:id
GET    /tenants
POST   /organizations/:id/tenants
PATCH  /tenants/:id
GET    /organizations/:id/members
PATCH  /organizations/:id/members/:userId
DELETE /organizations/:id/members/:userId
GET    /organizations/:id/invites
POST   /organizations/:id/invites
DELETE /organizations/:id/invites/:inviteId
GET    /api-tokens
POST   /api-tokens
DELETE /api-tokens/:id
GET    /invoicing-entities
```

### Customers and catalog

```text
GET    /customers
POST   /customers
GET    /customers/:idOrAlias
PATCH  /customers/:idOrAlias
DELETE /customers/:idOrAlias
GET    /customers/:idOrAlias/overview

GET    /product-families
POST   /product-families
PATCH  /product-families/:id
DELETE /product-families/:id
GET    /products
POST   /products
GET    /products/:id
PATCH  /products/:id
DELETE /products/:id
GET    /features
POST   /features
DELETE /features/:id
GET    /metrics
POST   /metrics
PATCH  /metrics/:id
DELETE /metrics/:id
GET    /add-ons
POST   /add-ons
PATCH  /add-ons/:id
DELETE /add-ons/:id
GET    /coupons
POST   /coupons
PATCH  /coupons/:id
DELETE /coupons/:id
GET    /catalog
```

### Plans, subscriptions and usage

```text
GET    /plans
POST   /plans
GET    /plans/:id
PATCH  /plans/:id
POST   /plans/:id/publish
GET    /plans/:id/versions

GET    /subscriptions
POST   /subscriptions
GET    /subscriptions/:id
PATCH  /subscriptions/:id
DELETE /subscriptions/:id
POST   /subscriptions/:id/cancel
GET    /subscriptions/:id/entitlements
GET    /subscriptions/:id/usage
GET    /subscriptions/:id/invoices

POST   /events
GET    /usage
GET    /customers/:idOrAlias/usage
```

### Billing, webhooks and activities

```text
GET    /invoices
POST   /invoices/generate
GET    /invoices/:id
POST   /invoices/:id/finalize
POST   /invoices/:id/void
GET    /invoices/:id/pdf
POST   /invoices/:id/credit-notes
GET    /credit-notes
GET    /credit-notes/:id
GET    /credit-notes/:id/pdf

GET    /webhooks
POST   /webhooks
PATCH  /webhooks/:id
DELETE /webhooks/:id
GET    /webhooks/:id/deliveries
GET    /webhook-deliveries
POST   /webhooks/process
GET    /dead-letters
POST   /dead-letters/:id/replay

GET    /batch-jobs
POST   /batch-jobs
GET    /batch-jobs/:id
GET    /batch-jobs/:id/failures
GET    /activities
```

Internal worker endpoints are mounted at `/api/v1/internal` and require the `INTERNAL_SECRET` header.

```text
POST /internal/billing/run
POST /internal/outbox/process
```

## Authentication flow

1. `POST /auth/register` creates a user and sends a verification email.
2. With the console mailer, the response includes `verification_token_hint` for local testing.
3. `POST /auth/verify-email` activates the account.
4. `POST /auth/login` returns access and refresh tokens. A user without an organization receives a bootstrap token with an empty tenant.
5. `POST /auth/organizations` creates the first organization and tenant, and returns a tenant-scoped session.
6. `POST /auth/switch-tenant` issues a new session for another tenant in the same organization.
7. `POST /auth/refresh` rotates the refresh token and returns a new access token.

Roles are enforced per route. API tokens use the `bl_` prefix and a fixed role.

## Money and identifiers

- Prices and rates are stored and transmitted as decimal strings.
- Invoice and subscription aggregate amounts are returned as integer minor units.
- IDs are UUIDv7 strings generated by the application.
- Monetary data uses MongoDB `Decimal128` and Decimal.js for arithmetic.

## Webhooks

Every delivery includes:

- `x-brightloop-signature`
- `x-brightloop-event`
- `x-brightloop-delivery`

The signature is an HMAC over the raw request body. Delivery failures use exponential backoff, then move to the dead-letter queue where they can be replayed from the dashboard or API.

Supported outbox events include customer, subscription, invoice, credit note, checkout and event ingestion events.

## Security notes

- Never commit `.env` or wallet/API credentials.
- Replace all development secrets before deploying.
- Use HTTPS in production and restrict `WEB_ORIGIN`.
- Keep `ALLOW_LOCAL_WEBHOOKS` disabled outside local development.
- Webhook URLs are validated against SSRF rules.
- Invoice PDFs are stored under `STORAGE_DIR`, which is ignored by git.

## Current status

The API, worker, seed/migration scripts and dashboard are implemented. The end-to-end smoke flow in `scripts/smoke-api.ts` exercises registration, email verification, organization creation, catalog setup, plan publishing, subscription creation, usage ingestion, invoice generation, credit notes and PDF download.

Automated Vitest and Playwright suites are the next addition; the root scripts `pnpm test` and `pnpm test:e2e` are reserved for them.
