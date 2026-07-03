/**
 * Pure, synchronous prompt-difficulty classifier (v1, no model call).
 *
 * Maps a user prompt to a ThinkingLevel (`off | low | medium | high | xhigh`)
 * from cheap, deterministic signals — no network, no async.
 *
 * Design notes (learned from an adversarial eval — see `test/cases.json`):
 *   - The dangerous failure is UNDER-thinking: a genuinely hard debugging or
 *     reasoning task rated `off`/`low`. Most hard coding prompts contain NO
 *     explicit "hard" keyword ("fix the bug where users lose their session"),
 *     so keyword matching alone floors them. We therefore score three families
 *     of signal, not just keywords:
 *       1. explicit hard/trivial keywords,
 *       2. implicit difficulty verbs + symptom language (debug/diagnose/why/
 *          intermittent/stale/race), which catch keyword-free hard work,
 *       3. structure (length, code blocks, multi-file).
 *   - A single "trivial" keyword must NOT cancel strong difficulty signals, so
 *     the trivial pull is clamped and never applies once hard signals fire.
 *   - Ambiguous, keyword-free imperatives ("fix the bug", "make it work")
 *     default to `medium`, not `low` — cheap insurance against under-thinking.
 */

import type { ClassifierEmittedLevel, ThinkingLevel } from "./types.ts";

/** Explicit strong "hard work" nouns/verbs. */
const HARD_WORDS =
	/\b(refactor|debug(?:ging)?|architect(?:ure)?|design|race[ -]?condition|concurren(?:cy|t)|deadlock|prove|proof|invariant|optimi[sz]e|security|vulnerab|migrat|distributed|consisten(?:cy|t)|thread[- ]safe|memory leak|performance|regression|root cause|trade[- ]?off|schema|latency|scan)\b/i;

/**
 * Implicit difficulty: debugging/reasoning verbs + symptom language that mark
 * hard work even with no HARD_WORDS. These are what keyword-only matching
 * missed (fix/why/diagnose/intermittent/…).
 */
const DIFFICULTY_SIGNALS =
	/\b(fix|why|diagnose|trace|figure out|investigat|reproduce|handle the edge case|end to end|survive|blow the stack|full table scan|drops? connection|not add up|correctly|intermittent(?:ly)?|sometimes|stale|flaky|hangs?|leak|undefined sometimes|fails? in ci|efficient(?:ly)?|permutation|algorithm|complexity)\b/i;

/** Explicit trivial work. Pull is clamped and suppressed when hard signals fire. */
const LOW_WORDS =
	/\b(rename|typo|format(?:ting)?|list the|what is|hello world|capitali[sz]e|lowercase|uppercase|comment out|add a comment|bump (?:the )?version)\b/i;

/**
 * Strong trivial markers that OVERRIDE difficulty verbs: "fix the typo" is
 * trivial even though "fix" is a difficulty signal. When one of these is
 * present the prompt is treated as trivial regardless of soft difficulty verbs
 * (but NOT regardless of explicit HARD_WORDS).
 */
const STRONG_TRIVIAL =
	/\b(typo|rename|capitali[sz]e|lowercase|uppercase|comment out|add a comment|bump (?:the )?version|format(?:ting)? (?:this|the))\b/i;

