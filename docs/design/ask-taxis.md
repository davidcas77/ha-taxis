# Ask Taxis

The floating sparkle button is available on every page, including when the HA
read fails. It opens a rounded floating window at the bottom right, roughly 55%
of the viewport height (at most 600 pixels). The page never shrinks or shifts.
The window fits narrow and short viewports with margins, a scrollable message
area and fixed composer. AI administration is in the main navigation and linked
from Settings and the assistant's three-dot menu. Keyboard Escape dismisses
open options first, then closes the window and restores launcher focus.

## Connected work

- Explain selects the configured Medium tier (`explanation`).
- Suggest next steps selects Strong (`planning`).
- Naming help selects Low (`naming`).
- The provider/model, token counts, estimated cost and incomplete-output state
  appear beside the response. Missing models do not silently fall back.
- Existing provider enablement, key management, output limit and spending cap
  apply. Unpriced requests count tokens but not dollars; this limitation remains
  visible. Paid POSTs are not retried. Only one assistant request runs at a time.
- Jev is independent. Only its existing Guide review and Settings test call it.
  The assistant does not dynamically route arbitrary questions to Jev.

## Explicit data boundary

Opening the panel and refreshing context are local Taxis requests, not provider
calls. Page data is off by default. An area selector follows the selected area
or an organized entity/device's effective area; users can change it. A projected
JSON context can be inspected in the context chip's options. Pressing Send or
Enter explicitly submits the message and selected context; no extra confirmation
checkbox is required. Shift+Enter adds a newline. Context controls, model and
token/cost details and administrative links are collapsed out of the main chat.
The server authors that projection; callers cannot supply raw context, a system
prompt, model, tools or URLs. A SHA-256 fingerprint rejects changes between
preview and send. The fingerprint is a freshness check, not authentication;
Ingress and the existing request-header guard remain the access boundary.

General context includes public page instructions only. Data-enabled house
context includes registry counts, not all rooms. Selected-area context includes
names/IDs, roles, availability/disabled/restored flags (60 entities maximum),
capability counts, canonical helper plans and the guide's room type, selected
goals and equipment assessment. Installed recipes are deliberately unverified.
On Changes, up to 30 relevant proposals include operation, target, field names
and allowlisted naming/assignment/membership values (12 members maximum).
Omissions are explicit and included in the request. Context is capped at 24,000
characters, dropping entity and guide details if needed rather than silently
expanding the scope. No raw state values, attributes, coordinates, YAML,
credentials, device configuration or saved room-test notes are gathered.

The user's question (2,000 characters maximum) and up to six recent conversation
messages (2,000 characters each) are included. Context, questions, history and
answers redact configured HA, AI and Jev credentials and common key patterns.
User-provided text may contain other private information: the UI makes explicit
that it is sent to the configured provider. This is not a complete DLP system.

## No execution authority

The service receives a context-reader callback but no HA mutation client,
proposal writer or Apply dependency. It supplies no tools to the provider and
rejects tool-call responses. Responses render as escaped plain text, so model
HTML, images and links cannot execute. Prompt instructions guide suggestions;
the absence of execution paths enforces the write boundary independently of
model compliance. Readiness and helper/Health computations stay deterministic.
Advice prioritizes comfort, existing equipment and equipment types/placement,
with readiness based on room type and selected goals.

Scope or page changes clear the conversation. Old responses cannot populate a
new session; errors keep the draft. Closing does not cancel a submitted paid
request. No browser storage or database stores chat contents. Existing snapshots
and saved observations retain their established behavior.

## Administration and persistence

`GET /api/assistant/admin` reports public AI/Jev configuration, separate usage
totals, and the last 30 assistant metadata records. Each row holds time, action,
page, generic scope, tier, model and completed/partial/failed status. At most
200 rows survive. No prompts, answers, error bodies, room names or room IDs are
stored. Existing `ai_usage` remains the count/cost ledger; schema migration 7
adds `assistant_activity` without touching keys, guide records or Changes.

`POST /api/assistant/context` prepares the local preview;
`POST /api/assistant/ask` validates input and freshness and makes one model call.
Both have 32 KiB body limits and the shared cross-site header guard. There is
no background worker or scheduled AI analysis.

Automated checks use fake provider responses and intercepted browser requests
against the dummy HA. They validate contract, privacy, routing and UI behavior,
not real-model recommendation accuracy. Real authentication and semantic quality
remain to be assessed with user-supplied provider keys; no paid provider calls
or live HA writes are required for this implementation.

Implementation validation: TypeScript, production build and 1,381 tests across
58 files passed. Ten new assistant browser scenarios plus 78 existing Guide,
AI, Jev, helper/naming, table and desktop scenarios passed against the dummy HA
with writes intercepted. The assistant panel screenshot was visually inspected.

The subsequent floating-window correction passed TypeScript, production build,
all 1,381 unit/API tests and 21 relevant browser scenarios: 14 assistant flows
and seven table/layout regressions. Desktop and mobile screenshots were visually
inspected. Additional checks cover unchanged page width, half-height bounds,
short screens, long-reply scrolling, fixed composer, Enter/Shift+Enter, and
Escape/focus behavior for collapsed options.
