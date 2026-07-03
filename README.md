# auto-thinking-pi

A Pi coding-agent extension that classifies prompt difficulty with a **pure local heuristic** and sets the `thinking` / reasoning-effort level for the upcoming turn — with **no extra model call**.

- Zero network, zero async work; the classifier is a pure synchronous function over regex, word counts, and code-fence counts.
- Never rewrites your prompt; only calls `pi.setThinkingLevel(level)` on the extension API.
- `/autothink` command to toggle and inspect recent decisions.

Version `0.0.1`. TypeScript, ESM, **Bun-only** at import time (the exports
target `./src/*.ts` and `./extensions/pi/*.ts` directly, which Bun and Pi
both resolve natively; plain Node ESM requires a TS loader). Biome
formatter/linter.

Distribution is **GitHub-only**: the `package.json` is `"private": true` and
this repo is not published to npm. Install by cloning or by git URL.

## Docs

- [`docs/tutorial.md`](./docs/tutorial.md) — install the package and load the
  extension into Pi from scratch.
- [`docs/how-to.md`](./docs/how-to.md) — recipes for toggling, inspecting,
  tuning, and using the classifier outside Pi.
- [`docs/reference.md`](./docs/reference.md) — exact API, scoring rules,
  extension surface, and measured labeled-set distributions.
- [`docs/design.md`](./docs/design.md) — why the classifier is asymmetric,
  what the held-out sets exist to prevent, and the documented
  safe-over-thinking cases.

The sections below are a condensed overview of the same material.

---

## Get started

