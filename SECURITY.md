# Security Policy

## Supported Versions

`auto-thinking-pi` is a pre-release project pinned at `0.0.1`. There is no
stable release, no published npm artifact, and **no compatibility promise**.
Only the current tip of `main` at version `0.0.1` receives best-effort
security fixes.

| Version | Supported |
| --- | --- |
| 0.0.1 (`main`, best-effort, no compatibility promise) | :white_check_mark: |
| everything else | :x: |

Consumers should track `main` on GitHub rather than pin a version. If a
security fix lands, it lands as a new commit on `main` and the version stays
at `0.0.1` (project convention).

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security reports.

Report vulnerabilities through GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on this repository. If that is unavailable, open a **draft security advisory** on the repository and include:

- a description of the vulnerability,
- steps to reproduce (a minimal prompt or input, if applicable),
- the version affected,
- any suggested remediation.

We will acknowledge your report within 7 days. Please give us a reasonable window (typically 30–90 days) to publish a fix before public disclosure.

## Scope

In scope:

- The classifier (`src/heuristic.ts`) — e.g. catastrophic-backtracking regex, resource exhaustion on adversarial input.
- The extension (`extensions/pi/index.ts`) — e.g. handler crashes, unbounded memory growth in the decision ring buffer, unintended side effects on user input.
- Anything that would let a crafted prompt cause the extension to modify, drop, or exfiltrate the user's input.

Out of scope:

- The Pi coding-agent runtime itself. Report those to the Pi maintainers.
- Third-party dependencies (report upstream first, then to us if we need to update).
- Denial of service from _valid_ but very long prompts. The classifier is O(n) in prompt length by design.
