/**
 * Extension lifecycle tests.
 *
 * The extension entrypoint (`extensions/pi/index.ts`) targets the Pi coding
 * agent's `ExtensionAPI` shape. We do not want to pull the real agent into
 * unit tests, so we exercise the extension against a hand-rolled mock that
 * implements just the surface the extension actually uses: `on("input", ...)`,
 * `setThinkingLevel(level)`, and `registerCommand(name, { description, handler })`.
 *
 * These tests verify:
 *   - On a user `input` event, the extension calls `setThinkingLevel` with a
 *     level derived from the classifier (never `undefined`).
 *   - On an `input` event whose `source === "extension"`, the extension does
 *     NOT call `setThinkingLevel` (no feedback loops from programmatic input).
 *   - The `/autothink` command toggles enabled/disabled and, when disabled,
 *     subsequent inputs are pass-through with no level change.
 *   - `/autothink status` reports state and (once populated) the ring buffer.
 *   - Every handler returns `{ action: "continue" }` so we never rewrite input.
 */

import { describe, expect, test } from "bun:test";
// Import via a dynamic path — the module has `.ts` extension per Bun/ESM config.
import autoThinking from "../extensions/pi/index.ts";

function requireDefined<T>(value: T | undefined, name: string): T {
	if (value === undefined) throw new Error(`${name} is undefined`);
	return value;
}

type Level = "off" | "low" | "medium" | "high" | "xhigh";

interface Notification {
	message: string;
	kind: string;
}

interface RegisteredCommand {
	description: string;
	handler: (args: string, ctx: MockCtx) => Promise<void> | void;
}

interface MockCtx {
	ui: {
		notify: (message: string, kind: string) => void;
	};
}

function createMockPi() {
	const inputHandlers: Array<(event: unknown, ctx: MockCtx) => Promise<unknown>> = [];
	const commands: Record<string, RegisteredCommand> = {};
	const levelCalls: Level[] = [];
	const notifications: Notification[] = [];

	const ctx: MockCtx = {
		ui: {
			notify: (message: string, kind: string) => {
				notifications.push({ message, kind });
			},
		},
	};

	const pi = {
		on(event: string, handler: (event: unknown, ctx: MockCtx) => Promise<unknown>) {
			if (event === "input") inputHandlers.push(handler);
		},
		setThinkingLevel(level: Level) {
			levelCalls.push(level);
		},
		registerCommand(name: string, spec: RegisteredCommand) {
			commands[name] = spec;
		},
	};

	async function fireInput(event: unknown) {
		const results: unknown[] = [];
		for (const h of inputHandlers) results.push(await h(event, ctx));
		return results;
	}

	return { pi, ctx, commands, levelCalls, notifications, fireInput };
}

