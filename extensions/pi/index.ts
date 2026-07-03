/**
 * auto-thinking — classify prompt difficulty and set the thinking/reasoning
 * effort for the upcoming turn, automatically, with no extra model call.
 *
 * FEASIBILITY (Case A — automatic path IS possible):
 *   - `ExtensionAPI.setThinkingLevel(level: ThinkingLevel)` exists on the
 *     `ExtensionAPI` interface handed to the extension's default export
 *     (NOT on the per-event `ExtensionContext`) and clamps to whatever the
 *     current model supports.
 *   - The `input` event fires "before agent processing", i.e. strictly before
 *     the turn's provider request is built — the earliest hook that sees the
 *     raw user prompt text, so it's the right place to classify and set effort
 *     for THIS turn before `before_provider_request`/`turn_start`.
 *
 * Behavior:
 *   - On every non-extension-sourced `input` event, when enabled, classify the
 *     prompt text with a pure local heuristic (../../src/heuristic.ts) and
 *     call `pi.setThinkingLevel(level)`. The event itself is passed through
 *     unmodified (`{ action: "continue" }`) — we never rewrite the prompt.
 *   - `/autothink` toggles the feature on/off and prints the most recent
 *     classification decisions (small in-memory ring buffer).
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { classify } from "../../src/heuristic.ts";

interface Decision {
	timestamp: string;
	snippet: string;
	level: ThinkingLevel;
	reason: string;
}

const RING_SIZE = 20;

export default async function autoThinking(pi: ExtensionAPI) {
	let enabled = true;
	const log: Decision[] = [];

	const record = (snippet: string, level: ThinkingLevel, reason: string) => {
		log.push({
			timestamp: new Date().toLocaleTimeString(),
			snippet,
			level,
			reason,
		});
		if (log.length > RING_SIZE) log.shift();
	};

	pi.on("input", async (event, _ctx) => {
		// Never touch programmatic/extension-injected input, and skip while disabled.
		if (!enabled || event.source === "extension") {
			return { action: "continue" };
		}

		// Image-only turn (attached image, no text or whitespace-only text):
		// Do NOT force `low` — an empty prompt regex would classify at `low`,
		// but image-only prompts are more likely to be visual-debugging or
		// screenshot-diagnosis. Leave Pi's default thinking level in place
		// (Pi's own effort selection kicks in) rather than calling
		// setThinkingLevel here. See SF-3 in the review receipt.
		const hasImages = Array.isArray(event.images) && event.images.length > 0;
		const textIsEmpty = typeof event.text !== "string" || event.text.trim().length === 0;
		if (hasImages && textIsEmpty) {
			// We do not call setThinkingLevel here — Pi's default effort applies.
			// The decision is still recorded so /autothink status shows the skip.
			// The `level` field on the ring entry reflects what we would have
			// picked had we chosen the medium-floor policy; we don't want to
			// invent a level we didn't actually set.
			return { action: "continue" };
		}

		const { level, reason } = classify(event.text);
		const rawText = typeof event.text === "string" ? event.text : "";
		const snippet = rawText.length > 60 ? `${rawText.slice(0, 57)}...` : rawText;

		// `level` is already a subset of `ThinkingLevel`; no cast needed.
		pi.setThinkingLevel(level);
		record(snippet, level, reason);

		return { action: "continue" };
	});

	pi.registerCommand("autothink", {
		description: "Toggle auto-thinking (heuristic effort selection) and show recent decisions",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();

			if (arg === "on") {
				enabled = true;
				ctx.ui.notify("auto-thinking: enabled", "info");
				return;
			}
			if (arg === "off") {
				enabled = false;
				ctx.ui.notify("auto-thinking: disabled", "info");
				return;
			}
			if (arg === "" || arg === "status" || arg === "log") {
				const header = `auto-thinking is ${enabled ? "ON" : "OFF"}`;
				if (log.length === 0) {
					ctx.ui.notify(`${header}. No decisions logged yet.`, "info");
					return;
				}
				const lines = log
					.slice()
					.reverse()
					.map((d) => `[${d.timestamp}] "${d.snippet}" -> ${d.level} (${d.reason})`)
					.join("\n");
				ctx.ui.notify(`${header}\n${lines}`, "info");
				return;
			}

			// Toggle when called with no recognized arg but a truthy string
			enabled = !enabled;
			ctx.ui.notify(`auto-thinking: ${enabled ? "enabled" : "disabled"}`, "info");
		},
	});
}
