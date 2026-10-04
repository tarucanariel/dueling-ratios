/* =========================================================
   Practice Test — the setup / quiz / results screens. All question
   logic lives in practiceLogic.js; this file only handles the DOM.
   No sign-in is needed. `onComplete` lets the caller save a finished
   test (signed-in users) without this file knowing about Firebase: it
   returns (a promise of) 'saved', 'failed' or 'guest', which is shown as
   a small note on the results screen.
   ========================================================= */

import { generateTest, scoreTest, resultTier } from './practiceLogic.js';
import { playPracticeStart, playPracticeResults } from './practiceAudio.js';

const TOPIC_LABELS = { fraction: 'Fractions', decimal: 'Decimals', percent: 'Percents' };
const LETTERS = ['A', 'B', 'C', 'D'];

const $ = (id) => document.getElementById(id);

const ui = {
  modal: $('practice-modal'),
  openBtn: $('practice-btn'),
  setup: $('pt-setup'),
  quiz: $('pt-quiz'),
  results: $('pt-results'),
  topicChoices: document.querySelectorAll('.pt-topic-choice'),
  countBtns: document.querySelectorAll('#pt-count-row .choice-btn'),
  difficultyBtns: document.querySelectorAll('#pt-difficulty-row .choice-btn'),
  error: $('pt-error'),
  startBtn: $('pt-start-btn'),
  closeBtn: $('pt-close-btn'),
  progress: $('pt-progress'),
  timer: $('pt-timer'),
  questionList: $('pt-question-list'),
  quizError: $('pt-quiz-error'),
  submitBtn: $('pt-submit-btn'),
  quitBtn: $('pt-quit-btn'),
  verdict: $('pt-verdict'),
  saveNote: $('pt-save-note'),
  score: $('pt-score'),
  accuracy: $('pt-accuracy'),
  time: $('pt-time'),
  breakdown: $('pt-breakdown'),
  review: $('pt-review'),
  againBtn: $('pt-again-btn'),
  changeBtn: $('pt-change-btn'),
  doneBtn: $('pt-done-btn'),
};

const session = {
  settings: { topics: [], count: 10, difficulty: 'easy' },
  questions: [],
  answers: [],
  startedAt: 0,
  timerId: null,
  onComplete: null,
};

/* ---------- helpers ---------- */

