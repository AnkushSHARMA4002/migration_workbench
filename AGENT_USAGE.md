# Agent usage

## Tools

- Claude (Anthropic) in the claude.ai chat interface, with a sandboxed Linux environment for running code. It generated the code, tests and documentation in this repository.
- Node's built-in test runner and a jsdom script (kept outside the repository) to check the code and the browser UI flow.

## Representative prompts

1. The assignment brief pasted in full (expected solution, repository requirements, hosting requirements), followed by: "Agentic Data Migration Planner and Reconciliation Workbench. Make this. Give all code without comments. Tell me what to do now and the steps to push to git. Give me a full ready to use project."
2. In-product prompts sent to the LLM at runtime are in `src/planner.js` (planning agent) and `src/fixes.js` (reconciliation fix agent). Both require JSON-only output and treat source data as untrusted.

## Work delegated to the agent

- Project structure, Express API, SQLite schema, authentication
- CSV parser, whitelisted transforms, type coercion
- Planning agent, heuristic fallback, response validators
- Migration, reconciliation and fix-approval logic
- Vanilla JS front end and styles
- Test suites, Dockerfile, Render blueprint, CI workflow, README

## Design decisions made while working with the agent

- The model chooses from a fixed list of transforms instead of producing code or SQL, so a bad or manipulated response cannot execute anything.
- Fixes are limited to three actions, and the validator blocks writes to the key field and values that fail the field type.
- A deterministic fallback exists so the app works without an API key, and the UI labels which source produced each plan or fix.
- Applying a fix does not silently re-run reconciliation. The user re-runs it so the numbers they see always match a run they started.
- "Approve confident mappings" only approves mappings at 60% confidence or higher that have a source or default. Everything else needs an individual decision.

## Mistakes found and corrected

- The first version of the front end used `replaceChildren` with arrays and `null` values. The DOM stringified them, so the Reconcile tab showed "[object HTMLDivElement]" and "null" instead of issue cards. A jsdom run of the full UI flow exposed it, and it was fixed by adding a `fill` helper that flattens children and skips empty values.
- The first attempt to create the project folders used shell brace expansion that did not work in the sandbox shell, so the source files were not written. The directories were recreated and the files rewritten.

## Verification

- `npm test` runs 21 tests and passes.
- A jsdom script drove the real UI against the real server: sign in, form validation, sample project, plan, the migration lock while mappings are pending, approvals, migration, reconciliation, fix proposals, fix approval, re-reconciliation and logs. It finished with no page errors.
- The sample output was inspected by hand: names split correctly, dates and currencies normalised, 7 of 20 rows held back for specific reasons, and the duplicate customer ID detected.
- Not verified by the agent: live calls to Anthropic, OpenAI or Gemini (no keys were available in the sandbox) and the Docker build (no Docker in the sandbox).

## Verified by me after generation

TODO: after running with a real API key, note here which provider and model you used and what the plan and fix proposals looked like, plus anything you changed or rejected. Also note the result of your deployed health check at `/api/health`.
