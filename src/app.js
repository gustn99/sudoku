const LEVELS = [
  { id: 'beginner', name: '초급', mark: '01' },
  { id: 'intermediate', name: '중급', mark: '02' },
  { id: 'advanced', name: '고급', mark: '03' },
  { id: 'master', name: '마스터', mark: '04' },
];
const STORAGE_KEY = 'haru-sudoku-progress-v1';
const app = document.querySelector('#app');
let puzzles;
let store = loadStore();
let screen = 'home';
let activeLevel = null;
let selected = -1;
let noteMode = false;
let paused = false;
let undoStack = [];
let tickHandle;
let lastTick = 0;

function loadStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.levels) return saved;
  } catch { /* Corrupt or unavailable storage starts a fresh local game. */ }
  return { levels: Object.fromEntries(LEVELS.map(level => [level.id, { completed: 0, game: null }])) };
}

function saveStore() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }
  catch { showToast('저장 공간을 확인해 주세요. 진행 기록을 저장하지 못했습니다.'); }
}

function levelState() { return store.levels[activeLevel]; }
function game() { return levelState().game; }
function puzzle() { return puzzles[activeLevel][levelState().completed]; }
function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor(seconds / 60) % 60;
  const secs = seconds % 60;
  return hours ? `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
function icon(name) {
  const common = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  const paths = {
    back: '<path d="m14 18-6-6 6-6"/>',
    undo: '<path d="M8 7 4 11l4 4"/><path d="M4 11h9a6 6 0 1 1-5.3 8.8"/>',
    erase: '<path d="m4 14 9-9a2 2 0 0 1 3 0l4 4a2 2 0 0 1 0 3l-7 7H8z"/><path d="m10 8 7 7M4 20h16"/>',
    notes: '<path d="M5 19h14M7 16l9-9 2 2-9 9-3 1z"/><path d="M14 7l2-2a2 2 0 0 1 3 3l-1 1"/>',
    hint: '<path d="M9 18h6m-5 3h4M8 14c-1.2-.9-2-2.2-2-4a6 6 0 1 1 12 0c0 1.8-.8 3.1-2 4-.8.7-1 1.6-1 2H9c0-.4-.2-1.3-1-2z"/>',
    pause: '<path d="M9 5v14M15 5v14"/>',
    play: '<path d="m8 5 11 7-11 7z"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    close: '<path d="M5 5 19 19M19 5 5 19"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" ${common}>${paths[name]}</svg>`;
}

function renderHome() {
  stopClock();
  screen = 'home';
  const cards = LEVELS.map(level => {
    const state = store.levels[level.id];
    const done = Math.min(100, state.completed);
    const label = done === 100 ? '모두 완료' : state.game ? `${done + 1}번 이어하기` : `${done + 1}번 시작`;
    return `<button class="level-card" data-level="${level.id}" aria-label="${level.name}, ${done}개 완료, ${label}">
      <span class="level-mark">${level.mark}</span><span class="level-main"><strong>${level.name}</strong><span class="progress-track"><span style="width:${done}%"></span></span></span>
      <span class="level-side"><span>${done}<span class="muted"> / 100</span></span><small>${label} ${icon('arrow')}</small></span>
    </button>`;
  }).join('');
  app.innerHTML = `<section class="home-shell"><header class="home-header"><div class="brand-icon">9</div><span>HARU SUDOKU</span></header>
    <div class="hero"><h1>하루 <em>스도쿠</em></h1><p>원하는 난이도를 골라 차례대로 풀어보세요.<br>진행 상황은 이 기기에 저장됩니다.</p></div>
    <div class="level-section"><div class="section-heading"><h2>난이도 선택</h2></div><div class="level-list">${cards}</div></div></section>`;
  app.querySelectorAll('[data-level]').forEach(button => button.addEventListener('click', () => openLevel(button.dataset.level)));
}

function openLevel(level) {
  activeLevel = level;
  const state = levelState();
  if (state.completed >= 100) {
    if (confirm(`${LEVELS.find(item => item.id === level).name} 100문제를 모두 풀었습니다. 처음부터 다시 시작할까요? 이 난이도의 완료 기록이 초기화됩니다.`)) {
      state.completed = 0; state.game = null; saveStore();
    } else return;
  }
  if (!state.game || state.game.index !== state.completed) {
    state.game = { index: state.completed, values: Array(81).fill(0), notes: Array.from({ length: 81 }, () => []), seconds: 0, mistakes: 0 };
    saveStore();
  }
  selected = -1; noteMode = false; paused = false; undoStack = [];
  renderGame(); startClock();
}

