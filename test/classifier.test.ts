import { describe, expect, test } from "bun:test";
import { classify } from "../src/heuristic.ts";
import cases from "./cases.json" with { type: "json" };

const ORD_MAP: Record<string, number> = { off: 0, low: 1, medium: 2, high: 3, xhigh: 4 };
const ord = (level: string): number => {
	const v = ORD_MAP[level];
	if (v === undefined) throw new Error(`unexpected thinking level: ${level}`);
	return v;
};

interface AdversarialCase {
	prompt: string;
	expectedMin?: string;
	expectedMax?: string;
	knownOverThink?: boolean;
	note: string;
}

/**
 * The classifier is graded on a labeled set. The invariants, in priority order:
 *   1. NEVER under-think a hard prompt (hard -> at least `medium`). This is the
 *      dangerous direction and must be 100% on the labeled hard set.
 *   2. Never waste `high`/`xhigh` on a trivial prompt (trivial -> at most `low`).
 *   3. Medium prompts land somewhere reasonable (low..high).
 *
 * Over-thinking a trivial prompt (trivial -> medium) is tolerated: it costs a
 * little compute, never correctness. See README "Known limitations".
 */
describe("difficulty classifier — labeled cases", () => {
	test("never under-thinks a hard prompt (hard >= medium)", () => {
		const misses = cases.hard.filter((p) => ord(classify(p).level) < 2);
		expect(misses).toEqual([]);
	});

	test("never over-thinks a trivial prompt into high/xhigh (trivial <= medium)", () => {
		const misses = cases.trivial.filter((p) => ord(classify(p).level) > 2);
		expect(misses).toEqual([]);
	});

	test("medium prompts land low..high", () => {
		const misses = cases.medium.filter((p) => {
			const l = ord(classify(p).level);
			return l < 1 || l > 3;
		});
		expect(misses).toEqual([]);
	});

	test("classify is pure and deterministic", () => {
		for (const p of [...cases.hard, ...cases.trivial, ...cases.medium]) {
			expect(classify(p)).toEqual(classify(p));
		}
	});

	test("empty and whitespace do not throw", () => {
		expect(classify("").level).toBeDefined();
		expect(classify("   ").level).toBeDefined();
	});

	test("safe on non-string input (returns a documented default, does not throw)", () => {
		// The public function type is `string`, but the extension entrypoint
		// hands us `event.text` at runtime and JS callers can pass anything.
		// See SF-4 in the review receipt.
		const badInputs: unknown[] = [null, undefined, 42, {}, [], true];
		for (const bad of badInputs) {
			// biome-ignore lint/suspicious/noExplicitAny: intentional bad input.
			const result = classify(bad as any);
			expect(result.level).toBe("low");
			expect(result.reason.length).toBeGreaterThan(0);
		}
	});
});

describe("difficulty classifier — held-out cases (not tuned on)", () => {
	test("never under-thinks a held-out hard prompt (hard >= medium)", () => {
		const misses = cases.heldOutHard.filter((p) => ord(classify(p).level) < 2);
		// This lock exists to keep the tuning regexes from being edited to only
		// match tuning-set literals. It is NOT a keyword-blind generalization
		// claim — see `heldOutHardKeywordBlind` below for that.
		expect(misses).toEqual([]);
	});

	test("held-out trivial prompts stay at most medium (safe-over-think tolerated)", () => {
		// We do NOT require <= low here — see README "Known limitations". The
		// live invariant is that we never burn xhigh on a trivial-looking prompt.
		const misses = cases.heldOutTrivial.filter((p) => ord(classify(p).level) > 2);
		expect(misses).toEqual([]);
	});

	test("keyword-blind hard prompts land >= medium (general anti-under-think rule)", () => {
		// These prompts were selected so NONE match any HARD_WORDS or
		// DIFFICULTY_SIGNALS regex atom (verified — see docs/design.md
		// "Keyword-blind held-out set"). If the classifier still floors them
		// at `medium`, it is doing so through the general anti-under-think
		// floor, not through a literal.
		const misses = cases.heldOutHardKeywordBlind.filter((p) => ord(classify(p).level) < 2);
		expect(misses).toEqual([]);
	});
});

describe("difficulty classifier — adversarial cases", () => {
	const adv = cases.adversarial as AdversarialCase[];

	for (const c of adv) {
		test(`adversarial: ${c.prompt}`, () => {
			const level = classify(c.prompt).level;
			const rank = ord(level);
			if (c.expectedMin !== undefined) {
				expect(rank).toBeGreaterThanOrEqual(ord(c.expectedMin));
			}
			if (c.expectedMax !== undefined) {
				expect(rank).toBeLessThanOrEqual(ord(c.expectedMax));
			}
		});
	}

	test("known safe-over-thinking cases are documented, not silently fixed", () => {
		// This test asserts that we haven't silently dropped documentation of the
		// known limitations. If someone fixes one of these, they should also
		// remove `knownOverThink` from the case and update the README.
		const known = adv.filter((c) => c.knownOverThink === true);
		expect(known.length).toBeGreaterThan(0);
		for (const c of known) {
			expect(c.note).toContain("safe-over-thinking");
		}
	});
});

describe("difficulty classifier — invariants", () => {
	test("reason string is always non-empty", () => {
		for (const p of [
			...cases.hard,
			...cases.trivial,
			...cases.medium,
			...cases.heldOutHard,
			...cases.heldOutTrivial,
			...cases.heldOutHardKeywordBlind,
		]) {
			expect(classify(p).reason.length).toBeGreaterThan(0);
		}
	});

	test("classifier is stable under trailing whitespace", () => {
		for (const p of cases.hard.slice(0, 5)) {
			expect(classify(p)).toEqual(classify(`${p}   `));
			expect(classify(p)).toEqual(classify(`   ${p}`));
		}
	});

	test("returns a valid ThinkingLevel", () => {
		const valid = new Set(["off", "low", "medium", "high", "xhigh"]);
		for (const p of [...cases.hard, ...cases.trivial, ...cases.medium]) {
			expect(valid.has(classify(p).level)).toBe(true);
		}
	});
});
