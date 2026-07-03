# Changelog

All notable changes to this project will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- `package.json` is now `"private": true` (GitHub-only distribution; no npm publish).
- `repository`, `bugs`, `homepage`, and the tutorial/README clone URLs point to the real owner.
- `SECURITY.md` rewritten to state the fixed-`0.0.1` / `main`-tip / best-effort policy accurately.
- `src/types.ts` re-exports `ThinkingLevel` from `@earendil-works/pi-agent-core` (type-only) and declares `ClassifierEmittedLevel`, the documented subset `classify()` returns.
- Classifier: the "very short prompt" penalty now only applies when an explicit trivial marker is also present. Keyword-free short prompts (e.g. `oom`, `gc pauses`) rely on the general anti-under-think floor.
- Classifier: the anti-under-think floor is now a **general** rule — any prompt with no `HARD_WORDS`, no `DIFFICULTY_SIGNALS`, and no explicit trivial marker floors to `medium` regardless of word count.
- Classifier: added runtime non-string safety. `classify(null | undefined | number | …)` returns `{ level: "low", reason: "non-string input (default)" }` rather than throwing.
- Extension: image-only turns (empty/whitespace text with images) no longer force `low`; the extension skips `setThinkingLevel` and Pi's default effort applies.
- README/design/reference: rewrote the Method / held-out language to distinguish the literal-overfit lock from the keyword-blind generalization group; broadened the known safe-over-thinking limitations.

### Added

- `test/cases.json` gains `heldOutHardKeywordBlind` — 12 prompts that match no `HARD_WORDS` or `DIFFICULTY_SIGNALS` atom (verified). New test asserts the classifier keeps them at `medium`+.
- Two additional documented safe-over-thinking cases: `what is a race condition` and `rename foo to bar in security/auth.ts`.
- `test/pi-conformance.test.ts` — compile-time and narrow-runtime conformance against the pinned Pi peer types (`ExtensionFactory`, `ExtensionAPI`, `InputEvent`, `ThinkingLevel`). Limitation stated explicitly: this does not boot Pi's real `ExtensionRunner` end-to-end.
- CI matrix over Bun `1.1` and `1.3`; placeholder / personal-path grep gate.

## [0.0.1] - 2026-07-03

### Added

- Initial public release.
- Pure synchronous prompt-difficulty classifier (`src/heuristic.ts`) mapping prompt text to a `ThinkingLevel` (`off | low | medium | high | xhigh`).
- Pi coding-agent extension (`extensions/pi/index.ts`) that classifies each user `input` event and calls `pi.setThinkingLevel(level)` before the turn.
- `/autothink` command with `on` / `off` / `status` / `log` subcommands and a 20-entry in-memory decision ring buffer.
- Labeled test corpus (`test/cases.json`) covering tuned hard/medium/trivial sets, an independently written held-out set, and an adversarial set including two documented safe-over-thinking limitations.
- 29-test suite: classifier invariants (never under-think hard, never over-think trivial into high/xhigh, medium prompts stay in low..high), held-out generalization, adversarial min/max bounds, purity/determinism, whitespace stability, and full extension lifecycle tests against a mocked `ExtensionAPI`.
- Repository scaffolding: `package.json` with Pi metadata, Biome + TypeScript config, GitHub CI workflow, issue/PR templates, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, MIT license.

### Measured (see README "Method")

- Tuned hard set: 0/20 under-thinks.
- Tuned trivial set: 0/10 land at `high` or `xhigh`.
- Held-out hard literal-overfit lock: 0/12 under-thinks (9/12 match a
  difficulty regex atom; this is not the keyword-blind generalization set).
- Held-out trivial set: 0/7 land at `high` or `xhigh`.

### Known limitations

- Two documented safe-over-thinking cases: a hard-word appearing anywhere in the prompt (e.g. "typo in the concurrency doc", "rename the helper called debug") escalates the whole prompt. This is a correctness-preserving failure mode by design; see README "Known limitations".