function isGiven(i) { return puzzle().puzzle[i] !== '0'; }
function visibleValue(i) { return isGiven(i) ? Number(puzzle().puzzle[i]) : game().values[i]; }
function digitCompleted(digit) {
  return Array.from({ length: 81 }, (_, i) => i).every(i => Number(puzzle().solution[i]) !== digit || visibleValue(i) === digit);
}
function related(a, b) {
  return Math.floor(a / 9) === Math.floor(b / 9) || a % 9 === b % 9 || (Math.floor(a / 27) === Math.floor(b / 27) && Math.floor(a % 9 / 3) === Math.floor(b % 9 / 3));
}
function cellMarkup(i) {
  const value = visibleValue(i);
  const selectedValue = selected >= 0 ? visibleValue(selected) : 0;
  const classes = ['cell'];
  if (isGiven(i)) classes.push('given');
  if (i === selected) classes.push('selected');
  else if (selected >= 0 && related(i, selected)) classes.push('related');
  if (selectedValue && value === selectedValue && i !== selected) classes.push('matching');
  if (!isGiven(i) && value && value !== Number(puzzle().solution[i])) classes.push('wrong');
  if (i % 9 === 2 || i % 9 === 5) classes.push('box-right');
  if (Math.floor(i / 9) === 2 || Math.floor(i / 9) === 5) classes.push('box-bottom');
  const notes = !value ? `<span class="notes-grid">${Array.from({ length: 9 }, (_, n) => `<span>${game().notes[i].includes(n + 1) ? n + 1 : ''}</span>`).join('')}</span>` : '';
  return `<button class="${classes.join(' ')}" data-cell="${i}" role="gridcell" aria-selected="${i === selected}" aria-label="${Math.floor(i / 9) + 1}행 ${i % 9 + 1}열, ${value ? `${value}${isGiven(i) ? ', 시작 숫자' : ''}` : game().notes[i].length ? `메모 ${game().notes[i].join(', ')}` : '빈칸'}">${value || notes}</button>`;
}

function renderGame() {
  screen = 'game';
  const level = LEVELS.find(item => item.id === activeLevel);
  app.innerHTML = `<section class="game-shell"><header class="game-header"><button class="icon-button" id="home-button" aria-label="홈으로">${icon('back')}</button><div class="game-title"><span>하루 스도쿠</span><small>${level.name} · ${levelState().completed + 1} / 100</small></div><div class="header-spacer"></div></header>
    <div class="game-meta"><div><small>난이도</small><strong>${level.name}</strong></div><div><small>실수</small><strong id="mistake-label">${game().mistakes}회</strong></div><div><small>시간</small><strong id="time-label">${formatTime(game().seconds)}</strong></div><button class="pause-button" id="pause-button" aria-label="일시정지">${icon('pause')}</button></div>
    <div class="board-wrap"><div class="board" role="grid" aria-label="스도쿠 게임판">${Array.from({ length: 81 }, (_, i) => cellMarkup(i)).join('')}</div></div>
    <div class="game-bottom"><div class="tools"><button class="tool" id="undo-button" aria-label="실행 취소" ${undoStack.length ? '' : 'disabled'}>${icon('undo')}<span>실행 취소</span></button><button class="tool" id="erase-button" aria-label="선택 칸 지우기">${icon('erase')}<span>지우기</span></button><button class="tool ${noteMode ? 'active' : ''}" id="notes-button" aria-pressed="${noteMode}">${icon('notes')}<span>메모 <b>${noteMode ? '켜짐' : '꺼짐'}</b></span></button><button class="tool" id="hint-button" aria-label="선택 칸 힌트">${icon('hint')}<span>힌트</span></button></div>
    <div class="keypad" aria-label="숫자 입력">${Array.from({ length: 9 }, (_, i) => `<button data-digit="${i + 1}" aria-label="숫자 ${i + 1}${digitCompleted(i + 1) ? ', 모두 채움' : ''}" ${digitCompleted(i + 1) ? 'disabled' : ''}>${i + 1}</button>`).join('')}</div></div>
    ${paused ? `<div class="overlay"><div class="dialog"><div class="dialog-symbol">Ⅱ</div><p class="eyebrow">잠시 쉬어가세요</p><h2>일시정지</h2><p>게임판과 시간이 멈췄습니다.</p><button class="primary-button" id="resume-button">계속 풀기 ${icon('arrow')}</button><button class="text-button" id="pause-home-button">홈으로</button></div></div>` : ''}
  </section>`;
  app.querySelector('#home-button').addEventListener('click', renderHome);
  app.querySelector('#pause-button').addEventListener('click', togglePause);
  app.querySelector('#undo-button').addEventListener('click', undo);
  app.querySelector('#erase-button').addEventListener('click', erase);
  app.querySelector('#notes-button').addEventListener('click', () => { noteMode = !noteMode; renderGame(); });
  app.querySelector('#hint-button').addEventListener('click', hint);
  app.querySelectorAll('[data-cell]').forEach(button => button.addEventListener('click', () => { selected = Number(button.dataset.cell); renderGame(); }));
  app.querySelectorAll('[data-digit]').forEach(button => button.addEventListener('click', () => enterNumber(Number(button.dataset.digit))));
  app.querySelector('#resume-button')?.addEventListener('click', togglePause);
  app.querySelector('#pause-home-button')?.addEventListener('click', renderHome);
}

