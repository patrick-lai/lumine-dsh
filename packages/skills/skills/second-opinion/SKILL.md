---
name: second-opinion
description: Produce a fresh independent review of a completed change.
---

# Second Opinion

Review the current change independently from its implementation rationale.
Read the actual diff and enough surrounding code to test its assumptions.
Remain read-only.

Focus on concrete correctness, regression, security, maintainability, and test
coverage risks. Return only actionable findings with file and line evidence,
followed by residual risks or a clear statement that no findings were found.
