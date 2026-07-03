# Tutorial: installing and running auto-thinking-pi

This tutorial walks you through cloning the repository, running the check
suite, loading the extension into a running Pi coding-agent, and confirming
that classification is applied to your prompts. If you follow every step, you
will end up with a working local install and a visible decision log in Pi.

This is a learning-oriented walkthrough. For task-focused instructions see
[`how-to.md`](./how-to.md); for the API surface see [`reference.md`](./reference.md);
for the rationale behind the design see [`design.md`](./design.md).

## Prerequisites

- [Bun](https://bun.sh) 1.1 or newer (`bun --version`). The `exports` map
  targets raw `.ts` files, so the classifier only imports cleanly from a
  Bun or Pi runtime; plain Node ESM would need a TS loader.
- A working install of the Pi coding agent that exposes the
  `@earendil-works/pi-coding-agent` extension host (tested against Pi
  `0.80.x`). This project only declares Pi as a peer dependency; it does
  not bring Pi with it.

You do not need any API keys, network access, or credentials to build or test
this package. The classifier is pure and local.

## 1. Clone and install

```sh
git clone https://github.com/acoyfellow/auto-thinking-pi.git
cd auto-thinking-pi
bun install
```

This repository is **not published to npm**. `package.json` is
`"private": true`; install from GitHub only. See the top of the README for
the distribution note.

`bun install` will resolve `devDependencies` (Biome, TypeScript, Bun types,
and the Pi packages used for `import type` only) into `node_modules/`.

## 2. Run the check suite

```sh
bun run check
```

This runs three steps in sequence:

1. `biome check .` — formatting and lint.
2. `tsc --noEmit` — TypeScript strict-mode typecheck.
3. `bun test` — the test suite over `test/cases.json`.

All three must be green. If any step fails, stop here and fix it before
continuing; the loaded extension will not behave correctly if the classifier
tests do not pass.

## 3. Load the extension into Pi

The extension entrypoint is `extensions/pi/index.ts`, declared in the `pi`
block of `package.json`:

```json
"pi": {
  "extensions": ["./extensions/pi/index.ts"]
}
```

Point Pi at the local checkout:

```sh
pi -e /absolute/path/to/auto-thinking-pi
```

Pi will import the default export of `extensions/pi/index.ts` and invoke it
with its `ExtensionAPI`. The extension registers one `input` handler and one
`/autothink` command.

## 4. Send a prompt and inspect the decision

From the Pi prompt, type any user message, for example:

```
fix the bug where users lose their session intermittently
```

Under the hood the extension calls `classify(text)` and then
`pi.setThinkingLevel(level)` before Pi builds the provider request for this
turn. It does not rewrite your prompt.

Now inspect the last decision:

```
/autothink
```

You will see something like:

```
auto-thinking is ON
[12:03:45] "fix the bug where users lose their session..." -> medium (difficulty signal 'fix', ...)
```

The ring buffer holds the 20 most recent decisions in memory (constant
`RING_SIZE` in `extensions/pi/index.ts`). It is not persisted across Pi
sessions.

## 5. Toggle the classifier off and on

```
/autothink off      # disables level-setting; Pi's default effort resumes
/autothink on       # re-enables level-setting
/autothink          # with no arg, toggles current state
```

When disabled, the input handler is still installed but exits early with
`{ action: "continue" }`, so your prompt is untouched and no level is set.

## 6. What you have now

You have a local checkout that passes the check suite, and a running Pi with
per-turn heuristic thinking levels. The classifier is deterministic, pure,
and dependency-free at runtime; nothing you have installed reaches the
network. To go further, see:

- [`how-to.md`](./how-to.md) for tuning the classifier for your own workload,
  toggling the anti-under-think floor, or using the classifier outside of Pi.
- [`reference.md`](./reference.md) for the exported API and the classifier's
  scoring rules.
- [`design.md`](./design.md) for why the classifier is asymmetric and what
  the measured error modes look like.