const CODE_BLOCK_RE = /```/g;
const FILE_PATH_RE = /(?:^|[\s(,])([\w./-]+\.\w{1,6})(?=[\s),.:;]|$)/g;

export interface Classification {
	level: ThinkingLevel;
	/** Human-readable justification, used in logs and /autothink output. */
	reason: string;
}

export function classify(promptText: string): Classification {
	// Runtime non-string guard. The public function type is `string`, but the
	// extension entrypoint hands us `event.text` at runtime and JS callers can
	// pass anything; we return a documented safe default rather than throw.
	// See test/classifier.test.ts "safe on non-string input".
	if (typeof promptText !== "string") {
		return { level: "low", reason: "non-string input (default)" };
	}
	const text = promptText.trim();
	if (text.length === 0) return { level: "low", reason: "empty prompt (default)" };

	const reasons: string[] = [];
	let score = 0;

	const hardMatch = text.match(HARD_WORDS);
	// A strong trivial marker suppresses soft difficulty verbs ("fix the typo"),
	// but never suppresses an explicit HARD_WORD.
	const strongTrivial = !hardMatch && STRONG_TRIVIAL.test(text);
	const diffMatch = strongTrivial ? null : text.match(DIFFICULTY_SIGNALS);
	const hasHardSignal = Boolean(hardMatch || diffMatch);

	// --- keyword signals ---
	if (hardMatch) {
		score += 3;
		reasons.push(`mentions '${hardMatch[0]}'`);
	}
	if (diffMatch) {
		score += 2;
		reasons.push(`difficulty signal '${diffMatch[0]}'`);
	}
	// Trivial pull only when NO hard signal is present, and clamped to -2 so one
	// trivial word can never sink a hard task.
	if (!hasHardSignal) {
		const lowMatch = text.match(LOW_WORDS);
		if (lowMatch) {
			score -= 2;
			reasons.push(`trivial '${lowMatch[0]}'`);
		}
	}

	// --- length signal (word count) ---
	const wordCount = text.split(/\s+/).filter(Boolean).length;
	const hasExplicitTrivial = LOW_WORDS.test(text) || STRONG_TRIVIAL.test(text);
	if (wordCount > 120) {
		score += 2;
		reasons.push("long prompt");
	} else if (wordCount > 40) {
		score += 1;
		reasons.push("medium-length prompt");
	} else if (wordCount <= 4 && !hasHardSignal && hasExplicitTrivial) {
		// Very short AND no hard signal AND an explicit trivial marker -> trivial.
		// We used to also penalise unexplained short prompts here, but that led
		// to keyword-free short technical prompts like "oom" and "gc pauses"
		// landing at `low`. The anti-under-think floor below now catches those
		// safely; only the explicitly-trivial short-prompt case gets the pull.
		score -= 1;
		reasons.push("very short prompt");
	}

	// --- code density signal ---
	const codeBlockCount = (text.match(CODE_BLOCK_RE) ?? []).length / 2;
	if (codeBlockCount >= 2) {
		score += 2;
		reasons.push("multiple code blocks");
	} else if (codeBlockCount >= 1) {
		score += 1;
		reasons.push("code block present");
	}

	// --- multi-file signal ---
	const fileMatches = new Set(Array.from(text.matchAll(FILE_PATH_RE), (m) => m[1]));
	if (fileMatches.size >= 3) {
		score += 2;
		reasons.push("multi-file (3+ paths)");
	} else if (fileMatches.size === 2) {
		score += 1;
		reasons.push("references 2 files");
	}

	// --- pure lookup question ("what/who/when/where is …") stays trivial ---
	if (!hasHardSignal && /^\s*(what|who|when|where)\s+(is|are|was|were)\b/i.test(text)) {
		score -= 1;
		reasons.push("simple lookup question");
	}

	// --- floor: a keyword-free prompt with no trivial marker is ambiguous.
	// Default such prompts to `medium` (score 2) rather than risk under-thinking.
	// This is a GENERAL rule: it catches vague multi-word imperatives ("fix the
	// auth flow") AND short technical prompts ("oom", "gc pauses") that carry
	// no lexical difficulty signal but are almost never truly trivial. The
	// gate is intentionally cheap: any prompt that has neither a HARD_WORD, a
	// DIFFICULTY_SIGNAL, nor an explicit trivial marker floats to medium.
	if (!hasHardSignal && score <= 0 && !hasExplicitTrivial) {
		score = 2;
		reasons.push("keyword-free prompt -> medium (anti-under-think floor)");
	}

	return {
		level: scoreToLevel(score),
		reason: reasons.join(", ") || "no strong signals (default)",
	};
}

function scoreToLevel(score: number): ClassifierEmittedLevel {
	if (score <= -2) return "off";
	if (score <= 0) return "low";
	if (score <= 2) return "medium";
	if (score <= 4) return "high";
	return "xhigh";
}
