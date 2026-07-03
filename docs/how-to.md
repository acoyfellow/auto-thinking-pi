# How-to guides

Recipes for using and tuning `auto-thinking-pi`. Each section assumes you
have completed [`tutorial.md`](./tutorial.md) and can run `bun run check`
green.

## Toggle the classifier at runtime

Inside Pi:

- `/autothink on` — enable classification and per-turn level setting.
- `/autothink off` — disable it. The `input` handler still runs but returns
  `{ action: "continue" }` immediately without calling `setThinkingLevel`.
- `/autothink` with no argument, or `/autothink garbage`, toggles the current
  state. See the "unknown arg toggles" behaviour in
  `extensions/pi/index.ts`.

## Inspect recent decisions

- `/autothink`, `/autothink status`, and `/autothink log` all print the same
  view: the current enabled/disabled state on the first line, then up to
  20 recent decisions in reverse chronological order.
- Each rendered line has the shape
  `[HH:MM:SS] "snippet..." -> level (reason)` where `reason` is the
  comma-joined signal list produced by `classify`.
- The ring buffer holds 20 entries (`RING_SIZE` in
  `extensions/pi/index.ts`) and is in-memory per Pi session. Restarting Pi
  clears it.

## Use the classifier without Pi

The classifier is exported independently of the extension. It has no
dependency on the Pi runtime.

```ts
import { classify } from "auto-thinking-pi";
// or from the sub-path export:
import { classify } from "auto-thinking-pi/heuristic";

const { level, reason } = classify(
  "fix the bug where users lose their session intermittently",
);
// level  -> "medium" | "high" | "xhigh" | "low" | "off"
// reason -> "difficulty signal 'fix', ..."
```

`classify` is pure, synchronous, and safe on empty or whitespace-only input.
Same input always produces the same output.

## Tune the classifier for your workload

The classifier is graded by the test suite over `test/cases.json`. To adjust
its behaviour:

1. **Add a case, don't just edit a rule.** Put the problematic prompt into
   `test/cases.json` under the correct bucket (`hard`, `medium`, `trivial`,
   `heldOutHard`, `heldOutHardKeywordBlind`, `heldOutTrivial`, or
   `adversarial`) with a note that explains the intended behaviour.
2. Run `bun test`. If your new case regresses the hard-set test — that is,
   any labeled hard prompt classifies below `medium` — you must fix the
   classifier, not the test.
3. Update the regexes in `src/heuristic.ts`. Prefer broadening
   `DIFFICULTY_SIGNALS` or `HARD_WORDS` over adding new special cases; a
   handful of general patterns generalises better than a long list of
   literals. This is the lesson encoded in the held-out set.
4. Re-run `bun run check`. Do not delete labeled cases to make a test pass.
   The rules in `CONTRIBUTING.md` treat labeled cases as invariants.

## Turn off the anti-under-thinking floor

The classifier has a floor that maps keyword-free prompts (any word count)
to `medium` rather than `low`. If you would rather occasionally under-think
a vague or short prompt than pay for it, delete the block labelled

```
// --- floor: a keyword-free prompt with no trivial marker is ambiguous.
```

in `src/heuristic.ts`. Expect the adversarial cases `fix the auth flow`,
`make it work`, and the entire `heldOutHardKeywordBlind` set to drop from
`medium` to `low` and the corresponding assertions in
`test/classifier.test.ts` to fail. Update those assertions (or the
classifier) accordingly.

## Add or remove commands

The extension registers exactly one command (`/autothink`) via
`pi.registerCommand`. To add a command, follow the same pattern in
`extensions/pi/index.ts`: pass a `description` and an async `handler(args,
ctx)` and use `ctx.ui.notify(message, level)` to write to the Pi UI.

## Debug a classification you disagree with

1. Run `bun test` locally to confirm nothing is broken.
2. Import `classify` in a scratch script and inspect the `reason` field. It
   is the comma-joined signal list produced during scoring; each fragment
   points to which rule fired.
3. Compare against the score table in [`reference.md`](./reference.md).
4. If the classifier is wrong, add the case to `test/cases.json` before you
   change any rule. See "Tune the classifier for your workload" above.

## Report a classifier miss

Use the `.github/ISSUE_TEMPLATE/classifier-miss.md` template. Include the
exact prompt (redact any secrets), the level you got, and the level you
expected. The maintainers will typically ask you to add the prompt to
`test/cases.json` in the same PR.
