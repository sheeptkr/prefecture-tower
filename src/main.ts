import './style.css';
import { PrefectureTowerGame } from './game';
import { normalizeSeed } from './random';
import { GameRenderer } from './renderer';
import type { GamePhase, PrefectureAssetCollection } from './types';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Application root was not found.');

app.innerHTML = `
  <canvas id="game-canvas" aria-label="都道府県タワーのゲーム画面"></canvas>
  <section class="hud" aria-live="polite">
    <header class="top-bar">
      <div class="brand"><span class="brand-mark">47</span><span>都道府県<br><b>タワー</b></span></div>
      <div class="stats">
        <div><small>SCORE</small><strong id="score">0</strong></div>
        <div><small>HEIGHT</small><strong><span id="height">0.0</span><em>km</em></strong></div>
        <div><small>BEST</small><strong id="best">0</strong></div>
      </div>
      <button id="info-button" class="round-button" type="button" aria-label="情報を表示">i</button>
    </header>
    <div class="piece-panel">
      <div class="current-piece"><small>いま</small><b id="current-name">---</b><span id="phase-label">配置中</span></div>
      <div class="next-piece"><small>NEXT</small><span id="next-color"></span><b id="next-name">---</b></div>
    </div>
    <div class="seed-label">SEED <span id="seed">0</span></div>
  </section>
  <nav class="touch-controls" aria-label="ゲーム操作">
    <button type="button" data-action="left" aria-label="左へ移動">←<small>左へ</small></button>
    <button type="button" data-action="rotate-left" aria-label="左へ15度回転">↶<small>回転</small></button>
    <button type="button" data-action="drop" class="drop-button" aria-label="落下">▼<small>落とす</small></button>
    <button type="button" data-action="rotate-right" aria-label="右へ15度回転">↷<small>回転</small></button>
    <button type="button" data-action="right" aria-label="右へ移動">→<small>右へ</small></button>
  </nav>
  <aside id="game-over" class="game-over" hidden>
    <div class="game-over-card">
      <small>GAME OVER</small>
      <h1>記録 <span id="final-score">0</span>県</h1>
      <p>最高到達高度 <b id="final-height">0.0 km</b></p>
      <button id="retry-button" type="button">同じ順番でもう一度</button>
      <button id="new-button" type="button" class="secondary">新しい順番で遊ぶ</button>
    </div>
  </aside>
  <dialog id="info-dialog">
    <form method="dialog"><button class="dialog-close" aria-label="閉じる">×</button></form>
    <div class="dialog-body">
      <p class="eyebrow">ABOUT THIS GAME</p>
      <h1>都道府県タワー</h1>
      <p>47都道府県を全国共通のランベルト正積方位図法・同一縮尺で表現した、1人用の物理タワーゲームです。県ごとの個別拡大はしていません。</p>
      <h2>データと加工</h2>
      <p>行政区域を都道府県単位に結合し、穴を埋め、Visvalingam法で外形を簡略化した後、凸多角形へ事前分解しています。通常の離島は省略し、東京・沖縄の全島、北方領土、淡路島、佐渡島、小豆島、竹島を保持しています。</p>
      <ul>
        <li><a href="https://github.com/ricewin/simplify-japan-geojson/tree/58c561b557eab3a08ee7aa17b6837bcd789cdf43" target="_blank" rel="noreferrer">simplify-japan-geojson（固定コミット、CC BY 4.0、改変あり）</a></li>
        <li><a href="https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html" target="_blank" rel="noreferrer">国土数値情報 行政区域データ（国土交通省）</a></li>
        <li><a href="https://github.com/gsi-cyberjapan/gsimaps-vector-experiment" target="_blank" rel="noreferrer">地理院地図Vector（国土地理院、竹島海岸線、2026-04-01版）</a></li>
      </ul>
      <h2>オープンソース</h2>
      <p><a href="https://brm.io/matter-js/" target="_blank" rel="noreferrer">Matter.js 0.20.0</a>（MIT）、<a href="https://github.com/schteppe/poly-decomp.js" target="_blank" rel="noreferrer">poly-decomp.js</a>（MIT）、proj4js（MIT）、mapshaper（MPL-2.0）を使用しています。</p>
      <h2>表現について</h2>
      <p>係争地域を含む地理表現は、採用した日本の公的データ表現に基づくものです。国際的な主張の判定や見解の表明を目的としていません。</p>
      <p class="keyboard-help">PC: ← → / A D で移動、Q E で15°回転、Spaceで落下</p>
    </div>
  </dialog>
  <div id="loading" class="loading"><span></span><p>47都道府県を読み込み中…</p></div>
`;

