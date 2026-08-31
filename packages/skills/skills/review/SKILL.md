---
name: review
description: Review a working tree, branch, or pull request and report only evidence-backed findings.
---

# Review

Identify the requested change boundary before reviewing. Keep the review
read-only, inspect the complete relevant diff, and trace changed behavior into
callers, tests, and configuration where needed.

Prioritize correctness, regressions, security, data loss, and missing tests.
Report findings in severity order with concrete file and line references. Do
not invent issues to fill a quota. If nothing actionable is found, say so and
name any verification gaps.
