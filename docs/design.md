# Design and rationale

Understanding-oriented explanation of why `auto-thinking-pi` is shaped the
way it is. This document is not a spec; for that see
[`reference.md`](./reference.md). It documents the trade-offs and error
modes so future contributors can change the classifier without reintroducing
regressions the current tests already prevent.

## Problem

A coding agent has a per-turn "thinking" or "reasoning-effort" level. Higher
levels tend to be more correct on hard problems and cost more time and
tokens on easy ones. The user rarely wants to set this manually. Nothing on
the prompt itself tells us in advance what the right level is — but for most
prompts, cheap surface features are enough to make a defensible choice.

The obvious alternative — ask a small model to classify the prompt — is
self-defeating. Any classifier call has to be cheaper than the difference in
reasoning cost between the levels it might pick, or the whole scheme loses
money. Regexes, word counts, and code-fence counts are essentially free at
sub-100-word prompt length and require no runtime dependencies.

## Asymmetric objective

Under- and over-thinking are not equally bad:

- **Under-thinking** a hard prompt: the agent returns a wrong or partial
  answer. The cost is correctness. The user then re-prompts, wasting a
  larger amount of time and often another turn's worth of tokens anyway.
- **Over-thinking** a trivial prompt: the agent returns a correct answer,
  more slowly and more expensively. The cost is latency and tokens.

We chose to bias every ambiguous case toward the more expensive but more
correct outcome. Concretely:

- The score-to-level table is set so mid-scores land at `medium`, not `low`.
- A "difficulty signal" verb (`fix`, `why`, `diagnose`) adds `+2` all by
  itself, and a single one is enough to reach `medium`.
- A **general** anti-under-think floor in `src/heuristic.ts` floors any
  prompt to `medium` when it has no `HARD_WORDS`, no
  `DIFFICULTY_SIGNALS`, and no explicit trivial marker (`LOW_WORDS` /
  `STRONG_TRIVIAL`). This catches vague multi-word imperatives (`fix the
  auth flow`, `make it work`) AND short keyword-free technical prompts
  (`oom`, `gc pauses`, `n+1 queries`) that carry no lexical signal but
  are almost never truly trivial.