describe("extension lifecycle", () => {
	test("registers the /autothink command and an input handler", async () => {
		const m = createMockPi();
		// biome-ignore lint/suspicious/noExplicitAny: mock ExtensionAPI surface.
		await autoThinking(m.pi as any);
		expect(m.commands.autothink).toBeDefined();
		expect(m.commands.autothink?.description).toContain("auto-thinking");
	});

	test("sets a thinking level on a user input event and returns { action: 'continue' }", async () => {
		const m = createMockPi();
		// biome-ignore lint/suspicious/noExplicitAny: mock ExtensionAPI surface.
		await autoThinking(m.pi as any);

		const results = await m.fireInput({
			text: "fix the bug where users lose their session intermittently",
			source: "user",
		});

		expect(m.levelCalls.length).toBe(1);
		const first = m.levelCalls[0];
		if (first === undefined) throw new Error("no level recorded");
		expect(["medium", "high", "xhigh"]).toContain(first);
		expect(results[0]).toEqual({ action: "continue" });
	});

	test("classifies a trivial input at most medium", async () => {
		const m = createMockPi();
		// biome-ignore lint/suspicious/noExplicitAny: mock ExtensionAPI surface.
		await autoThinking(m.pi as any);

		await m.fireInput({ text: "rename foo to bar", source: "user" });

		expect(m.levelCalls.length).toBe(1);
		const first = m.levelCalls[0];
		if (first === undefined) throw new Error("no level recorded");
		expect(["off", "low", "medium"]).toContain(first);
	});

	test("does NOT set a level for image-only input (empty text + images)", async () => {
		const m = createMockPi();
		// biome-ignore lint/suspicious/noExplicitAny: mock ExtensionAPI surface.
		await autoThinking(m.pi as any);

		const results = await m.fireInput({
			text: "",
			images: [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }],
			source: "user",
		});

		// Image-only turn: extension leaves Pi's default effort in place.
		expect(m.levelCalls.length).toBe(0);
		expect(results[0]).toEqual({ action: "continue" });
	});

	test("does NOT set a level for whitespace-only text + images", async () => {
		const m = createMockPi();
		// biome-ignore lint/suspicious/noExplicitAny: mock ExtensionAPI surface.
		await autoThinking(m.pi as any);

		const results = await m.fireInput({
			text: "   \n\t",
			images: [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }],
			source: "user",
		});

		expect(m.levelCalls.length).toBe(0);
		expect(results[0]).toEqual({ action: "continue" });
	});

	test("still classifies when text is present alongside images", async () => {
		const m = createMockPi();
		// biome-ignore lint/suspicious/noExplicitAny: mock ExtensionAPI surface.
		await autoThinking(m.pi as any);

		await m.fireInput({
			text: "why does this deadlock",
			images: [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }],
			source: "user",
		});

		expect(m.levelCalls.length).toBe(1);
	});

	test("does NOT throw when event.text is a non-string (defensive runtime guard)", async () => {
		const m = createMockPi();
		// biome-ignore lint/suspicious/noExplicitAny: mock ExtensionAPI surface.
		await autoThinking(m.pi as any);

		// Pi's spec says text is a string; the extension still guards at runtime
		// so a mistyped upstream call doesn't crash the whole input pipeline.
		const results = await m.fireInput({ text: undefined, source: "user" });

		expect(results[0]).toEqual({ action: "continue" });
		// Non-string text classifies as `low` per the documented safe default.
		expect(m.levelCalls.at(-1)).toBe("low");
	});

	test("does NOT set a level for extension-sourced input", async () => {
		const m = createMockPi();
		// biome-ignore lint/suspicious/noExplicitAny: mock ExtensionAPI surface.
		await autoThinking(m.pi as any);

		const results = await m.fireInput({
			text: "fix the bug where users lose their session intermittently",
			source: "extension",
		});

		expect(m.levelCalls.length).toBe(0);
		expect(results[0]).toEqual({ action: "continue" });
	});

	test("/autothink off disables level-setting; /autothink on re-enables it", async () => {
		const m = createMockPi();
		// biome-ignore lint/suspicious/noExplicitAny: mock ExtensionAPI surface.
		await autoThinking(m.pi as any);
		const cmd = requireDefined(m.commands.autothink, "autothink command");
		expect(cmd).toBeDefined();

		await cmd.handler("off", m.ctx);
		await m.fireInput({ text: "why does this deadlock", source: "user" });
		expect(m.levelCalls.length).toBe(0);

		await cmd.handler("on", m.ctx);
		await m.fireInput({ text: "why does this deadlock", source: "user" });
		expect(m.levelCalls.length).toBe(1);

		// Notifications went out for both toggles.
		const messages = m.notifications.map((n) => n.message);
		expect(messages.some((s) => s.includes("disabled"))).toBe(true);
		expect(messages.some((s) => s.includes("enabled"))).toBe(true);
	});

	test("/autothink status reports state and populated ring buffer", async () => {
		const m = createMockPi();
		// biome-ignore lint/suspicious/noExplicitAny: mock ExtensionAPI surface.
		await autoThinking(m.pi as any);
		const cmd = requireDefined(m.commands.autothink, "autothink command");

		const last = () => {
			const n = m.notifications.at(-1);
			if (!n) throw new Error("no notification recorded");
			return n;
		};

		// Empty state
		await cmd.handler("status", m.ctx);
		expect(last().message).toContain("No decisions logged yet");

		// Populate ring
		await m.fireInput({ text: "refactor the auth module", source: "user" });
		await cmd.handler("status", m.ctx);
		expect(last().message).toContain("auto-thinking is ON");
		expect(last().message).toContain("refactor");
	});

	test("ring buffer is bounded (does not grow unbounded)", async () => {
		const m = createMockPi();
		// biome-ignore lint/suspicious/noExplicitAny: mock ExtensionAPI surface.
		await autoThinking(m.pi as any);
		const cmd = requireDefined(m.commands.autothink, "autothink command");

		for (let i = 0; i < 50; i++) {
			await m.fireInput({ text: `debug case ${i}`, source: "user" });
		}
		await cmd.handler("log", m.ctx);
		const lastNotif = m.notifications.at(-1);
		if (!lastNotif) throw new Error("no notification recorded");
		const rendered = lastNotif.message;
		// RING_SIZE=20, so at most 20 rendered lines.
		const lines = rendered.split("\n").filter((l) => l.startsWith("["));
		expect(lines.length).toBeLessThanOrEqual(20);
	});

	test("/autothink with unknown arg toggles current state", async () => {
		const m = createMockPi();
		// biome-ignore lint/suspicious/noExplicitAny: mock ExtensionAPI surface.
		await autoThinking(m.pi as any);
		const cmd = requireDefined(m.commands.autothink, "autothink command");

		// Starts enabled -> unknown arg disables
		await cmd.handler("garbage", m.ctx);
		await m.fireInput({ text: "debug", source: "user" });
		expect(m.levelCalls.length).toBe(0);

		// Toggle again -> re-enables
		await cmd.handler("whatever", m.ctx);
		await m.fireInput({ text: "debug", source: "user" });
		expect(m.levelCalls.length).toBe(1);
	});
});
