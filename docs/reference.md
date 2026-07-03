# Reference

Information-oriented description of the surfaces of `auto-thinking-pi`.
Everything here is checked against the source in `src/heuristic.ts`,
`src/types.ts`, and `extensions/pi/index.ts`.

## Package layout

| Path | Purpose |
| --- | --- |
| `src/heuristic.ts` | Pure classifier. No dependency on Pi at runtime. |
| `src/types.ts` | Re-exports `ThinkingLevel` (type-only) from `@earendil-works/pi-agent-core`; declares `ClassifierEmittedLevel`, the documented subset `classify()` returns. |
| `extensions/pi/index.ts` | Pi extension entrypoint. Wires classifier to `ExtensionAPI`. |
| `test/cases.json` | Labeled tuned + held-out + adversarial cases. |
| `test/classifier.test.ts` | Invariant tests over the labeled sets. |
| `test/extension.test.ts` | Extension lifecycle tests against a mocked `ExtensionAPI`. |

## `package.json` metadata

- `name`: `auto-thinking-pi`.
- `version`: `0.0.1`. Pinned by project convention — see
  [`SECURITY.md`](../SECURITY.md).
- `private`: `true`. Not published to npm.
- `type`: `module` (ESM only).
- `exports`:
  - `.` and `./heuristic` → `./src/heuristic.ts`
  - `./extension` → `./extensions/pi/index.ts`
  Raw `.ts` targets: importable from Bun and Pi natively; from plain Node
  ESM only with a TS loader.
- `pi.extensions`: `["./extensions/pi/index.ts"]` — how Pi discovers the
  extension entrypoint.
- `files`: `src/`, `extensions/`, `README.md`, `LICENSE`, `CHANGELOG.md`.
  Kept in place for consumers who git-clone or reference by tag; there is
  no npm publish step.
- `peerDependencies`: `@earendil-works/pi-agent-core` and
  `@earendil-works/pi-coding-agent`, both `>=0.60.0 <1.0.0`, both required.
  The extension only uses these as `import type`, and `src/types.ts`
  re-exports `ThinkingLevel` from `@earendil-works/pi-agent-core`
  (type-only).
