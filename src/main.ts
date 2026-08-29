import './style.css';
import { BattleClient } from './battle/client';
import { resolveBattleApiBase } from './battle/config';
import { presentAttack } from './battle/presentation';
import type { BattleView, ClientMessage } from './battle/protocol';
import { BATTLE_PLATFORM_WIDTH_SCALE } from './constants';
import { PrefectureTowerGame } from './game';
import { beginRepeatedAction } from './hold-repeat';
import { normalizeSeed } from './random';
import { GameRenderer } from './renderer';
import type { GamePhase, PrefectureAssetCollection } from './types';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Application root was not found.');

app.innerHTML = `
  <canvas id="game-canvas" aria-label="都道府県タワーのゲーム画面"></canvas>
  <section id="hud" class="hud" aria-live="polite" hidden>
    <header class="top-bar">
      <button id="home-button" class="brand" type="button" aria-label="トップへ戻る"><span class="brand-mark">47</span><span>都道府県<br><b>タワー</b></span></button>
      <div class="stats">
        <div><small>SCORE</small><strong id="score">0</strong></div>
        <div><small>HEIGHT</small><strong><span id="height">0.0</span><em>km</em></strong></div>
        <div><small id="third-stat-label">BEST</small><strong id="best">0</strong></div>
      </div>
      <button id="info-button" class="round-button" type="button" aria-label="情報を表示">i</button>
    </header>
    <div class="battle-strip" id="battle-strip" hidden>
      <span id="connection-status">接続中…</span><b id="turn-label">対戦待機中</b>
      <span class="timer"><i id="timer-bar"></i><strong id="timer-value">--</strong></span>
    </div>
    <div class="piece-panel">
      <div class="current-piece"><small>いま</small><b id="current-name">---</b><span id="phase-label">配置中</span></div>
      <div class="next-piece"><small>NEXT</small><span id="next-color"></span><b id="next-name">---</b></div>
    </div>
    <div class="seed-label">SEED <span id="seed">0</span></div>
  </section>
  <nav class="touch-controls" aria-label="ゲーム操作" hidden>
    <button type="button" data-action="left" aria-label="左へ移動">←<small>左へ</small></button>
    <button type="button" data-action="rotate-left" aria-label="左へ15度回転">↶<small>回転</small></button>
    <button type="button" data-action="drop" class="drop-button" aria-label="落下">▼<small>落とす</small></button>
    <button type="button" data-action="rotate-right" aria-label="右へ15度回転">↷<small>回転</small></button>
    <button type="button" data-action="right" aria-label="右へ移動">→<small>右へ</small></button>
  </nav>
  <section id="mode-screen" class="modal-layer mode-screen">
    <div class="mode-card">
      <p class="eyebrow">STACK ALL 47</p><h1><span>47</span> 都道府県タワー</h1>
      <p>実寸比の都道府県を、崩さずに積み上げよう。</p>
      <div id="mode-buttons" class="mode-buttons">
        <button id="solo-button" type="button"><b>1人で遊ぶ</b><span>いつものタワー</span></button>
        <button id="battle-button" type="button" class="battle-choice"><b>2人で対戦</b><span>URLで友達を招待</span></button>
      </div>
      <div id="battle-menu" class="battle-menu" hidden>
        <button id="create-room-button" type="button">部屋を作る</button>
        <div class="join-row"><input id="room-input" inputmode="text" maxlength="6" autocomplete="off" placeholder="ROOM ID" aria-label="Room ID"><button id="join-room-button" type="button">参加</button></div>
        <button id="back-to-modes" type="button" class="text-button">← 戻る</button><p id="lobby-error" role="alert"></p>
      </div>
    </div>
  </section>
  <section id="waiting-room" class="modal-layer waiting-room" hidden>
    <div class="waiting-card">
      <p class="eyebrow">ONLINE BATTLE</p><h1>友達を待っています</h1>
      <p>ROOM ID</p><strong id="room-id">------</strong>
      <label>招待URL<input id="invite-url" readonly></label>
      <button id="copy-invite" type="button">招待URLをコピー</button><p id="waiting-status">サーバーへ接続中…</p>
    </div>
  </section>
  <section id="attack-overlay" class="attack-overlay" hidden>
    <div class="attack-heading"><small>県送り</small><h2 id="attack-title">相手に送る県を選べ</h2></div>
    <div id="attack-cards" class="attack-cards"></div>
  </section>
  <aside id="game-over" class="game-over" hidden>
    <div class="game-over-card">
      <small id="game-over-label">GAME OVER</small><h1 id="game-over-title">記録 <span id="final-score">0</span>県</h1>
      <p id="game-over-detail">最高到達高度 <b id="final-height">0.0 km</b></p>
      <button id="retry-button" type="button">同じ順番でもう一度</button>
      <button id="new-button" type="button" class="secondary">新しい順番で遊ぶ</button>
    </div>
  </aside>
  <dialog id="info-dialog">
    <form method="dialog"><button class="dialog-close" aria-label="閉じる">×</button></form>
    <div class="dialog-body">
      <p class="eyebrow">目指せ47都道府県！</p><h1>都道府県タワー</h1>
      <p>47都道府県を全国共通の投影法・同一縮尺で表現した物理タワーゲームです。</p>
      <h2>操作</h2><p>PC: ← → / A D で移動、Q E で15°回転、Spaceで落下。対戦は1手10秒、10県以降5県ごとに5秒の「県送り」が発生します。</p>
      <h2>データ</h2><p>国土数値情報と地理院地図Vectorを加工。<a href="https://github.com/ricewin/simplify-japan-geojson/tree/58c561b557eab3a08ee7aa17b6837bcd789cdf43" target="_blank" rel="noreferrer">出典と固定コミット</a></p>
      <p class="keyboard-help">Matter.js 0.20.0 / MIT License</p>
    </div>
  </dialog>
  <div id="toast" class="toast" hidden></div>
  <div id="loading" class="loading"><span></span><p>47都道府県を読み込み中…</p></div>
`;

