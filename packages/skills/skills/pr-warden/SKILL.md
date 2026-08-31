---
name: pr-warden
description: Diagnose and safely restore pull-request health without merging.
---

# PR Warden

Identify the pull request and reread its current head, checks, conflicts, and
unresolved review feedback. Distinguish stale failures from failures caused by
the change, then make only safe fixes within the requested PR scope.

Re-check state after each material update and summarize what remains. Never
merge, approve on the operator's behalf, dismiss human feedback, or rewrite
shared history unless explicitly authorized.
