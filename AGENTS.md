@C:\Users\david\.codex\RTK.md

## RTK usage

Prefer `rtk` for supported routine shell commands to reduce command-output tokens. For exact source/line references, security review, machine-readable output, or authoritative test/release evidence, preserve the full original output and use `rtk bypass <command>` when needed. Compressed summaries do not replace required checks or prove coverage.

## Runners on box.davidcas.net

Never stop, disable or mask a runner listed in `/etc/runner-warm-policy/always-warm.list` (davidcasnet `dc-runner-dcn1`, oikonomika `dc-runner-oik1`). Those repos' CI has no other runner. David decided this on 2026-10-23, and it replaces the 2026-09-07 "only MFA Portal and App-bricks remain warm" receipt for those units. To change it, ask David first.

## Model roles when the coding agent is OpenAI Codex

- All coding must be performed by GPT-6.1 Terra (`gpt-6.1-terra`), using `medium`, `high`, or `xhigh` reasoning effort according to the difficulty of the task.
- GPT-6.1 Sol (`gpt-6.1-sol`) must inspect every Terra result, request corrections when needed, and inspect corrected results before the work is considered complete.
- These model-role requirements apply when the coding agent is OpenAI Codex.