const requiredElement = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing UI element: ${selector}`);
  return element;
};

const phaseLabels: Record<GamePhase, string> = {
  placing: '配置中',
  falling: '落下中',
  settling: '安定判定…',
  gameOver: 'ゲームオーバー',
};

async function start(): Promise<void> {
  const response = await fetch(`${import.meta.env.BASE_URL}assets/prefectures.json`);
  if (!response.ok) throw new Error(`都道府県データを読み込めませんでした (${response.status})`);
  const data = await response.json() as PrefectureAssetCollection;
  const url = new URL(window.location.href);
  const seed = normalizeSeed(url.searchParams.get('seed'));
  const game = new PrefectureTowerGame(data, seed);
  const canvas = requiredElement<HTMLCanvasElement>('#game-canvas');
  const renderer = new GameRenderer(canvas, game);

  const score = requiredElement<HTMLElement>('#score');
  const height = requiredElement<HTMLElement>('#height');
  const best = requiredElement<HTMLElement>('#best');
  const currentName = requiredElement<HTMLElement>('#current-name');
  const nextName = requiredElement<HTMLElement>('#next-name');
  const nextColor = requiredElement<HTMLElement>('#next-color');
  const phaseLabel = requiredElement<HTMLElement>('#phase-label');
  const seedLabel = requiredElement<HTMLElement>('#seed');
  const gameOver = requiredElement<HTMLElement>('#game-over');
  const finalScore = requiredElement<HTMLElement>('#final-score');
  const finalHeight = requiredElement<HTMLElement>('#final-height');
  requiredElement<HTMLElement>('#loading').remove();
  seedLabel.textContent = String(seed);

  const act = (action: string): void => {
    if (action === 'left') game.move(-1);
    if (action === 'right') game.move(1);
    if (action === 'rotate-left') game.turn(-1);
    if (action === 'rotate-right') game.turn(1);
    if (action === 'drop') game.drop();
  };

  const touchControls = requiredElement<HTMLElement>('.touch-controls');
  touchControls.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });
  touchControls.addEventListener('selectstart', (event) => event.preventDefault());
  touchControls.addEventListener('contextmenu', (event) => event.preventDefault());
  document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      act(button.dataset.action ?? '');
    });
  });
  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'a', 'd', 'q', 'e', ' '].includes(key)) event.preventDefault();
    if (key === 'arrowleft' || key === 'a') act('left');
    if (key === 'arrowright' || key === 'd') act('right');
    if (key === 'q') act('rotate-left');
    if (key === 'e') act('rotate-right');
    if (key === ' ') act('drop');
  });
  window.addEventListener('resize', () => renderer.resize());

  const dialog = requiredElement<HTMLDialogElement>('#info-dialog');
  requiredElement<HTMLButtonElement>('#info-button').addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  requiredElement<HTMLButtonElement>('#retry-button').addEventListener('click', () => {
    url.searchParams.set('seed', String(seed));
    window.location.href = url.toString();
  });
  requiredElement<HTMLButtonElement>('#new-button').addEventListener('click', () => {
    window.location.href = `${window.location.pathname}${window.location.hash}`;
  });

  let previousTime = performance.now();
  let accumulator = 0;
  let gameOverShown = false;
  const frame = (time: number): void => {
    accumulator += Math.min(100, time - previousTime);
    previousTime = time;
    while (accumulator >= game.fixedStepMs) {
      game.update();
      accumulator -= game.fixedStepMs;
    }
    renderer.render();
    const snapshot = game.snapshot();
    score.textContent = String(snapshot.score);
    height.textContent = snapshot.heightKm.toFixed(1);
    best.textContent = String(snapshot.records.bestScore);
    currentName.textContent = snapshot.currentName;
    nextName.textContent = snapshot.nextName;
    nextColor.style.backgroundColor = game.nextAsset.color;
    phaseLabel.textContent = phaseLabels[snapshot.phase];
    if (snapshot.phase === 'gameOver' && !gameOverShown) {
      gameOverShown = true;
      finalScore.textContent = String(snapshot.score);
      finalHeight.textContent = `${snapshot.heightKm.toFixed(1)} km`;
      gameOver.hidden = false;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

start().catch((error: unknown) => {
  const loading = document.querySelector<HTMLElement>('#loading');
  if (loading) loading.innerHTML = `<p>読み込みに失敗しました。<br>${error instanceof Error ? error.message : String(error)}</p>`;
  console.error(error);
});
