from __future__ import annotations

from google.adk import Agent
from google.adk.tools.google_search_agent_tool import (
    GoogleSearchAgentTool,
    create_google_search_agent,
)

from .config import get_settings
from .tools import (
    audit_unresolved_projects,
    inspect_project_evidence,
    list_staged_candidates,
    stage_location_candidate,
    validate_location_candidate,
)

settings = get_settings()
search_tool = GoogleSearchAgentTool(create_google_search_agent(settings.model))

root_agent = Agent(
    name="project_address_repair_agent",
    model=settings.model,
    description=(
        "Audits and researches missing Taiwan presale project locations, validates "
        "candidates with NLSC, and stages evidence for the unattended safety runner."
    ),
    instruction="""
You repair missing presale project locations for the 房市探探 data pipeline.

Safety rules:
1. Never invent latitude or longitude.
2. Never claim that a project is missing from the database until you distinguish
   presale_deals, projects, and map visibility.
3. Start with audit_unresolved_projects or inspect_project_evidence.
4. Do not attempt address repair for below_threshold or missing_name cases.
5. If a case has an empty district, infer a validation district only from the
   city/district text in official local evidence, then pass that district to
   validate and stage. Never infer it from the project name alone.
6. Prefer evidence in this order: transaction address, exact MOI community,
   MOI buildcase street/land lot, official contract or permit, other government source.
7. Use Google Search only when local official evidence is insufficient. Treat
   non-government pages as leads, not proof.
8. A candidate must be one of:
   - door: exact address ending in 號
   - cross: exact intersection with two road names
   - lot: section name plus land-lot number
9. Always call validate_location_candidate before staging.
10. Stage only the strongest candidate and include a precise source reference.
11. You cannot approve or publish. The unattended runner owns a separate,
    deterministic official-evidence publication gate.
12. If evidence conflicts, do not guess. Explain the conflict and leave the case queued.

When reporting a staged result, include candidate_id, validation precision, and
source. Use Traditional Chinese for user-facing responses.
""".strip(),
    tools=[
        audit_unresolved_projects,
        inspect_project_evidence,
        validate_location_candidate,
        stage_location_candidate,
        list_staged_candidates,
        search_tool,
    ],
)

cron_agent = Agent(
    name="project_address_cron_agent",
    model=settings.model,
    description=(
        "Interprets local MOI evidence for one unresolved presale project and "
        "stages at most one deterministically validated textual candidate."
    ),
    instruction="""
You handle exactly one presale project case supplied by an unattended Railway
Cron worker.

1. Call inspect_project_evidence for the supplied city, district, and project.
2. Use only local transaction, MOI community, or MOI buildcase evidence.
3. Do not audit or inspect other projects.
4. Do not use or request web search.
5. A candidate must be an exact door number, two-road intersection, or section
   plus land-lot number that is literally present in the local evidence.
6. Call validate_location_candidate before staging.
7. Stage at most one strongest candidate with its exact local source reference.
8. Never supply coordinates and never approve or publish.
9. If evidence is incomplete, approximate, or conflicting, finish without
   staging and explain why.

Use Traditional Chinese for the final response.
""".strip(),
    tools=[
        inspect_project_evidence,
        validate_location_candidate,
        stage_location_candidate,
    ],
)
