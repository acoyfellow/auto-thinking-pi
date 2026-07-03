## Summary

<!-- what changed and why -->

## Classifier impact

- [ ] This PR does not change classification behaviour.
- [ ] This PR changes classification behaviour. New/changed cases are added to `test/cases.json`.

If classifier behaviour changed, paste the output of `bun test` here so we can see the distribution:

```
<paste `bun test` output>
```

## Checklist

- [ ] `bun run check` is green (biome + tsc + tests)
- [ ] I did not delete labeled cases from `test/cases.json`
- [ ] Held-out hard set still shows 0 under-thinks
- [ ] No new runtime dependencies (peer deps only)
- [ ] Docs updated if behaviour, API, or metrics changed
- [ ] CHANGELOG.md updated under `[Unreleased]`
