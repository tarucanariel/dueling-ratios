/* =========================================================
   Leaderboard modal — tabs for each board, ranked rows, viewer highlight.
   Ranking/formatting lives in leaderboardLogic.js and the database calls
   are injected (`fetchBoard`), so this file only handles the DOM.
   Boards are cached briefly so flipping between tabs doesn't re-query.
   ========================================================= */

import {
  LEADERBOARD_BOARDS, LEADERBOARD_LABELS, MIN_ANSWERS_FOR_ACCURACY, PRACTICE_BOARDS, DEFAULT_PRACTICE_BOARD,
  practiceBoardLabel, buildLeaderboardRows,
} from './leaderboardLogic.js';

const CACHE_MS = 60 * 1000;

const EMPTY_NOTES = {
  practice: 'Finish a Practice Test with all three topics and 10 or 15 items while signed in to appear here. Each difficulty and length has its own board; best score counts and a faster time breaks ties.',
  dash: 'Win a Ratio Dash race against other players while signed in to appear here.',
  accuracy: `Answer ${MIN_ANSWERS_FOR_ACCURACY}+ questions across your games while signed in to appear here.`,
};

const $ = (id) => document.getElementById(id);

export function initLeaderboardUI({ fetchBoard, getMyUid }){
  const modal = $('leaderboard-modal');
  const tabsEl = $('leaderboard-tabs');
  const practiceChipsEl = $('leaderboard-practice-chips');
  const listEl = $('leaderboard-list');
  const noteEl = $('leaderboard-note');
  const cache = {};
  let current = 'practice';
  let practiceBoard = DEFAULT_PRACTICE_BOARD;
  let requestId = 0; // a slower, older tab load must not overwrite a newer one

  function renderRows(board, rows){
    listEl.innerHTML = '';
    noteEl.textContent = rows.length ? '' : EMPTY_NOTES[board.startsWith('practice') ? 'practice' : board];
    rows.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'lb-row' + (r.rank <= 3 ? ` lb-top lb-top-${r.rank}` : '') + (r.isMe ? ' lb-me' : '');
      const rank = document.createElement('span');
      rank.className = 'lb-rank';
      if(r.rank <= 3){
        const medal = document.createElement('span');
        medal.className = 'lb-rank-num';
        medal.textContent = r.rank;
        rank.appendChild(medal);
      } else {
        rank.textContent = r.rank;
      }
      const who = document.createElement('span');
      who.className = 'lb-who';
      const name = document.createElement('strong');
      name.textContent = r.name; // textContent: names are user-supplied
      const detail = document.createElement('small');
      detail.textContent = r.detail;
      who.append(name, detail);
      const value = document.createElement('span');
      value.className = 'lb-value';
      value.textContent = r.value;
      row.append(rank, who, value);
      listEl.appendChild(row);
    });
  }

  async function load(board, { force = false } = {}){
    const id = ++requestId;
    const hit = cache[board];
    if(!force && hit && Date.now() - hit.at < CACHE_MS){
      renderRows(board, buildLeaderboardRows(board, hit.raw, getMyUid()));
      return;
    }
    listEl.innerHTML = '';
    noteEl.textContent = 'Loading…';
    try{
      const raw = await fetchBoard(board);
      cache[board] = { raw, at: Date.now() };
      if(id === requestId) renderRows(board, buildLeaderboardRows(board, raw, getMyUid()));
    } catch(err){
      console.error('Failed to load leaderboard:', err);
      if(id === requestId) noteEl.textContent = 'Could not load the leaderboard. Check your connection and try again.';
    }
  }

  // The tab's database board: Practice resolves to the chosen difficulty/length.
  function activeBoard(){ return current === 'practice' ? practiceBoard : current; }

  function selectTab(tab){
    current = tab;
    tabsEl.querySelectorAll('.class-nav-tab').forEach((t) => t.classList.toggle('active', t.dataset.board === tab));
    practiceChipsEl.classList.toggle('hidden', tab !== 'practice');
    load(activeBoard());
  }

  PRACTICE_BOARDS.forEach((b) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'choice-btn';
    chip.dataset.board = b.key;
    chip.textContent = practiceBoardLabel(b);
    chip.addEventListener('click', () => {
      practiceBoard = b.key;
      practiceChipsEl.querySelectorAll('.choice-btn').forEach((c) => c.classList.toggle('selected', c.dataset.board === b.key));
      load(b.key);
    });
    if(b.key === practiceBoard) chip.classList.add('selected');
    practiceChipsEl.appendChild(chip);
  });

  LEADERBOARD_BOARDS.forEach((board) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'class-nav-tab';
    tab.dataset.board = board;
    tab.textContent = LEADERBOARD_LABELS[board];
    tab.addEventListener('click', () => selectTab(board));
    tabsEl.appendChild(tab);
  });

  $('leaderboard-btn').addEventListener('click', () => {
    modal.classList.remove('hidden');
    Object.keys(cache).forEach((k) => delete cache[k]); // fresh on every open
    selectTab(current);
  });
  const close = () => modal.classList.add('hidden');
  $('leaderboard-close-btn').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if(e.target === modal) close(); });
}