const requiredElement = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing UI element: ${selector}`);
  return element;
};

const phaseLabels: Record<GamePhase, string> = { placing: '配置中', falling: '落下中', settling: '安定判定…', gameOver: 'ゲームオーバー' };
const url = new URL(window.location.href);
const apiBase = resolveBattleApiBase(import.meta.env.VITE_BATTLE_API_URL as string | undefined, window.location.hostname);
let activeBattleClient: BattleClient | null = null;
let activeAction: ((action: string) => void) | null = null;

function showToast(message: string): void {
  const toast = requiredElement<HTMLElement>('#toast');
  toast.textContent = message; toast.hidden = false;
  window.setTimeout(() => { toast.hidden = true; }, 2_400);
}

function bindControls(): void {
  const controls = requiredElement<HTMLElement>('.touch-controls');
  controls.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });
  controls.addEventListener('selectstart', (event) => event.preventDefault());
  controls.addEventListener('contextmenu', (event) => event.preventDefault());
  document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
    let stopRepeating = (): void => undefined;
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault(); stopRepeating();
      const action = button.dataset.action ?? '';
      stopRepeating = beginRepeatedAction(() => activeAction?.(action), action !== 'drop');
      button.setPointerCapture(event.pointerId);
    });
    const stop = (): void => { stopRepeating(); stopRepeating = (): void => undefined; };
    button.addEventListener('pointerup', stop); button.addEventListener('pointercancel', stop); button.addEventListener('lostpointercapture', stop);
  });
  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'a', 'd', 'q', 'e', ' '].includes(key)) event.preventDefault();
    if (key === 'arrowleft' || key === 'a') activeAction?.('left');
    if (key === 'arrowright' || key === 'd') activeAction?.('right');
    if (key === 'q') activeAction?.('rotate-left');
    if (key === 'e') activeAction?.('rotate-right');
    if (key === ' ') activeAction?.('drop');
  });
}

function showGameUi(battle: boolean): void {
  requiredElement<HTMLElement>('#mode-screen').hidden = true;
  requiredElement<HTMLElement>('#hud').hidden = false;
  requiredElement<HTMLElement>('.touch-controls').hidden = false;
  requiredElement<HTMLElement>('#battle-strip').hidden = !battle;
  requiredElement<HTMLElement>('#third-stat-label').textContent = battle ? 'ROOM' : 'BEST';
}

function assetByCode(data: PrefectureAssetCollection, code: string | null) {
  return data.assets.find((asset) => asset.code === code);
}

function startSolo(data: PrefectureAssetCollection): void {
  showGameUi(false);
  const seed = normalizeSeed(url.searchParams.get('seed'));
  const game = new PrefectureTowerGame(data, seed);
  const renderer = new GameRenderer(requiredElement<HTMLCanvasElement>('#game-canvas'), game);
  window.addEventListener('resize', () => renderer.resize());
  requiredElement<HTMLElement>('#seed').textContent = String(seed);
  activeAction = (action) => {
    if (action === 'left') game.move(-1); if (action === 'right') game.move(1);
    if (action === 'rotate-left') game.turn(-1); if (action === 'rotate-right') game.turn(1); if (action === 'drop') game.drop();
  };
  let previousTime = performance.now(); let accumulator = 0; let shown = false;
  const frame = (time: number): void => {
    accumulator += Math.min(100, time - previousTime); previousTime = time;
    while (accumulator >= game.fixedStepMs) { game.update(); accumulator -= game.fixedStepMs; }
    renderer.render();
    const snapshot = game.snapshot();
    requiredElement<HTMLElement>('#score').textContent = String(snapshot.score);
    requiredElement<HTMLElement>('#height').textContent = snapshot.heightKm.toFixed(1);
    requiredElement<HTMLElement>('#best').textContent = String(snapshot.records.bestScore);
    requiredElement<HTMLElement>('#current-name').textContent = snapshot.currentName;
    requiredElement<HTMLElement>('#next-name').textContent = snapshot.nextName;
    requiredElement<HTMLElement>('#next-color').style.backgroundColor = game.nextAsset.color;
    requiredElement<HTMLElement>('#phase-label').textContent = phaseLabels[snapshot.phase];
    if (snapshot.phase === 'gameOver' && !shown) {
      shown = true; requiredElement<HTMLElement>('#final-score').textContent = String(snapshot.score);
      requiredElement<HTMLElement>('#final-height').textContent = `${snapshot.heightKm.toFixed(1)} km`;
      requiredElement<HTMLElement>('#game-over').hidden = false;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  requiredElement<HTMLButtonElement>('#retry-button').onclick = () => { url.searchParams.set('seed', String(seed)); window.location.href = url.toString(); };
  requiredElement<HTMLButtonElement>('#new-button').onclick = () => { window.location.href = `${window.location.pathname}?mode=solo${window.location.hash}`; };
}

function startBattle(data: PrefectureAssetCollection, roomId: string): void {
  if (!apiBase) {
    requiredElement<HTMLElement>('#mode-buttons').hidden = true;
    requiredElement<HTMLElement>('#battle-menu').hidden = false;
    requiredElement<HTMLElement>('#lobby-error').textContent = '対戦サーバーURLが未設定です。';
    return;
  }
  showGameUi(true);
  requiredElement<HTMLElement>('#waiting-room').hidden = false;
  requiredElement<HTMLElement>('#room-id').textContent = roomId;
  requiredElement<HTMLElement>('#best').textContent = roomId;
  const invite = new URL(window.location.href); invite.search = ''; invite.searchParams.set('room', roomId);
  requiredElement<HTMLInputElement>('#invite-url').value = invite.toString();
  let view: BattleView | null = null;
  let game: PrefectureTowerGame | null = null;
  let renderer: GameRenderer | null = null;
  let animatedDropSequence = -1;
  let dropAnimationComplete = false;
  let lastDropCompletionSentAt = 0;
  const client = new BattleClient(apiBase, roomId, {
    state: (next) => {
      view = next;
      if (!game) {
        game = new PrefectureTowerGame(data, next.seed, { platformWidthScale: BATTLE_PLATFORM_WIDTH_SCALE });
        renderer = new GameRenderer(requiredElement<HTMLCanvasElement>('#game-canvas'), game);
        window.addEventListener('resize', () => renderer?.resize());
      }
      const current = assetByCode(data, next.currentPrefectureCode);
      if (next.phase === 'dropping' && current) {
        if (animatedDropSequence !== next.dropSequence) {
          game.loadBoard(next.board);
          game.prepareAsset(current, next.placement.x, next.placement.angle);
          game.drop();
          animatedDropSequence = next.dropSequence;
          dropAnimationComplete = false;
          lastDropCompletionSentAt = 0;
        }
      } else {
        game.loadBoard(next.board);
        if (next.phase === 'placing' && current) game.prepareAsset(current, next.placement.x, next.placement.angle);
        else game.phase = next.phase === 'gameOver' ? 'gameOver' : 'falling';
      }
      requiredElement<HTMLElement>('#waiting-room').hidden = next.players.length === 2;
      requiredElement<HTMLElement>('#waiting-status').textContent = next.players.length < 2 ? 'あと1人参加すると開始します' : '';
      renderBattleUi(next, data, client);
      const gameOver = requiredElement<HTMLElement>('#game-over');
      if (next.phase === 'gameOver') {
        const won = next.winner === next.you;
        requiredElement<HTMLElement>('#game-over-label').textContent = won ? 'YOU WIN' : 'YOU LOSE';
        requiredElement<HTMLElement>('#game-over-title').textContent = won ? '勝利！' : '敗北…';
        const ready = next.rematchReady.includes(next.you);
        requiredElement<HTMLElement>('#game-over-detail').textContent = `${next.score}県・${next.heightKm.toFixed(1)} km — 再戦 ${next.rematchReady.length}/2`;
        const retryButton = requiredElement<HTMLButtonElement>('#retry-button');
        retryButton.hidden = false;
        retryButton.disabled = ready;
        retryButton.textContent = ready ? '相手を待っています…' : 'もう一度対戦';
        retryButton.onclick = () => client.send({ type: 'rematch' });
        const newButton = requiredElement<HTMLButtonElement>('#new-button');
        newButton.textContent = 'トップへ戻る';
        newButton.onclick = () => { client.close(true); window.location.href = window.location.pathname; };
        gameOver.hidden = false;
      } else {
        gameOver.hidden = true;
      }
    },
    status: (status) => { requiredElement<HTMLElement>('#connection-status').textContent = status === 'connected' ? '接続済み' : status === 'reconnecting' ? '再接続中…' : '接続中…'; },
    error: showToast,
  });
  activeBattleClient = client;
  activeAction = (action) => {
    const messages: Record<string, ClientMessage> = {
      left: { type: 'move', direction: -1 }, right: { type: 'move', direction: 1 },
      'rotate-left': { type: 'rotate', direction: -1 }, 'rotate-right': { type: 'rotate', direction: 1 }, drop: { type: 'drop' },
    };
    const message = messages[action]; if (message) client.send(message);
  };
  client.connect();
  let previousFrameTime = performance.now();
  let dropAccumulator = 0;
  const frame = (time: number): void => {
    const elapsed = Math.min(100, time - previousFrameTime);
    previousFrameTime = time;
    if (view?.phase === 'dropping' && game && !dropAnimationComplete) {
      dropAccumulator += elapsed;
      while (dropAccumulator >= game.fixedStepMs) {
        game.update();
        dropAccumulator -= game.fixedStepMs;
        if (game.phase === 'placing' || game.phase === 'gameOver') {
          dropAnimationComplete = true;
          if (game.phase === 'placing') game.phase = 'falling';
          break;
        }
      }
    } else {
      dropAccumulator = 0;
    }
    if (view?.phase === 'dropping'
      && dropAnimationComplete
      && view.deadline !== null
      && Date.now() >= view.deadline
      && time - lastDropCompletionSentAt >= 500) {
      client.send({ type: 'dropComplete', dropSequence: view.dropSequence });
      lastDropCompletionSentAt = time;
    }
    renderer?.render();
    if (view?.deadline) {
      const bar = requiredElement<HTMLElement>('#timer-bar');
      if (view.phase === 'dropping') {
        requiredElement<HTMLElement>('#timer-value').textContent = '落下中';
        bar.style.transform = 'scaleX(1)';
        bar.classList.remove('urgent');
      } else {
        const total = view.phase === 'prefectureAttack' ? 5_000 : view.phase === 'prefectureAttackReveal' ? 500 : 10_000;
        const remaining = Math.max(0, view.deadline - Date.now());
        requiredElement<HTMLElement>('#timer-value').textContent = view.phase === 'prefectureAttackReveal' ? '正解' : (remaining / 1000).toFixed(1);
        bar.style.transform = `scaleX(${remaining / total})`;
        bar.classList.toggle('urgent', remaining <= 3_000);
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function renderBattleUi(view: BattleView, data: PrefectureAssetCollection, client: BattleClient): void {
  const current = assetByCode(data, view.currentPrefectureCode); const next = assetByCode(data, view.nextPrefectureCode);
  requiredElement<HTMLElement>('#score').textContent = String(view.score);
  requiredElement<HTMLElement>('#height').textContent = view.heightKm.toFixed(1);
  requiredElement<HTMLElement>('#seed').textContent = String(view.seed);
  requiredElement<HTMLElement>('#current-name').textContent = current?.nameJa ?? '---';
  requiredElement<HTMLElement>('#next-name').textContent = next?.nameJa ?? '---';
  requiredElement<HTMLElement>('#next-color').style.backgroundColor = next?.color ?? 'transparent';
  const yourTurn = view.turn === view.you;
  requiredElement<HTMLElement>('#turn-label').textContent = view.phase === 'waiting' ? '対戦待機中' : view.phase === 'dropping' ? '落下中' : view.phase === 'prefectureAttack' ? (view.attackPlayer === view.you ? '県送りを選択' : '対戦相手が選択中') : view.phase === 'prefectureAttackReveal' ? '正解発表' : yourTurn ? 'あなたの手番' : '相手の手番';
  requiredElement<HTMLElement>('#phase-label').textContent = view.phase === 'placing' ? (yourTurn ? '配置中' : '相手が配置中') : view.phase === 'dropping' ? '落下中' : view.phase === 'prefectureAttack' || view.phase === 'prefectureAttackReveal' ? '県送り' : view.phase === 'gameOver' ? '対戦終了' : '待機中';
  requiredElement<HTMLElement>('.touch-controls').classList.toggle('disabled', view.phase !== 'placing' || !yourTurn);
  const overlay = requiredElement<HTMLElement>('#attack-overlay');
  const attack = presentAttack(view);
  overlay.hidden = !attack.visible;
  const cards = requiredElement<HTMLElement>('#attack-cards'); cards.replaceChildren();
  requiredElement<HTMLElement>('#attack-title').textContent = attack.title;
  for (const card of attack.cards) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.cardId = card.id;
    button.disabled = !card.enabled;
    const list = document.createElement('ul');
    for (const hint of card.hints) { const item = document.createElement('li'); item.textContent = hint; list.append(item); }
    button.append(list);
    if (card.revealed && card.answerPrefectureName) {
      button.classList.add('revealed');
      const answer = document.createElement('strong'); answer.className = 'attack-answer'; answer.textContent = card.answerPrefectureName; button.append(answer);
    } else if (card.dimmed) {
      button.classList.add('not-selected');
    }
    button.addEventListener('click', () => client.send({ type: 'attackSelect', cardId: card.id })); cards.append(button);
  }
}

async function start(): Promise<void> {
  const response = await fetch(`${import.meta.env.BASE_URL}assets/prefectures.json`);
  if (!response.ok) throw new Error(`都道府県データを読み込めませんでした (${response.status})`);
  const data = await response.json() as PrefectureAssetCollection;
  requiredElement<HTMLElement>('#loading').remove(); bindControls();
  const dialog = requiredElement<HTMLDialogElement>('#info-dialog');
  requiredElement<HTMLButtonElement>('#info-button').onclick = () => dialog.showModal();
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  requiredElement<HTMLButtonElement>('#home-button').onclick = () => { activeBattleClient?.close(true); window.location.href = window.location.pathname; };
  requiredElement<HTMLButtonElement>('#copy-invite').onclick = async () => { await navigator.clipboard.writeText(requiredElement<HTMLInputElement>('#invite-url').value); showToast('招待URLをコピーしました'); };
  const room = url.searchParams.get('room')?.toUpperCase();
  if (room && /^[A-Z0-9]{6}$/.test(room)) { startBattle(data, room); return; }
  if (url.searchParams.has('seed') || url.searchParams.get('mode') === 'solo') { startSolo(data); return; }
  requiredElement<HTMLButtonElement>('#solo-button').onclick = () => startSolo(data);
  requiredElement<HTMLButtonElement>('#battle-button').onclick = () => { requiredElement<HTMLElement>('#mode-buttons').hidden = true; requiredElement<HTMLElement>('#battle-menu').hidden = false; };
  requiredElement<HTMLButtonElement>('#back-to-modes').onclick = () => { requiredElement<HTMLElement>('#mode-buttons').hidden = false; requiredElement<HTMLElement>('#battle-menu').hidden = true; };
  const enterRoom = (roomId: string): void => {
    const normalized = roomId.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (normalized.length !== 6) { requiredElement<HTMLElement>('#lobby-error').textContent = 'Room IDは6文字です。'; return; }
    url.searchParams.set('room', normalized); window.location.href = url.toString();
  };
  requiredElement<HTMLButtonElement>('#join-room-button').onclick = () => enterRoom(requiredElement<HTMLInputElement>('#room-input').value);
  requiredElement<HTMLInputElement>('#room-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') enterRoom((event.currentTarget as HTMLInputElement).value);
  });
  requiredElement<HTMLButtonElement>('#create-room-button').onclick = async (event) => {
    if (!apiBase) { requiredElement<HTMLElement>('#lobby-error').textContent = '対戦サーバーURLが未設定です。'; return; }
    const button = event.currentTarget as HTMLButtonElement; button.disabled = true;
    try { const created = await BattleClient.createRoom(apiBase); enterRoom(created.roomId); }
    catch (error) { requiredElement<HTMLElement>('#lobby-error').textContent = error instanceof Error ? error.message : String(error); button.disabled = false; }
  };
}

start().catch((error: unknown) => {
  const loading = document.querySelector<HTMLElement>('#loading');
  if (loading) loading.innerHTML = `<p>読み込みに失敗しました。<br>${error instanceof Error ? error.message : String(error)}</p>`;
  console.error(error);
});
