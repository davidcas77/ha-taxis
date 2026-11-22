# Jev decisions in Taxis

Jev is an optional runtime integration with TypeSafe, independent of the
Low/Medium/Strong generative models and the Codex development MCP connection.
It is disabled by default. No key is copied from the development machine.

## Setup and use

In Settings, use the **Jev decisions** shortcut. Enable the service, paste a
TypeSafe API key into the password field, choose a pinned model and set a monthly
request limit. Save before testing. The connection test sends a small public
message, not house data. Save and reload do not call TypeSafe.

The Guide's room-test checklist has **Review notes with Jev**. This explicit
action sends only the typed notes and public checklist criteria. One Choice per
criterion asks whether the notes report success, an unresolved problem, or do not
establish an observation. All questions share one request. Results preserve the
model, question policy version, choice, confidence and probability distribution.
Editing notes hides old results; late answers cannot overwrite the new context.

The room-note policy is `room-notes-v1`. Decisions are advisory and missing
evidence stays explicit. A decision cannot mark a room ready, tick a box,
save a test, change settings or write to Home Assistant.

## Configuration checks

Taxis builds a check for the selected control in Buttons, an unassigned device
or entity, a room automation's sensor requirement, or its proposed groups. Each
check has a bounded set of Choice questions, including an option for insufficient
evidence. Taxis selects the candidates from Home Assistant and the room plan.
For Buttons it considers configured behavior and possible overlaps. A button
check cannot establish that a press actually ran its automation.

Opening a preview reads the evidence from Taxis and Home Assistant. Sending a
review requires a second, explicit action. Taxis checks the reviewed fingerprint
against freshly read evidence before sending and can reuse a matching decision
from its in-memory cache. The provider receives selected names and evidence as
shown in the preview. Assignments and group changes still use the existing
review and apply flows. Provider responses supply advice only.

## Credentials and requests

- A dedicated `jev_key` SQLite settings row holds the key server-side. GET/PUT
  responses reveal only `keySet`; the browser never reads the saved value or a
  key suffix. An omitted key preserves the old value; `null` removes it.
  Settings and key replacement commit atomically, with stale-write protection.
- The key follows the existing AI storage model: app data, included in HA app
  backups. It is not claimed to be encrypted. Runtime logs register the key for
  redaction; provider and storage failures return controlled messages.
- Only `https://api.typesafe.ai/v1/systemone` receives a Bearer-authenticated POST.
  No custom endpoint, browser-supplied question definitions/model, redirects or automatic POST
  retries are supported. Requests have a 25-second deadline and bounded bodies.
- The runtime redacts configured HA/AI/Jev secrets from notes and configuration
  check evidence. Room-note calls receive typed notes and checklist criteria.
  Configuration checks project a bounded subset of information for the selected
  subject. They do not send raw Home Assistant states, attributes or automation
  YAML. User-entered notes and check evidence are sent only on explicit request.
- Validate every returned answer, model, token count and probability
  distribution. Reject partial/malformed responses rather than presenting them
  as a successful review. User notes are treated as data, not instructions;
  bounded outputs and the absence of a mutation dependency limit their effects.

## Usage and persistence

The default is 100 requests per UTC calendar month, adjustable from 1 to 10,000.
A SQLite conditional insert reserves a slot before sending, so concurrent
service instances share the limit. Tests and failed/timed-out requests count.
Changing a key/model does not reset usage. Only one request runs per service at
a time. Turning Jev off stops new calls; an already submitted call may finish.

The new migration adds `jev_usage` without modifying existing settings or AI
usage. Rows retain attempt time, job, requested model, completion status, token
counts and estimated cost for up to two years. No notes, answers or keys enter
the ledger. Pending/failed calls with no reported token counts show unknown
usage. Estimates use the published price for pinned models, not an invoice or
a dollar spending cap. The existing generative AI spending cap remains separate.

## API and verification

- `GET/PUT /api/settings/jev`: settings and write-only credential management.
- `GET /api/jev/usage`: UTC month usage and request limit.
- `POST /api/jev/test`: fixed public connection test using saved settings.
- `POST /api/jev/room-notes`: bounded notes/checklist review using saved settings.
- `POST /api/jev/checks/preview`: prepare a read-only configuration check without a provider call.
- `POST /api/jev/checks/run`: validate the reviewed fingerprint and return an advisory decision.

All writes and paid endpoints use the existing Taxis request-header guard. The
settings endpoint also uses the shared If-Match revision middleware. Tests use
temporary SQLite files, a fake provider and the dummy HA. No real API key,
provider charge or live HA write is required for automated verification.

Primary contracts checked on 2026-10-28:
[System One API](https://docs.typesafe.ai/api/system-one),
[Choice](https://docs.typesafe.ai/primitives/choice),
[models/pricing](https://docs.typesafe.ai/models), and
[request errors](https://docs.typesafe.ai/api/errors).

Implementation verification: TypeScript, production build and all 1,363 tests
across 57 files passed. Eight Jev browser scenarios and the 53 existing Guide,
AI-model, helper/naming and table scenarios passed against the dummy HA with
writes intercepted. The new tests cover legacy-database migration, atomic key
updates, redaction, provider errors, malformed decisions, concurrent quotas,
write-only Settings, unsaved/stale drafts and late room-review replies. A real
TypeSafe connection remains to be verified through the saved-key test after a
user supplies a runtime key.
