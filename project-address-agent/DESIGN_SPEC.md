# Project Address Repair Agent — Design Specification

## Objective

Build an isolated Python agent system that automatically recovers map locations
for presale projects that exist in the Ministry of the Interior transaction data
but are not visible because their `projects.lat` / `projects.lng` values are
missing.

The agent must never invent coordinates and must never publish a model-only
answer directly to production data.

## Scope

### In scope

- Audit the path from `presale_deals` to `projects` and classify failures.
- Inspect transaction addresses, MOI presale filing records, cached geocodes,
  permits, and contract metadata.
- Let an ADK agent propose an address, intersection, or land-lot candidate.
- Validate candidates with NLSC and the repository's district GeoJSON.
- Persist audit cases and validated candidates in PostgreSQL staging tables.
- Automatically publish a candidate only when it comes from local official
  evidence, passes deterministic validation, and produces one unambiguous
  coordinate cluster.
- Run unattended after the existing project and land-lot geocoders.
- Run as a short-lived Railway Cron worker that exits after every batch.
- Automatically invoke the ADK Agent only for the bounded set of cases that the
  deterministic pass could not resolve.
- Record Gemini token usage in the worker output and cap both cases per batch
  and LLM calls per case.
- Re-run the deterministic evidence and publication gate after the Agent stages
  a proposal.
- Leave ambiguous or unvalidated cases in the queue without blocking the ETL.
- Keep optional human review commands for exceptional investigations.
- Publish approved coordinates to `projects` and `geocode_cache`.
- Reapply previously published decisions after future ETL runs.

### Out of scope

- Creating transactions that do not exist in MOI data.
- Bypassing the current three-active-deal threshold for `projects`.
- Changing frontend search behavior or making below-threshold projects visible.
- Accepting road centroids, approximate neighborhoods, or model-generated
  coordinates.
- Automatically rewriting `presale_deals.project_name`.
- Treating mangled-name aliases as proof that a government project is missing.

## Failure taxonomy

| Reason | Meaning | Agent action |
|---|---|---|
| `missing_name` | Raw rows have no project name | Report only |
| `name_mangled` | Name contains replacement characters such as `?` and has no coordinate | Inspect official evidence conservatively |
| `below_threshold` | Fewer than three active deals | Report only |
| `project_missing` | Three or more active deals but no exact `projects` row | Report; often a mangled-name alias |
| `project_no_coord` | `projects` row exists but has no coordinates | Repair target |
| `resolved` | Project has coordinates | No action |

## Safety contract

1. The LLM may select or propose a textual candidate only.
2. The LLM never supplies latitude or longitude to the staging or publishing
   tools.
3. A deterministic validator obtains coordinates from NLSC.
4. The coordinate must fall inside the expected city and district polygon.
5. Automatic publishing accepts only candidates extracted by code from local
   MOI transaction, community, or buildcase evidence.
6. Every validated candidate for one case is compared. Automatic publishing
   requires exactly one coordinate cluster; conflicting locations are skipped.
7. Agent tools may create staging records but expose no publishing operation.
8. Manual publishing still requires both `approved` status and
   `ADDRESS_AGENT_ALLOW_PUBLISH=1`.
9. Every candidate keeps its source, raw evidence, validation response, model
   rationale, reviewer, and timestamps.
10. Revalidating a candidate clears its prior approval; published candidates
   are immutable.
11. Automatic decisions are recorded with `reviewed_by =
    auto:official-evidence`; this is an audit identity, not a human review.
12. Agent-staged text is auto-publishable only when code independently finds
    the exact candidate inside local MOI evidence. Web-search-only evidence
    remains staged and cannot auto-publish.
13. Missing Gemini credentials skip only the Agent fallback; they never block
    the deterministic repair pass.
14. The worker must close ADK, HTTP, and database resources and then terminate
    so the next Railway Cron execution is not skipped.

## Source priority

1. Existing `presale_deals.address` values.
2. Exact matching MOI `communities.street` records.
3. MOI buildcase CSV street and base land-lot fields.
4. Official contract / permit records already stored by the project.
5. Other official government evidence found during research.
6. Non-official evidence may be recorded but never auto-approved.

## Candidate types

- `door`: an exact street address ending in a door number.
- `cross`: an exact intersection containing two road names.
- `lot`: a cadastral section and land-lot number.

Road-only, neighborhood-only, and landmark-only candidates are invalid.

## Data model

### `project_location_cases`

One audit row per `(city, district, project_name)`, containing the failure
reason, active/cancelled deal counts, raw addresses, workflow status, and audit
timestamps.

### `project_location_candidates`

Many candidate rows per case. A row contains the candidate kind/value, evidence,
deterministic validation payload, validated coordinates, precision, review
status, and publication metadata.

## Agent tools

- `audit_unresolved_projects`: refresh and list actionable cases.
- `inspect_project_evidence`: collect all local evidence for one project.
- `validate_location_candidate`: run deterministic validation without writing.
- `stage_location_candidate`: validate again, then persist a staging candidate.
- `list_staged_candidates`: show candidates awaiting review.
- `google_search_agent`: isolated Google Search fallback when local official
  evidence is insufficient; it exists only on the interactive root Agent.

The Railway Cron Agent exposes only `inspect_project_evidence`,
`validate_location_candidate`, and `stage_location_candidate`. It cannot search,
audit unrelated cases, review, approve, or publish.

The LLM agent has no review or publish tool. The unattended runner owns the
automatic publication gate and revalidates all coordinates itself.

## Unattended Railway cycle

One scheduled Railway execution performs:

1. Run deterministic repair for the current queue batch.
2. Select only `no_precise_candidate` and `no_validated_candidate` results.
3. Invoke the local-evidence-only ADK Cron Agent for at most the configured case
   limit.
4. Let the Agent inspect, validate, and stage textual proposals.
5. Re-run deterministic validation for the attempted case IDs.
6. Publish only proposals independently attested by local MOI evidence.
7. Print model call and token totals, close resources, and exit.

Railway supplies the database URL and model credential through sealed service
variables. No secret is stored in the repository.

## CLI

- `audit [--write]`
- `auto [--apply] [--limit N] [--city CITY]`
- `cycle --apply [--limit N] [--agent-limit N] [--city CITY]`
- `evidence CITY DISTRICT PROJECT`
- `validate CITY DISTRICT PROJECT --kind ... --candidate ...`
- `review CANDIDATE_ID --approve|--reject --reviewer ...`
- `publish CANDIDATE_ID`
- `apply-published`

## Success criteria

- Unit tests cover every failure classification.
- XML parsing and candidate validation are tested without external network.
- Polygon containment is tested for Polygon and MultiPolygon geometries.
- An invalid or approximate candidate cannot be staged as validated.
- An unapproved candidate cannot be published.
- An official, uniquely validated candidate can be auto-published without human
  input.
- A scheduled cycle invokes the ADK Agent without a human command.
- One cycle cannot exceed its configured Agent case limit or per-case LLM-call
  limit.
- The worker process exits successfully when the Agent credential is absent.
- Multiple validated coordinate clusters are never auto-published.
- Publishing never accepts caller-provided coordinates.
- The ADK agent can be loaded by the ADK CLI.
- An eval set covers direct-coordinate-write and below-threshold refusal cases.
