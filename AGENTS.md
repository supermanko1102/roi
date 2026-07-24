# Codex / Agent Repository Handoff

Before substantive work, read [`docs/PROJECT_ARCHITECTURE.md`](docs/PROJECT_ARCHITECTURE.md).

For work under `project-address-agent/`, also read
[`project-address-agent/DESIGN_SPEC.md`](project-address-agent/DESIGN_SPEC.md). It is the
Agent behavior and safety contract.

Repository invariants:

- `db/schema.ts` is the only schema source; schema changes require a migration.
- Preserve `gemini-3-flash-preview` unless the user explicitly requests a model change.
- Never let an LLM directly write or publish latitude/longitude.
- Road-only and neighborhood-only locations are not precise coordinates.
- Automatic address publication requires local MOI evidence, NLSC validation,
  district containment, and one unambiguous coordinate cluster.
- Do not print, commit, or document secret values.
- Do not permanently add an Agent-specific `railway.json` at repository root.
- Railway deployment requires explicit human approval.
- Preserve unrelated dirty-worktree changes.

Known decision point: `project-address-agent` enforces a three-active-deal threshold,
while `etl/compute-stats.ts` currently creates `projects` with `HAVING count(*) >= 1`.
Do not silently reconcile this drift; treat it as a product/data migration decision.