Prerequisites: [Bun](https://bun.sh) ≥ 1.3, and a working Pi coding-agent install exposing the `@earendil-works/pi-coding-agent` extension host (currently tested against Pi `0.80.x`).

```sh
git clone https://github.com/acoyfellow/auto-thinking-pi.git
cd auto-thinking-pi
bun install
bun run check       # biome + tsc + tests
```

To load the extension into Pi:

```sh
pi -e /absolute/path/to/auto-thinking-pi
```

(Pi discovers extensions via the `pi.extensions` array in `package.json`; this repo declares `./extensions/pi/index.ts`.)

Once loaded, every user prompt is classified and its `thinking` level applied before the turn starts. Type `/autothink` in Pi to view the ring buffer of recent decisions.

---

## Use and tune it

### Toggle the classifier

- `/autothink on` — enable
- `/autothink off` — disable (Pi's default effort behaviour is restored)
- `/autothink` with no arg toggles

### Inspect recent decisions

`/autothink` or `/autothink status` prints the last 20 classifications with the prompt snippet, resulting level, and human-readable reason string (e.g. `mentions 'refactor', references 2 files`).

### Use the classifier from other code

The classifier is exported independently of the extension. Because the
`exports` map points at raw `.ts` files, this only works from a Bun or Pi
runtime (both resolve TS extensions natively). Plain Node ESM would require
a TS loader.

```ts
// From a local checkout, or a git-installed dependency (there is no npm
// artifact — see the "Distribution" note at the top of this README):
import { classify } from "auto-thinking-pi/heuristic";

classify("fix the bug where users lose their session intermittently");
// -> { level: "medium", reason: "difficulty signal 'fix', ..." }
```

### Tune for your own workload

1. Add prompts to `test/cases.json` under `hard`, `medium`, or `trivial`. **Never remove** existing cases without justification — they encode invariants.
2. Run `bun test`. The hard-set test **must remain 100%** — under-thinking is the dangerous direction.
3. If the held-out sets regress, you overfit; broaden the regexes rather than adding more literals.

### Turn off the anti-under-think floor

Edit `src/heuristic.ts` and delete the block labelled `--- floor: a keyword-free imperative...`. Do this only if you have direct control over cost and would rather occasionally under-think. The default ships with the floor on.

---

## Scoring details

### Files

| Path | Purpose |
| --- | --- |
| `src/heuristic.ts` | Pure classifier. No dependencies on Pi at runtime. |
| `src/types.ts` | Re-exports `ThinkingLevel` from `@earendil-works/pi-agent-core` (type-only) and declares `ClassifierEmittedLevel`, the documented subset `classify()` returns. |
| `extensions/pi/index.ts` | Pi extension entrypoint; wires classifier to `ExtensionAPI`. |
| `test/cases.json` | Labeled tuned + held-out + adversarial cases. |
| `test/classifier.test.ts` | Invariant tests over the labeled sets. |
| `test/extension.test.ts` | Extension lifecycle tests against a mocked `ExtensionAPI`. |

### Public API

```ts
// `ThinkingLevel` is re-exported from `@earendil-works/pi-agent-core` so the
// two stay in lockstep. As of Pi 0.80.x that is:
//   "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
// `classify()` only emits a documented subset (never "minimal"); see
// `ClassifierEmittedLevel` in `src/types.ts`.
export type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export interface Classification {
  level: ThinkingLevel;
  reason: string;    // human-readable, comma-joined signal list
}

export function classify(promptText: string): Classification;
```

`classify` is:

- pure and synchronous,
- deterministic (same input → same output),
- safe on empty / whitespace-only input,
- safe on non-string input (returns a documented `low` default rather than throwing),
- stable under leading/trailing whitespace.

### Extension surface

The extension registers:

- One `on("input", …)` handler that classifies non-extension-sourced inputs and calls `pi.setThinkingLevel(level)`.
- One command, `/autothink`, with subcommands `on`, `off`, `status` / `log`.

The handler always returns `{ action: "continue" }` — it never rewrites, blocks, or duplicates the user's input.

### Peer dependencies

```
@earendil-works/pi-agent-core     >=0.60.0 <1.0.0
@earendil-works/pi-coding-agent   >=0.60.0 <1.0.0
```

Both are `import type` only in the extension source; the tests exercise the extension against a hand-rolled mock and do not require the Pi agent runtime.

### `/autothink` command output

```
auto-thinking is ON
[12:03:45] "fix the bug where users lose their session..." -> medium (difficulty signal 'fix', ...)
[12:04:02] "rename foo to bar" -> off (trivial 'rename', very short prompt)
```

Ring buffer size: 20 (compile-time constant `RING_SIZE`).

### Signal families

The classifier scores three signal families independently and clamps interactions between them:

1. **Explicit keywords.** `HARD_WORDS` (+3) and `LOW_WORDS` (-2 clamp, suppressed once any hard signal fires).
2. **Implicit difficulty.** `DIFFICULTY_SIGNALS` (fix/why/diagnose/intermittent/…) (+2). Suppressed by `STRONG_TRIVIAL` markers (typo/rename/…) unless `HARD_WORDS` also fires.
3. **Structural.** Word count, fenced code blocks, referenced file paths, lookup-question shape.

Score → level thresholds:

| Score | Level |
| --- | --- |
| ≤ -2 | off |
| -1 … 0 | low |
| 1 … 2 | medium |
| 3 … 4 | high |
| ≥ 5 | xhigh |

A **general anti-under-think floor** forces `medium` on any prompt that has
no `HARD_WORD`, no `DIFFICULTY_SIGNAL`, and no explicit trivial marker
(`LOW_WORDS` / `STRONG_TRIVIAL`). It catches both vague multi-word
imperatives (`fix the auth flow`) and short technical prompts (`oom`, `gc
pauses`) that carry no lexical signal but are almost never truly trivial.
This is the anti-under-thinking backstop.

---

## Why it works / tradeoffs

### Why heuristics, not a model call

The point of setting a thinking level is to _save_ effort. Spending a whole model call to decide whether the next call should think harder is a losing trade unless the classifier is much cheaper than the difference in reasoning cost. Cheap deterministic signals — length, code fences, filenames, a small keyword grammar — get most of the signal for essentially free.

### Why the asymmetric objective

Under- and over-thinking are not equally bad:

- **Under-thinking** a hard prompt gives you a wrong or partial answer. Cost: correctness.
- **Over-thinking** a trivial prompt gives you a correct answer more slowly and more expensively. Cost: latency and tokens.

So the classifier is deliberately biased toward higher levels when signals are ambiguous. Trivial-marked prompts (`typo`, `rename`) are only pulled down when nothing hard is happening around them.

### Method

The heuristic was iterated against an adversarial labeled set in
`test/cases.json`. Every number below is computed by running `classify` over
that checked-in file; the test suite (`bun test`) will fail if any of them
regresses.

- **Tuned hard set (n=20):** `0/20` under-thinks (all land at `medium`+).
- **Tuned trivial set (n=10):** `0/10` at `high` or `xhigh` (all land at
  `off`).
- **Tuned medium set (n=8):** all land at `medium` (`low..high` allowed).

Two separate held-out groups are used, and they serve **different** purposes.
Please do not read either as a clean generalization number.

- **`heldOutHard` (n=12) — literal-overfit lock.** These prompts were
  written independently of the tuning corpus, but their vocabulary
  overlaps deliberately with the `HARD_WORDS` / `DIFFICULTY_SIGNALS`
  regexes. `hangs`, `leaks`, `trace`, `why`, `figure out`, `reproduce`,
  `flaky`, `diagnose`, `sometimes`, `correctly`, `end to end` all appear
  both in the regex and in the held-out prompts. The purpose of this group
  is not to prove generalization; it is to prove that the regex was not
  edited to exactly match the tuning prompts. Measured under-think rate:
  `0/12`.
- **`heldOutHardKeywordBlind` (n=12) — genuine generalization signal.**
  These prompts were chosen to match **no** `HARD_WORDS` or
  `DIFFICULTY_SIGNALS` regex atom (verified programmatically). Examples:
  `oom`, `gc pauses`, `n+1 queries`, `cpu spikes at 3am`, `cascade of
  500s`, `heap fragmentation`, `segfault on shutdown`, `quorum lost`. If
  the classifier keeps these at `medium`+, it is doing so through the
  general anti-under-think floor rule, not through a literal. Measured
  under-think rate: `0/12`.
- **Held-out trivial set (n=7):** all land at `off`.

Anything stronger than "these two counts survive on the checked-in corpus"
would be an oversell. In particular, the classifier is not evaluated against
prompts in languages other than English, or against agent-generated /
templated prompts.

### Known limitations (safe over-thinking)

The classifier **cannot cheaply disambiguate the topic-of-mention from the
topic-of-work**. When a `HARD_WORD` appears anywhere in the prompt — as the
subject, in a file path, in an identifier being renamed, or in a
definitional question — the whole prompt is escalated. The following
`knownOverThink` cases live in `test/cases.json` under `adversarial`:

- `"fix the typo in the concurrency doc"` — trivial task, but
  `concurrency` is a strong hard word. Classified `xhigh`.
- `"rename the helper called debug"` — trivial rename, but the identifier
  being renamed matches a hard word. Classified `high`.
- `"what is a race condition"` — definitional lookup about a hard word.
  Classified `high`.
- `"rename foo to bar in security/auth.ts"` — mechanical rename, but the
  file path contains the hard word `security`. Classified `high`.

More generally: **any prompt containing a `HARD_WORD` anywhere will be
escalated regardless of the surrounding task**. This is the actual
invariant; the cases above are illustrative examples, not an exhaustive
list. All are wrong in the direction we chose to tolerate — extra reasoning
on a trivial task. None can drop below `medium` today without weakening
the hard-word signal, which would risk under-thinking legitimate hard work.
If you have a fix that keeps both the tuned and keyword-blind hard sets at
100%, please open a PR — the tests are structured so a fix would remove
`knownOverThink` from the affected cases and update this section.

### What the classifier does NOT try to do

- Detect intent (feature vs. bugfix vs. question). Only difficulty.
- Understand semantics. It's regexes + counts.
- Handle non-English prompts. English signal vocabulary only.
- Persist state across runs. The decision ring buffer is in-memory per Pi session.

---

## Development

```sh
bun install
bun run check     # biome + tsc --noEmit + bun test
bun run format    # biome format --write
bun run lint      # biome lint
bun run typecheck # tsc --noEmit
bun test          # tests only
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the contribution flow and [`SECURITY.md`](./SECURITY.md) to report vulnerabilities.

## License

MIT — see [`LICENSE`](./LICENSE).
