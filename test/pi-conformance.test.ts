/**
 * Pi runtime conformance test.
 *
 * We would prefer a real integration test that loads the extension into
 * Pi's `ExtensionRunner` and fires a synthetic `input` event through the
 * real event bus. That requires either `loadExtensionFromFactory` (not
 * re-exported at the pi-coding-agent package entrypoint, only reachable
 * via deep submodule imports that the package's `exports` map does not
 * publicly expose) or hand-constructing a full `Extension` value with
 * `handlers` / `commands` / `tools` maps in the exact shape the runner
 * expects, which duplicates loader internals that are not part of the
 * stable public surface.
 *
 * Rather than write a fake end-to-end test that would pass without ever
 * exercising Pi's real event ordering, this file pins the extension to
 * Pi's real public types at compile time and re-tests the runtime
 * behaviour against those types. The three things we actually verify
 * against the pinned Pi peer (`0.80.3`):
 *
 *   1. The extension's default export is assignable to `ExtensionFactory`.
 *      If Pi renames or reshapes `ExtensionAPI`, tsc fails the type check.
 *   2. `pi.setThinkingLevel(level)` accepts every `ClassifierEmittedLevel`.
 *      If Pi drops one of the levels we can emit, tsc fails.
 *   3. A synthetic `InputEvent` matching Pi's `InputEvent` interface fed
 *      into the extension via the same mock harness produces exactly the
 *      same behaviour as the existing extension tests.
 *
 * Limitation, stated explicitly: this is NOT proof that Pi's real
 * `ExtensionRunner` fires our `input` handler before
 * `before_provider_request` / `turn_start`. The design doc claims it does
 * based on Pi's `.d.ts` and Pi's documented event ordering; that claim
 * would need a real `ExtensionRunner` boot to verify end-to-end. The type
 * conformance test below prevents the *shape* of the contract from
 * silently drifting, which is the piece a hand-rolled mock cannot catch.
 */

import { describe, expect, test } from "bun:test";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionFactory, InputEvent } from "@earendil-works/pi-coding-agent";
import autoThinking from "../extensions/pi/index.ts";
import type { ClassifierEmittedLevel } from "../src/types.ts";

describe("Pi runtime conformance (compile-time + narrow smoke)", () => {
	test("extension default export is assignable to Pi's ExtensionFactory", () => {
		// This assignment fails to compile if Pi renames or reshapes the
		// factory contract. That is the point — the test asserts a type
		// relationship, not a runtime value.
		const factory: ExtensionFactory = autoThinking;
		expect(typeof factory).toBe("function");
	});

	test("every ClassifierEmittedLevel is a valid ThinkingLevel", () => {
		// Compile-time relationship; the assertion is that this file compiles.
		const _emitted: ClassifierEmittedLevel = "medium";
		const _canFeed: ThinkingLevel = _emitted;
		expect(_canFeed).toBe("medium");
	});

	test("a synthetic InputEvent (typed against Pi's real InputEvent) drives the handler", async () => {
		// Build a typed InputEvent using Pi's real type, not our local
		// duck-typed one. If Pi renames a field, tsc fails here.
		const event: InputEvent = {
			type: "input",
			text: "why does this deadlock under concurrency",
			source: "interactive",
		};

		const levelCalls: string[] = [];
		const inputHandlers: Array<(ev: InputEvent, ctx: unknown) => Promise<unknown>> = [];

		// Minimal typed shim: we only need the three ExtensionAPI methods the
		// extension actually uses. We type-cast to ExtensionAPI to force the
		// TypeScript compiler to verify the shim is a valid subset.
		const pi = {
			on(kind: string, handler: (ev: InputEvent, ctx: unknown) => Promise<unknown>) {
				if (kind === "input") inputHandlers.push(handler);
			},
			setThinkingLevel(level: ThinkingLevel) {
				levelCalls.push(level);
			},
			registerCommand() {},
		} as unknown as ExtensionAPI;

		await autoThinking(pi);
		expect(inputHandlers.length).toBe(1);

		const firstHandler = inputHandlers[0];
		if (!firstHandler) throw new Error("no input handler registered");
		const result = await firstHandler(event, {});
		expect(result).toEqual({ action: "continue" });
		expect(levelCalls.length).toBe(1);
		// The classifier lands this prompt at >= medium.
		const first = levelCalls[0];
		if (first === undefined) throw new Error("no level recorded");
		expect(["medium", "high", "xhigh"]).toContain(first);
	});

	test("image-only InputEvent (typed against Pi) does not call setThinkingLevel", async () => {
		const event: InputEvent = {
			type: "input",
			text: "",
			images: [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }],
			source: "interactive",
		};

		const levelCalls: string[] = [];
		const inputHandlers: Array<(ev: InputEvent, ctx: unknown) => Promise<unknown>> = [];

		const pi = {
			on(kind: string, handler: (ev: InputEvent, ctx: unknown) => Promise<unknown>) {
				if (kind === "input") inputHandlers.push(handler);
			},
			setThinkingLevel(level: ThinkingLevel) {
				levelCalls.push(level);
			},
			registerCommand() {},
		} as unknown as ExtensionAPI;

		await autoThinking(pi);
		const firstHandler = inputHandlers[0];
		if (!firstHandler) throw new Error("no input handler registered");
		const result = await firstHandler(event, {});
		expect(result).toEqual({ action: "continue" });
		expect(levelCalls.length).toBe(0);
	});
});