The **zero-under-thinking invariant on the tuned, `heldOutHard`, and
`heldOutHardKeywordBlind` sets** is the primary correctness claim of this
project. The tests `never under-thinks a hard prompt`, `never under-thinks
a held-out hard prompt`, and `keyword-blind hard prompts land >= medium
(general anti-under-think rule)` in `test/classifier.test.ts` enforce it,
and running `classify` over the checked-in `test/cases.json` shows every
one of the 20 tuned hard prompts, every one of the 12 `heldOutHard`
prompts, and every one of the 12 `heldOutHardKeywordBlind` prompts at
`medium` or above (see the distributions in
[`reference.md`](./reference.md#measured-labeled-set-distributions)).

## Held-out sets

Rules that are tuned against a labeled set will eventually overfit it. The
usual defence is a held-out sample the tuner never sees while iterating.
This project keeps **two** held-out groups, with different jobs, because a
single group would be too easy to game:

1. **`heldOutHard` — literal-overfit lock.** Independently authored, but
   the vocabulary overlaps with `HARD_WORDS` / `DIFFICULTY_SIGNALS` on
   purpose. Its job is to catch a change that edits the regex to only
   match the exact tuning-set literals. It is **not** evidence of
   generalization; treating it as such would be an oversell (previous
   drafts of this document did — see `SF-1` in the review receipt).
2. **`heldOutHardKeywordBlind` — genuine generalization signal.** Every
   prompt was chosen to match **no** `HARD_WORDS` or
   `DIFFICULTY_SIGNALS` atom (verified programmatically). Examples:
   `oom`, `gc pauses`, `n+1 queries`, `cpu spikes at 3am`, `heap
   fragmentation`, `segfault on shutdown`, `quorum lost`. If the
   classifier keeps these at `medium`+, it is doing so through the
   general anti-under-think floor rule, not through a literal. If a
   contributor "improves" the classifier by adding acronyms and literals
   to the regex, that group will still hold today's rate; only the
   general rule can meaningfully improve it.

If either held-out group regresses, the change has overfit. Broaden the
general rule rather than pile on more literal cases. `CONTRIBUTING.md`
codifies this.

## Signal families

The classifier scores three families independently and clamps interactions
between them:

1. **Explicit keywords.** `HARD_WORDS` (+3) and `LOW_WORDS` (-2, and only
   when no hard signal fires). This gets you the easy cases —
   `refactor the auth module`, `rename foo to bar`.
2. **Implicit difficulty.** `DIFFICULTY_SIGNALS` (+2). This is the signal
   family that catches keyword-free hard prompts, which turned out to be
   the majority of the tuned and held-out hard sets. `fix`, `why`, and
   `diagnose` alone account for most of the coverage.
3. **Structural.** Word count, fenced code blocks, referenced file paths,
   and lookup-question shape. These are pure syntax; they nudge the score
   without ever being decisive on their own.

`STRONG_TRIVIAL` (typo, rename, format-this, ...) suppresses
`DIFFICULTY_SIGNALS` but not `HARD_WORDS`. This is the compromise that
makes `fix the typo` classify at `off` while keeping
`fix the race condition` at `xhigh`.

## Known limitations and safe over-thinking

The actual invariant is: **any prompt containing a `HARD_WORD` anywhere
will be escalated regardless of the surrounding task**. The classifier
cannot cheaply tell whether a hard-word is being *mentioned* (in a file
path, in an identifier, in a definitional question) versus *worked on*.
The `cases.adversarial` group in `test/cases.json` documents this with
representative cases marked `knownOverThink: true`:

- `"fix the typo in the concurrency doc"` → `xhigh`. Trivial typo fix,
  but `concurrency` is a strong hard word.
- `"rename the helper called debug"` → `high`. Trivial rename, but the
  identifier being renamed happens to be a hard word.
- `"what is a race condition"` → `high`. Definitional lookup about a
  hard word.
- `"rename foo to bar in security/auth.ts"` → `high`. Mechanical
  rename, but the file path contains `security`.

These are illustrative, not exhaustive: the same failure mode fires for any
similarly shaped prompt. All are wrong in the direction we chose to
tolerate — extra reasoning on a trivial task. None can be fixed cheaply
without weakening the hard-word signal, which would risk under-thinking a
legitimate hard prompt.

The test `known safe-over-thinking cases are documented, not silently
fixed` in `test/classifier.test.ts` requires at least one `knownOverThink`
case to remain and requires every such case's `note` to contain the phrase
`safe-over-thinking`. Anyone who finds a real fix must remove
`knownOverThink` from the case and update this document — the test forbids
silently making the case disappear.

## What the classifier does NOT try to do

- **Detect intent (feature / bugfix / question).** Only difficulty.
- **Understand semantics.** It is regexes and counts, nothing more.
- **Handle non-English prompts.** The signal vocabulary is English only.
  A prompt in another language will typically flow through the length and
  structural rules only.
- **Persist state across runs.** The decision ring buffer is in-memory per
  Pi session, sized at 20 entries.
- **Change what the agent does with a level.** The extension calls
  `pi.setThinkingLevel`; the rest is up to Pi. In particular, if the
  current Pi model does not support a level, Pi's own clamping applies.

## Why no external dependencies at runtime

The classifier is dependency-free by design. Adding a dependency to a
per-turn hook creates supply-chain and latency risk for no benefit — every
signal used is expressible in five to ten lines of TypeScript. The peer
dependencies on `@earendil-works/pi-agent-core` and
`@earendil-works/pi-coding-agent` are `import type` only in the extension
source; the classifier itself compiles without them.

## Why a ring buffer, not a log file

The decision buffer is a debugging aid, not an audit log. In-memory keeps
it obvious that no user prompt content leaves the process. If you need
persistent auditing, wrap `classify` in a separate module you control and
write to your own store — the extension itself is intentionally minimal.

## What would justify a bigger change

- A large-scale evaluation showing that the current asymmetric bias is
  wrong for a realistic workload. The current bias assumes correctness is
  more expensive to lose than latency; if that is not true in your
  environment, the score-to-level table is the right place to change it.
- A drop-in signal (still O(n), still local, still English-optional) that
  disambiguates topic-of-mention from topic-of-work well enough to remove
  a `knownOverThink` case without regressing either hard set. That would
  be a real improvement, not a rewrite.
