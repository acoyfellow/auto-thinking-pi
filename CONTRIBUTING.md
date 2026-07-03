# Contributing to auto-thinking-pi

Thanks for your interest. This project is small and opinionated — please read this file before opening a PR.

## Ground rules

1. **The hard-set test is load-bearing.** `never under-thinks a hard prompt (hard >= medium)` must always be 100% on the tuned hard set, the `heldOutHard` literal-overfit lock, and the `heldOutHardKeywordBlind` keyword-blind generalization set. If your change regresses any of them, it will not be merged even if it improves other metrics.
2. **Add cases before rules.** If the classifier misbehaves for a prompt you care about, first add it to `test/cases.json` under the correct bucket (`hard`, `medium`, `trivial`, `heldOutHard`, `heldOutHardKeywordBlind`, `heldOutTrivial`, or `adversarial`). Then adjust the classifier so the test passes without regressing the others.
3. **Do not delete labeled cases** without explaining why the case was mislabeled. Cases encode invariants.
4. **No new hard dependencies.** The classifier must stay dependency-free. Peer dependencies on `@earendil-works/pi-*` are the only allowed runtime peers.
5. **No emojis in source, tests, or docs** unless explicitly asked for by a maintainer.

## Local setup

```sh
bun install
bun run check
```

`bun run check` runs Biome (`biome check .`), TypeScript (`tsc --noEmit`), and the test suite. All three must be green.

## Style

- TypeScript strict mode. `noUncheckedIndexedAccess` is on.
- Tabs for indentation, `\n` line endings, 100-column soft limit. Biome enforces this — run `bun run format` before pushing.
- Prefer named exports for the classifier surface; the extension keeps its `export default` (Pi loads extensions by their default export).
- Public functions get JSDoc comments explaining _why_, not _what_.

## Adding cases

- Hard: prompts a competent engineer would need to think about — debugging, correctness under concurrency, non-trivial algorithms, cross-file refactors.
- Medium: single-file, mechanical-but-non-trivial coding tasks.
- Trivial: renames, typos, formatting, factual lookups.
- `heldOutHard`: written independently, may overlap with tuning-set vocabulary. Job: catch a regex edited to only match tuning literals.
- `heldOutHardKeywordBlind`: prompts that match no `HARD_WORDS` or `DIFFICULTY_SIGNALS` atom. Job: catch overfitting to acronyms/literals. If you add a prompt here, verify it matches no atom before committing (`node --input-type=module -e "const p=process.argv[1]; console.log(p.match(/…/i))" '<prompt>'` or similar).
- `heldOutTrivial`: written independently, never inspected during rule-tuning. Do not move a held-out case into the tuning set to make the tests pass.
- Adversarial: individual prompts with `expectedMin` / `expectedMax` bounds. Mark documented limitations with `knownOverThink: true` and a note that includes `safe-over-thinking`.

## Filing an issue

Please use the templates under `.github/ISSUE_TEMPLATE`. For classifier bugs, include the exact prompt text, the level you got, and the level you expected.

## Security

See [`SECURITY.md`](./SECURITY.md) for how to report vulnerabilities.

## Code of conduct

By participating, you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).
