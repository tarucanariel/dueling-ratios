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

/* Everything the winner modal shows, as plain data — no DOM, so local
   play, online play and the spectator view all render the same result
   from one place instead of each building its own text.

   players: one entry (solo) or two, each { name, score, correctCount,
   wrongCount }. opts:
   - reason: 'complete' (default), 'timeout' or 'forfeit'
   - loserIndex: who timed out / forfeited
   - timeRemaining: [secs, secs] when a clock was running, else null —
     only used to break a tied score and to show time left on the tiles.

   Returns { heading, note, tiles }. Each tile is { name, score, max, pct,
   isWinner, timeRemaining }; pct is null when the player never attempted
   a drop (no accuracy to show). */
export function buildResultView(players, opts = {}){
  const { reason = 'complete', loserIndex = null, timeRemaining = null } = opts;
  const tiles = players.map((p, i) => {
    const correct = p.correctCount || 0;
    const max = correct + (p.wrongCount || 0);
    return {
      name: p.name,
      score: p.score,
      max,
      pct: max === 0 ? null : Math.round((correct / max) * 100),
      isWinner: false,
      timeRemaining: timeRemaining ? timeRemaining[i] : null,
    };
  });

  if(players.length === 1){
    const t = tiles[0];
    if(reason === 'timeout'){
      return { heading: "Time's up!", note: `${t.name}, you ran out of time with a score of ${t.score} out of ${t.max} possible.`, tiles };
    }
    return { heading: 'Nice work!', note: `${t.name}, you finished with a score of ${t.score} out of ${t.max} possible.`, tiles };
  }

  const [t1, t2] = tiles;
  const win = (i, heading, note) => {
    tiles[i].isWinner = true;
    return { heading, note, tiles };
  };

  if(reason === 'timeout' || reason === 'forfeit'){
    const w = 1 - loserIndex;
    return win(w,
      reason === 'timeout' ? `${tiles[w].name} wins on time!` : `${tiles[w].name} wins!`,
      reason === 'timeout' ? `${tiles[loserIndex].name} ran out of time.` : `${tiles[loserIndex].name} disconnected and didn't return.`);
  }

  const [p1, p2] = players;
  if(isResultTie(p1, p2)){
    if(p1.score === p2.score){
      if(timeRemaining && timeRemaining[0] !== timeRemaining[1]){
        const w = timeRemaining[0] > timeRemaining[1] ? 0 : 1;
        return win(w, `${tiles[w].name} wins the tiebreaker!`,
          `Tied at ${p1.score} points — ${tiles[w].name} had more time left.`);
      }
      return { heading: "It's a tie!", note: `${t1.name} and ${t2.name} both scored ${p1.score}.`, tiles };
    }
    const acc = t1.pct === null ? 'N/A' : `${t1.pct}%`;
    return { heading: "It's a tie!", note: `${t1.name} and ${t2.name} both had ${acc} accuracy — the score difference is just from a different number of attempts.`, tiles };
  }

  const w = p1.score > p2.score ? 0 : 1;
  return win(w, `${tiles[w].name} wins!`, `Final score: ${tiles[w].score} to ${tiles[1 - w].score}.`);
}