- `engines.bun`: `>=1.3.0` (the committed text lockfile uses Bun's current lockfile format).

## Public API

```ts
// Re-exported from `@earendil-works/pi-agent-core`; on Pi 0.80.x this is
// "off" | "minimal" | "low" | "medium" | "high" | "xhigh".
export type { ThinkingLevel } from "@earendil-works/pi-agent-core";

// Documented subset that `classify()` is allowed to return. Every member
// exists in every supported peer version. `"minimal"` is intentionally NOT
// returned — the classifier's asymmetric objective prefers `"low"` at the
// bottom.
export type ClassifierEmittedLevel = "off" | "low" | "medium" | "high" | "xhigh";

export interface Classification {
  level: ThinkingLevel;  // in practice, always a ClassifierEmittedLevel
  /** Human-readable justification, used in logs and /autothink output. */
  reason: string;
}

export function classify(promptText: string): Classification;
```

### `classify(promptText)` guarantees

- **Pure and synchronous.** No I/O, no globals mutated, no async work.
- **Deterministic.** Same input always returns an equal `Classification`.
  Enforced by the "classify is pure and deterministic" test.
- **Safe on empty and whitespace-only input.** Returns
  `{ level: "low", reason: "empty prompt (default)" }` for empty input;
  behaves as if untrimmed input were trimmed for other cases.
- **Safe on non-string input.** Returns
  `{ level: "low", reason: "non-string input (default)" }` for `null`,
  `undefined`, numbers, arrays, etc. Enforced by the "safe on non-string
  input" test.
- **Stable under trailing or leading whitespace.** Enforced by the
  "classifier is stable under trailing whitespace" test.
- **Returns a `ClassifierEmittedLevel`** (a subset of `ThinkingLevel`).

### Scoring model

`classify` sums three families of signals into an integer score and maps the
score to a `ThinkingLevel`. Every rule below corresponds to a block in
`src/heuristic.ts`.

**Keyword signals**

- `HARD_WORDS` matches `+3` and adds a `mentions '…'` reason. Examples:
  `refactor`, `debug`, `race condition`, `concurrency`, `deadlock`,
  `optimize`, `security`, `migration`, `schema`, `latency`, `scan`, and the
  full regex in the source.
- `DIFFICULTY_SIGNALS` matches `+2` and adds a `difficulty signal '…'`
  reason. Examples: `fix`, `why`, `diagnose`, `investigate`, `intermittent`,
  `stale`, `flaky`, `leak`, `hangs`, `algorithm`.
- `STRONG_TRIVIAL` markers (`typo`, `rename`, `capitalize`, `lowercase`,
  `uppercase`, `comment out`, `add a comment`, `bump the version`,
  `format this/the`) suppress `DIFFICULTY_SIGNALS` — but **not**
  `HARD_WORDS`.
- `LOW_WORDS` matches `-2` and adds a `trivial '…'` reason, but only when no
  hard signal fires.

**Length signals**

- word count `> 120` → `+2` (`long prompt`).
- word count `> 40` → `+1` (`medium-length prompt`).
- word count `<= 4` and no hard signal → `-1` (`very short prompt`).

**Code density**

- Two or more fenced code blocks (``` ``` ```) → `+2`.
- One fenced code block → `+1`.

**File references**

- Three or more distinct file-path-shaped tokens → `+2`.
- Exactly two → `+1`.

**Lookup-question shape**

- A prompt that starts with `what/who/when/where + is/are/was/were` and has
  no hard signal → `-1`.

**Anti-under-think floor**

If no hard signal is present, the running score is `<= 0`, and neither a
`LOW_WORDS` nor a `STRONG_TRIVIAL` marker matched, the score is overwritten
to `2` (`medium`). This is a **general** rule, not gated on word count: it
catches both vague multi-word imperatives (`fix the auth flow`) and short
keyword-free technical prompts (`oom`, `gc pauses`). The reason line
records `keyword-free prompt -> medium (anti-under-think floor)`.

### Score → level

| Score | Level |
| --- | --- |
| ≤ -2 | `off` |
| -1 or 0 | `low` |
| 1 or 2 | `medium` |
| 3 or 4 | `high` |
| ≥ 5 | `xhigh` |

## Extension surface

The extension registers exactly two things on the `ExtensionAPI`:

- An `on("input", handler)` handler.
- A `registerCommand("autothink", { description, handler })` command.

### `input` handler

```ts
pi.on("input", async (event, _ctx) => { ... });
```

Behaviour:

- If the extension is disabled (`enabled === false`) or the event's
  `source` is `"extension"`, the handler returns `{ action: "continue" }`
  immediately. It does not call `setThinkingLevel` and does not record a
  decision.
- If the event is **image-only** (empty or whitespace-only `text` with a
  non-empty `images` array), the handler returns `{ action: "continue" }`
  and does **not** call `setThinkingLevel`. Pi's default effort applies
  for image-only turns. Image-only prompts are more likely to be
  visual-debugging than typo fixes, and forcing `low` (which the pure
  classifier would return for empty text) is the wrong safe choice here.
- Otherwise it calls `classify(event.text)`, then
  `pi.setThinkingLevel(level)`, then records a decision in the ring buffer.
- It always returns `{ action: "continue" }`. It never rewrites, blocks, or
  duplicates user input.

### `/autothink` command

```
/autothink            # no arg -> if the arg is empty, print status; otherwise toggle
/autothink on         # enable
/autothink off        # disable
/autothink status     # print state and up to 20 decisions
/autothink log        # alias for status
```

Any unrecognized non-empty argument toggles the enabled state.

### Decision ring buffer

- `RING_SIZE = 20` in `extensions/pi/index.ts`.
- Older entries are dropped by shift when the buffer overflows.
- Not persisted across Pi restarts.
- Each entry stores: `timestamp` (locale time string), `snippet` (first 60
  chars of the prompt with an ellipsis for longer prompts), `level`, and
  `reason`.

## Peer dependencies

```
@earendil-works/pi-agent-core     >=0.60.0 <1.0.0
@earendil-works/pi-coding-agent   >=0.60.0 <1.0.0
```

Both are used only as `import type` in `extensions/pi/index.ts`. Tests do
not import the real Pi runtime; they exercise the extension against a
hand-rolled mock in `test/extension.test.ts` that implements only the three
`ExtensionAPI` methods the extension uses (`on`, `setThinkingLevel`,
`registerCommand`).

## Test suite (`bun test`)

The suite lives in `test/classifier.test.ts` and `test/extension.test.ts`.
It exercises the following invariants; if any of these ever fail, the
package is broken.

- **Never under-thinks a labeled hard prompt.** Every prompt in `hard`
  classifies at `medium` or higher.
- **Never under-thinks a held-out hard prompt.** Same, over `heldOutHard`.
  This is the load-bearing generalization test.
- **Never over-thinks a labeled trivial prompt into `high` or `xhigh`.**
- **Held-out trivial prompts stay at most `medium`.** The invariant here is
  intentionally weaker than for the tuned trivial set, to admit the
  documented safe-over-thinking cases.
- **Labeled medium prompts land somewhere in `low..high`.**
- **Adversarial `expectedMin` / `expectedMax` bounds hold** for every
  entry in `cases.adversarial`.
- **Known safe-over-thinking cases stay documented.** At least one
  `knownOverThink: true` entry exists in `cases.adversarial` and each such
  entry has a note that includes `safe-over-thinking`.
- **Reason is always non-empty** for every labeled case.
- **`classify` is stable under leading and trailing whitespace.**
- **`classify` returns a valid `ThinkingLevel`.**
- **Extension lifecycle**: registers `/autothink` and an `input` handler;
  sets a level on user input; does not set a level on `source ==
  "extension"` input; `/autothink on|off` gates level-setting; `/autothink
  status` prints state and populated ring; ring buffer is bounded at 20;
  unknown arg toggles state; every input handler return value is
  `{ action: "continue" }`.

## Measured labeled-set distributions

The following counts are produced by running `classify` over the checked-in
`test/cases.json`. They are reproducible from the checked-in code and
verified by the test suite. See the [Method section of the
README](../README.md#method) for what each group is and is not evidence of.

- Tuned hard set (n = 20): 0 under-thinks.
- Tuned medium set (n = 8): all at `medium`.
- Tuned trivial set (n = 10): all at `off`; 0 at `high`/`xhigh`.
- `heldOutHard` (n = 12), literal-overfit lock: 0 under-thinks. Nine prompts
  match a difficulty regex atom; this set guards exact-prompt overfitting,
  not keyword-blind generalization.
- `heldOutHardKeywordBlind` (n = 12), keyword-blind generalization: 0
  under-thinks. Every prompt in this group is verified to match no
  `HARD_WORDS` or `DIFFICULTY_SIGNALS` atom.
- Held-out trivial set (n = 7): all at `off`; 0 at `high`/`xhigh`.
- Adversarial set: every `expectedMin` / `expectedMax` bound holds. The
  `knownOverThink: true` cases (see [`design.md`](./design.md)) classify at
  `high`/`xhigh` by design — this is the tolerated safe-over-thinking
  direction.
