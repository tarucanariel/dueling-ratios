/* =========================================================
   Pure result/tie-breaking logic — decides whether two players'
   performance should be treated as a tie, given only their
   correct/wrong counts and score. No DOM/state here, same reasoning
   as logic.js/badges.js/tileEffects.js, so this rule is testable in
   isolation and reusable between local play and online sync without
   duplicating it.
   ========================================================= */

/* Two players are "equally accurate" if:
   - neither ever attempted a single drop (both 0 total) — there's no
     data to distinguish them, so this counts as equal rather than an
     arbitrary pick between two blanks; or
   - both attempted at least one, and their correct/total fractions
     are exactly equal.

   Fractions are compared by cross-multiplying (c1*t2 === c2*t1)
   rather than comparing correct/total as decimals, since floating-
   point division could falsely call two slightly different ratios
   "equal" (or two genuinely equal ratios "different") due to rounding
   — cross-multiplication with integer counts has no such risk.

   A player with 0 attempts against a player with 1+ attempts is
   deliberately NOT equal — one of them never got a chance to
   demonstrate anything at all, which is a genuinely different
   situation from matching accuracy, not just an edge case of it. */
export function haveEqualAccuracy(p1, p2){
  const c1 = p1.correctCount || 0, w1 = p1.wrongCount || 0, t1 = c1 + w1;
  const c2 = p2.correctCount || 0, w2 = p2.wrongCount || 0, t2 = c2 + w2;
  if(t1 === 0 && t2 === 0) return true;
  if(t1 === 0 || t2 === 0) return false;
  return c1 * t2 === c2 * t1;
}

/* Whether two players' final results should be presented as a tie.
   True if their raw scores matched (the original, sole rule this
   project shipped with) OR their accuracy matched despite a different
   score — the actual fix this module exists for: two players who
   each answered everything correctly, just with a different number of
   attempts available to them (e.g. 5/5 vs 6/6), read as a tie rather
   than whichever one happened to get more attempts "winning".
   Deliberately an OR of the two conditions, not a straight swap from
   score to accuracy: when scores are equal but accuracy happens to
   differ (a rarer case — same score can occur at different attempt
   counts, e.g. 5/5 and 6/7), this still calls it a tie rather than
   picking a "winner" by an arbitrary tie-break in the score
   comparison, which is what a plain accuracy-only check would do. */
export function isResultTie(p1, p2){
  return p1.score === p2.score || haveEqualAccuracy(p1, p2);
}