function escapeHtml(text){
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Text from practiceLogic with each "3/4" drawn as a stacked fraction.
function mathHtml(text){
  return escapeHtml(text).replace(/(\d+)\/(\d+)/g, '<span class="pt-frac"><span>$1</span><span>$2</span></span>');
}

function formatTime(totalSeconds){
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function elapsedSeconds(){
  return Math.floor((Date.now() - session.startedAt) / 1000);
}

function showView(name){
  ui.setup.classList.toggle('hidden', name !== 'setup');
  ui.quiz.classList.toggle('hidden', name !== 'quiz');
  ui.results.classList.toggle('hidden', name !== 'results');
}

function stopTimer(){
  clearInterval(session.timerId);
  session.timerId = null;
}

/* ---------- setup ---------- */

function selectedTopics(){
  return Array.from(ui.topicChoices).filter(cb => cb.checked).map(cb => cb.dataset.topic);
}

function chooseOne(buttons, clicked){
  buttons.forEach(b => b.classList.toggle('selected', b === clicked));
}

function startTest(){
  const topics = selectedTopics();
  if(topics.length === 0){
    ui.error.textContent = 'Please select at least one topic.';
    return;
  }
  ui.error.textContent = '';
  session.settings = {
    topics,
    count: Number(document.querySelector('#pt-count-row .selected').dataset.count),
    difficulty: document.querySelector('#pt-difficulty-row .selected').dataset.difficulty,
  };
  beginTest();
}

function beginTest(){
  session.questions = generateTest(session.settings);
  session.answers = new Array(session.questions.length).fill(null);
  session.startedAt = Date.now();
  ui.timer.textContent = '00:00';
  ui.quizError.textContent = '';
  delete ui.submitBtn.dataset.confirm;
  stopTimer();
  session.timerId = setInterval(() => { ui.timer.textContent = formatTime(elapsedSeconds()); }, 1000);
  showView('quiz');
  renderQuestions();
  ui.modal.querySelector('.pt-panel').scrollTop = 0;
  playPracticeStart();
}

/* ---------- quiz ---------- */

function updateProgress(){
  const answered = session.answers.filter(a => a !== null).length;
  ui.progress.textContent = `${answered} of ${session.questions.length} answered`;
  ui.progress.classList.remove('warn');
}

// All questions are drawn once; picking an option only updates its own card,
// so the page never jumps while the student is scrolling through.
function renderQuestions(){
  ui.questionList.innerHTML = '';
  session.questions.forEach((q, qi) => {
    const card = document.createElement('section');
    card.className = 'pt-question';
    card.id = `pt-q-${qi}`;

    const prompt = document.createElement('p');
    prompt.className = 'pt-prompt';
    prompt.innerHTML = `<span class="pt-qnum">${qi + 1}.</span> ${mathHtml(q.prompt)}`;
    card.appendChild(prompt);

    const options = document.createElement('div');
    options.className = 'pt-options';
    q.options.forEach((text, oi) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pt-option';
      btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML = `<span class="pt-letter">${LETTERS[oi]}</span><span>${mathHtml(text)}</span>`;
      btn.addEventListener('click', () => selectOption(qi, oi, options, card));
      options.appendChild(btn);
    });
    card.appendChild(options);
    ui.questionList.appendChild(card);
  });
  updateProgress();
}

function selectOption(qi, oi, optionsEl, card){
  session.answers[qi] = oi;
  Array.from(optionsEl.children).forEach((btn, i) => {
    btn.classList.toggle('selected', i === oi);
    btn.setAttribute('aria-pressed', i === oi ? 'true' : 'false');
  });
  card.classList.remove('unanswered');
  ui.quizError.textContent = '';
  delete ui.submitBtn.dataset.confirm; // an old "press again to submit anyway" no longer applies
  updateProgress();
}

function handleSubmit(){
  const firstBlank = session.answers.indexOf(null);
  if(firstBlank !== -1 && ui.submitBtn.dataset.confirm !== 'yes'){
    // First press warns and points at the blanks; a second press submits anyway.
    const unanswered = session.answers.filter(a => a === null).length;
    ui.submitBtn.dataset.confirm = 'yes';
    // The warning text is at the bottom of the page, so echo it in the pinned header too.
    ui.progress.textContent = `${unanswered} unanswered`;
    ui.progress.classList.add('warn');
    ui.quizError.textContent = `${unanswered} unanswered ${unanswered === 1 ? 'question counts' : 'questions count'} as wrong. Press Submit again to finish anyway.`;
    session.answers.forEach((a, i) => {
      $(`pt-q-${i}`).classList.toggle('unanswered', a === null);
    });
    $(`pt-q-${firstBlank}`).scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  finishTest();
}

/* ---------- results ---------- */

const VERDICTS = {
  perfect: 'Perfect score! Every conversion was spot on.',
  great: 'Great work — you really know your fractions, decimals and percents.',
  good: 'Good effort. Review the ones you missed below, then try another.',
  keepgoing: 'Keep practicing — read the explanations below, then try another.',
};

function finishTest(){
  stopTimer();
  const seconds = elapsedSeconds();
  const result = scoreTest(session.questions, session.answers);

  ui.score.textContent = `${result.correct}/${result.total}`;
  ui.accuracy.textContent = `${Math.round(result.accuracy)}%`;
  ui.time.textContent = formatTime(seconds);
  const tier = resultTier(result.accuracy);
  ui.verdict.textContent = VERDICTS[tier];

  ui.breakdown.innerHTML = '';
  Object.entries(result.byTopic).forEach(([topic, t]) => {
    const row = document.createElement('div');
    row.className = 'pt-topic-row';
    row.innerHTML = `<span>${TOPIC_LABELS[topic]}</span><strong>${t.correct} / ${t.total}</strong>`;
    ui.breakdown.appendChild(row);
  });

  renderReview();
  showView('results');
  ui.modal.querySelector('.pt-panel').scrollTop = 0;
  playPracticeResults(tier);

  reportCompletion({
    ...result,
    seconds,
    topics: session.settings.topics,
    difficulty: session.settings.difficulty,
  });
}

const SAVE_NOTES = {
  saved: 'Saved to My Stats.',
  failed: 'Could not save this result. Your score above is still correct.',
  guest: 'Sign in with Google on the home screen to save your results and earn badges.',
};

async function reportCompletion(result){
  ui.saveNote.textContent = '';
  if(!session.onComplete) return;
  const token = session.startedAt; // a newer test may have started by the time the save returns
  ui.saveNote.textContent = 'Saving…';
  let outcome;
  try{
    outcome = await session.onComplete(result);
  } catch(err){
    console.error('Practice Test onComplete failed:', err);
    outcome = 'failed';
  }
  if(token === session.startedAt) ui.saveNote.textContent = SAVE_NOTES[outcome] || '';
}

/* Each reviewed item is drawn as a graded slip of paper: the right answer
   circled in ink, a wrong one struck through with the correction written
   beside it in "red pen". The marks are inline SVG so they scale with the
   text; a visually hidden word carries the same meaning for screen readers. */
const MARK_RIGHT = '<svg viewBox="0 0 30 26" aria-hidden="true"><path d="M3 14c2.2.6 5.4 3.6 7.4 7.2C13.6 12.6 19 6.4 27 2.4"/></svg>';
const MARK_WRONG = '<svg viewBox="0 0 26 26" aria-hidden="true"><path d="M4 4.5c4.6 4.2 10.4 10.8 17.6 17M22 3.6c-5.4 4.6-11 11-17.2 17.6"/></svg>';

function renderReview(){
  ui.review.innerHTML = '';
  session.questions.forEach((q, i) => {
    const picked = session.answers[i];
    const right = picked === q.answerIndex;
    const item = document.createElement('article');
    item.className = 'pt-review-item ' + (right ? 'right' : 'wrong');

    let answers;
    if(right){
      answers = `<span class="pt-rv-ans circled">${mathHtml(q.options[picked])}</span>`;
    } else {
      const yours = picked === null
        ? '<span class="pt-rv-ans blank">no answer</span>'
        : `<span class="pt-rv-ans struck">${mathHtml(q.options[picked])}</span>`;
      answers = `${yours}<span class="pt-rv-fix"><span class="pt-sr">Correct answer: </span>${mathHtml(q.options[q.answerIndex])}</span>`;
    }

    item.innerHTML = `
      <div class="pt-rv-margin">
        <span class="pt-rv-num">${i + 1}</span>
        <span class="pt-rv-mark">${right ? MARK_RIGHT : MARK_WRONG}</span>
        <span class="pt-sr">${right ? 'Correct' : 'Incorrect'}</span>
      </div>
      <div class="pt-rv-body">
        <p class="pt-rv-q">${mathHtml(q.prompt)}</p>
        <p class="pt-rv-answers"><span class="pt-rv-label">${right ? 'Your answer' : 'You wrote'}</span>${answers}</p>
        <p class="pt-rv-why"><span class="pt-rv-why-label">Why</span>${mathHtml(q.explanation)}</p>
      </div>`;
    ui.review.appendChild(item);
  });
}

/* ---------- open / close ---------- */

export function openPracticeTest(){
  stopTimer();
  ui.error.textContent = '';
  showView('setup');
  ui.modal.classList.remove('hidden');
}

export function closePracticeTest(){
  stopTimer();
  ui.modal.classList.add('hidden');
}

function quitTest(){
  if(session.answers.some(a => a !== null) && !confirm('Quit this test? Your answers will be lost.')) return;
  closePracticeTest();
}

export function initPracticeUI({ onComplete = null } = {}){
  session.onComplete = onComplete;

  ui.openBtn.addEventListener('click', openPracticeTest);
  ui.closeBtn.addEventListener('click', closePracticeTest);
  ui.doneBtn.addEventListener('click', closePracticeTest);
  // Clicking the backdrop only closes the setup view — never mid-test.
  ui.modal.addEventListener('click', (e) => {
    if(e.target === ui.modal && !ui.setup.classList.contains('hidden')) closePracticeTest();
  });

  ui.countBtns.forEach(b => b.addEventListener('click', () => chooseOne(ui.countBtns, b)));
  ui.difficultyBtns.forEach(b => b.addEventListener('click', () => chooseOne(ui.difficultyBtns, b)));
  ui.startBtn.addEventListener('click', startTest);

  ui.submitBtn.addEventListener('click', handleSubmit);
  ui.quitBtn.addEventListener('click', quitTest);

  ui.againBtn.addEventListener('click', beginTest);
  ui.changeBtn.addEventListener('click', () => { ui.error.textContent = ''; showView('setup'); });
}