function snapshot() { undoStack.push({ values: [...game().values], notes: game().notes.map(notes => [...notes]) }); if (undoStack.length > 100) undoStack.shift(); }
function editable() {
  if (selected < 0) { showToast('먼저 칸을 선택해 주세요.'); return false; }
  if (isGiven(selected)) { showToast('시작 숫자는 바꿀 수 없어요.'); return false; }
  return true;
}
function enterNumber(digit) {
  if (paused || digitCompleted(digit) || !editable()) return;
  const state = game();
  if (noteMode) {
    if (state.values[selected]) { showToast('숫자가 있는 칸에는 메모할 수 없어요.'); return; }
    snapshot();
    const notes = state.notes[selected];
    state.notes[selected] = notes.includes(digit) ? notes.filter(n => n !== digit) : [...notes, digit].sort();
  } else {
    if (state.values[selected] === digit) return;
    snapshot();
    state.values[selected] = digit;
    state.notes[selected] = [];
    if (digit !== Number(puzzle().solution[selected])) state.mistakes += 1;
  }
  saveStore(); renderGame(); checkWin();
}
function erase() {
  if (paused || !editable()) return;
  if (!game().values[selected] && !game().notes[selected].length) return;
  snapshot(); game().values[selected] = 0; game().notes[selected] = []; saveStore(); renderGame();
}
function undo() {
  if (paused || !undoStack.length) return;
  const previous = undoStack.pop();
  game().values = previous.values; game().notes = previous.notes; saveStore(); renderGame();
}
function hint() {
  if (paused || !editable()) return;
  if (game().values[selected] === Number(puzzle().solution[selected])) { showToast('이미 맞는 숫자예요.'); return; }
  snapshot(); game().values[selected] = Number(puzzle().solution[selected]); game().notes[selected] = [];
  saveStore(); renderGame(); checkWin();
}
function checkWin() {
  if (!game().values.every((value, i) => isGiven(i) || value === Number(puzzle().solution[i]))) return;
  stopClock();
  const finished = { seconds: game().seconds, mistakes: game().mistakes, number: levelState().completed + 1 };
  levelState().completed += 1; levelState().game = null; saveStore();
  screen = 'win';
  const level = LEVELS.find(item => item.id === activeLevel);
  app.innerHTML = `<section class="win-shell"><div class="win-symbol">✓</div><p class="eyebrow">${level.name} · ${finished.number}번 문제</p><h1>잘 풀었어요!</h1><p>한 문제를 차분히 완성했네요.</p><div class="win-stats"><div><small>걸린 시간</small><strong>${formatTime(finished.seconds)}</strong></div><div><small>실수</small><strong>${finished.mistakes}회</strong></div></div><button class="primary-button" id="next-button">${finished.number === 100 ? '난이도 선택으로' : '다음 문제 풀기'} ${icon('arrow')}</button><button class="text-button" id="win-home-button">홈으로</button></section>`;
  app.querySelector('#next-button').addEventListener('click', () => finished.number === 100 ? renderHome() : openLevel(activeLevel));
  app.querySelector('#win-home-button').addEventListener('click', renderHome);
}
function togglePause() {
  paused = !paused;
  if (paused) stopClock(); else startClock();
  renderGame();
}
function startClock() {
  stopClock(); lastTick = Date.now();
  tickHandle = setInterval(() => {
    if (screen !== 'game' || paused || document.hidden) return;
    const now = Date.now();
    const elapsed = Math.floor((now - lastTick) / 1000);
    if (elapsed > 0) {
      game().seconds += elapsed; lastTick += elapsed * 1000;
      app.querySelector('#time-label')?.replaceChildren(document.createTextNode(formatTime(game().seconds)));
      saveStore();
    }
  }, 250);
}
function stopClock() { clearInterval(tickHandle); tickHandle = null; }
function showToast(message) {
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div'); toast.className = 'toast'; toast.textContent = message;
  document.body.append(toast); setTimeout(() => toast.remove(), 2600);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === 'game' && !paused) { paused = true; stopClock(); renderGame(); }
});
document.addEventListener('keydown', event => {
  if (screen !== 'game' || paused) return;
  if (/^[1-9]$/.test(event.key)) enterNumber(Number(event.key));
  else if (event.key === 'Backspace' || event.key === 'Delete') erase();
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); }
  else if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) {
    event.preventDefault();
    const next = (selected < 0 ? 0 : selected) + ({ ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 }[event.key]);
    selected = Math.max(0, Math.min(80, next)); renderGame(); app.querySelector(`[data-cell="${selected}"]`)?.focus();
  }
});

async function boot() {
  try {
    const response = await fetch('./data/puzzles.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    puzzles = await response.json();
    for (const level of LEVELS) if (puzzles[level.id]?.length !== 100) throw new Error(`${level.id} 문제 수 오류`);
    renderHome();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  } catch (error) {
    app.innerHTML = `<section class="error-shell"><h1>문제를 불러오지 못했어요</h1><p>연결 상태를 확인하고 다시 시도해 주세요.</p><button class="primary-button" id="retry">다시 시도</button></section>`;
    app.querySelector('#retry').addEventListener('click', () => location.reload());
    console.error(error);
  }
}
boot();
