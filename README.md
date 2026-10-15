# Agentic Data Migration Planner and Reconciliation Workbench

An agentic data migration planner and reconciliation workbench. Upload a legacy CSV and describe the target schema. An AI agent proposes a migration plan. A human approves, edits or rejects every mapping. The approved plan runs, the result is reconciled against the source, and the agent proposes fixes that a human approves before anything changes.

Live demo: `<your deployed URL>`
Demo login: `reviewer@example.com` / `Review@123` (use the "Fill demo credentials" button on the sign-in page)

## Review in two minutes

1. Sign in with the demo account.
2. Click **Create sample project**. It loads a messy legacy customer file with 20 rows.
3. **Plan and review**: click **Generate migration plan**, then **Approve confident mappings**. Review the remaining mappings and approve or reject each one.
4. **Migrate**: run the migration. Rows that fail validation are held back, not loaded.
5. **Reconcile**: run reconciliation, click **Ask the agent for fix proposals**, then approve or reject each fix. Re-run reconciliation to confirm the result.
6. **Logs**: see structured application and AI workflow events for the project.

## Workflow and human approval points

| Stage | What the AI does | What the human must do |
| --- | --- | --- |
| Plan | Proposes one mapping per target field with a transform, confidence and rationale, plus risks | Approve, reject or edit each mapping. Migration is blocked while any mapping is pending |
| Migrate | Nothing. Runs deterministic code | Starts the run |
| Reconcile | Nothing. Runs deterministic checks | Starts the run |
| Fix | Proposes a fix per issue | Approves or rejects each fix. Nothing changes until approved |

## Architecture

```
public/            Vanilla JS single-page UI (no build step)
src/server.js      Express app, request logging, error handling
src/routes.js      REST API
src/auth.js        Password hashing (scrypt), signed tokens, route guard
src/projects.js    Project creation, ownership checks, serialisation
src/planner.js     LLM planning agent, heuristic fallback, plan validation
src/migrate.js     Applies approved mappings to source rows
src/reconcile.js   Deterministic reconciliation checks and issue generation
src/fixes.js       LLM fix proposals, validation, human-approved application
src/llm.js         Anthropic, OpenAI-compatible and Gemini providers over fetch
src/transforms.js  Whitelisted transforms and type coercion
src/db.js          SQLite schema (better-sqlite3)
src/logger.js      Structured JSON logs to stdout and the logs table
tests/             node:test suites
samples/           Sample legacy CSV and target schema
```

Data is stored in SQLite: users, projects, source rows, mappings, target rows, reconciliations, issues and logs.

### How the AI is kept safe

- The model never writes code or SQL. It chooses from a fixed list of transforms (`copy`, `upper`, `lower`, `title`, `to_number`, `to_integer`, `to_date_iso`, `to_boolean`, `phone_digits`, `first_word`, `last_word`).
- Every model response is validated. Unknown columns, transforms and fields are dropped, confidences are clamped, and missing fields get an explicit "no mapping" placeholder.
- Fix proposals are limited to `set_value`, `exclude_rows` and `none`. A fix is rejected by the validator if it targets the key field or the value fails the field type.
- Source data is sent as untrusted JSON and the system prompt tells the model to ignore instructions found in cell values.
- If no API key is configured, or the call fails or times out, a rule-based fallback produces the plan and fixes. The UI shows which source produced each result.
- Every approval and rejection is logged.

### Reconciliation checks

Row accounting (source, loaded, failed, excluded, unaccounted), validation failures grouped by field, duplicate key values, numeric totals (source total versus loaded total), field completeness, unmapped source columns and empty-rate warnings.

## Setup

Requires Node 20 or newer.

```bash
npm install
cp .env.example .env
```

Edit `.env`, then export it or use a loader. Node 20.6 and newer can read it directly:

```bash
node --env-file=.env src/server.js
```

Open http://localhost:3000.

### Choosing an LLM

Set `LLM_PROVIDER` to `anthropic`, `openai` or `gemini`, and set the matching key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY`). `LLM_MODEL` overrides the default model. `OPENAI_BASE_URL` lets you point the `openai` provider at any OpenAI-compatible API. Without a key the app still runs using the heuristic fallback.

### Tests

```bash
npm test
```

21 tests cover transforms, CSV parsing, planner heuristics and validation, fix validation, authentication, ownership isolation, mapping validation, the approval gate, and the full plan, migrate, reconcile, fix, re-reconcile and export flow over HTTP. The suite runs with no API key, so it exercises the fallback path.

## Deployment

The repository includes a `Dockerfile` and a `render.yaml` blueprint.

1. Push the repository to GitHub.
2. In Render, create a new Blueprint or Web Service from the repository.
3. Set `GEMINI_API_KEY` (or the key for your chosen provider) in the service environment. Do not commit it.
4. `SESSION_SECRET` is generated by the blueprint.
5. Health check path: `/api/health`. It reports whether an LLM key is configured.

## Scope

Completed:

- Sign in and registration, per-user project isolation
- CSV upload or paste with validation, target schema definition
- AI migration plan with human approval gate
- Migration execution with row-level validation
- Reconciliation with issue detection
- AI fix proposals with human approval
- CSV export of loaded rows
- Loading, empty, validation, success and failure states in the UI
- Structured logs (stdout and a per-project log view)
- Automated tests and CI workflow

Intentionally excluded:

- Direct database connectors. Sources are CSV only, and the target is a CSV export
- Multi-table migrations and foreign-key reconciliation
- Role-based access, password reset and email verification
- Background job queue. Runs are synchronous and bounded by `MAX_ROWS` (default 5000)
- Undo for applied fixes. Re-running the migration restores the original result

## Limitations

- SQLite on a free hosting tier may reset when the service redeploys or restarts. Use a persistent disk or a hosted database for durable data. The demo user is re-created on start.
- Free tiers can sleep when idle, so the first request after a pause can be slow.
- Dates like `03/04/2021` are read as day/month/year unless the first number is above 12.
- Re-running reconciliation recreates open issues, so previously rejected fixes can reappear for the agent to propose again.
- Tokens are stored in `localStorage` and expire after 12 hours.
- The demo password is public by design. Change `DEMO_PASSWORD` for anything other than review.

## API

All routes except `/api/health`, `/api/login` and `/api/register` need `Authorization: Bearer <token>`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Status and LLM configuration |
| POST | `/api/login`, `/api/register` | Authenticate |
| GET, POST | `/api/projects` | List or create projects |
| POST | `/api/projects/sample` | Create the sample project |
| GET, DELETE | `/api/projects/:id` | Read or delete a project |
| POST | `/api/projects/:id/plan` | Generate the AI plan |
| PATCH | `/api/mappings/:id` | Edit, approve or reject a mapping |
| POST | `/api/projects/:id/mappings/approve-confident` | Approve mappings with confidence of at least 60% |
| POST | `/api/projects/:id/migrate` | Run the migration |
| GET | `/api/projects/:id/target` | Page through target rows |
| POST | `/api/projects/:id/reconcile` | Run reconciliation |
| POST | `/api/projects/:id/fixes/propose` | Ask the agent for fix proposals |
| POST | `/api/issues/:id/decision` | Approve or reject a fix |
| GET | `/api/projects/:id/export` | Download loaded rows as CSV |
| GET | `/api/projects/:id/logs` | Structured logs |
