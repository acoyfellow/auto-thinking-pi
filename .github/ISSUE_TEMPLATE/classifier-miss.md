---
name: Classifier miss
about: A prompt was classified at the wrong thinking level
title: "classifier: <prompt snippet> -> <level>, expected <level>"
labels: bug, classifier
assignees: ''
---

## Prompt

Paste the exact prompt text (redact any secrets). One prompt per issue.

```
<prompt here>
```

## Observed level

- Level returned: <off | low | medium | high | xhigh>
- Reason string: <copy the `reason` field, e.g. `mentions 'refactor', ...`>

## Expected level

- What you expected: <off | low | medium | high | xhigh>
- Why: <one or two sentences on what makes this prompt that difficulty>

## Direction of miss

- [ ] Under-thinking (hard prompt got low/off) — **priority: high**
- [ ] Over-thinking (trivial prompt got high/xhigh) — priority: medium
- [ ] Wrong medium tier (medium prompt outside low..high) — priority: low

## Additional context

- Version: <output of `git describe --tags` or npm version>
- Bun version: <`bun --version`>
- Anything the classifier could not have known (context, followups)?
