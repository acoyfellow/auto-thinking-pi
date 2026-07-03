/**
 * `ThinkingLevel` is defined by the Pi coding agent (via `@earendil-works/pi-agent-core`).
 * We re-export it here as `import type` so this package's core classifier and its
 * consumers see the SAME union as Pi does — including the `"minimal"` member
 * added in Pi 0.80.x. Any classifier output must be assignable to this union.
 *
 * This is type-only. `bun test` does NOT need the peer runtime; the tests exercise
 * the extension against a hand-rolled mock (see `test/extension.test.ts`).
 *
 * If you are on a Pi version older than the one whose types were pinned, this
 * package's peer range (`>=0.60.0 <1.0.0`) still holds because the classifier
 * only emits a common subset of members that has always been present.
 */
export type { ThinkingLevel } from "@earendil-works/pi-agent-core";

/**
 * Documented subset of `ThinkingLevel` that this classifier is allowed to
 * return. All members exist in every supported Pi peer version in the
 * declared peer range. `"minimal"` is deliberately NOT returned by
 * `classify()` because it was not present in older peer versions and the
 * classifier's asymmetric objective (never under-think) prefers `"low"` at
 * the very bottom of the range. If you want `"minimal"` behaviour, set it
 * yourself downstream from `Classification.level`.
 */
export type ClassifierEmittedLevel = "off" | "low" | "medium" | "high" | "xhigh";
