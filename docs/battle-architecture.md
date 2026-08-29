# オンライン対戦アーキテクチャ

## 責務

フロントはGitHub Pagesのまま維持し、Room APIとWebSocketだけをCloudflare Workerへ送る。Room IDをDurable Object名へ変換し、1 Roomを1 Objectへ直列化する。

Durable Objectが確定する状態は次のとおり。

- 最大2人のplayer number、reconnect token、接続状態
- Battle phase、現在手番、手番と県送りのdeadline
- current / next / forced prefecture code
- placementのX座標と15度単位の角度
- score、height、winner、loser
- seedとRNG内部状態
- 確定済みMatter bodyの位置、角度、速度、sleep
- 県送りの4候補と選択権
- 再戦に同意したplayer numberとRoom内の試合番号

クライアントから受けるのは`move`、`rotate`、`drop`、`attackSelect`という入力イベントだけである。任意座標、任意角度、任意の都道府県IDはプロトコルに含めない。

決着後の`rematch`は各プレイヤー1回だけreadyとして記録し、2人が揃った時点で盤面、スコア、勝敗、県送り進行を初期化する。Room ID、player number、WebSocket、reconnect tokenは維持し、新しいseedと先攻で次の試合を始める。

## 物理同期の比較

| 方式 | 一致性 | チート耐性 | Worker負荷 | 判断 |
|---|---:|---:|---:|---|
| 両クライアントで常時再生 | ブラウザ差で長期保証が難しい | 中 | 最小 | 不採用 |
| DROPしたクライアントの結果を採用 | 表示は一致 | 低 | 最小 | 不採用 |
| Workerで常時60Hz | 高 | 高 | 大 | 不採用 |
| WorkerでDROP時だけ最大300tick | 高 | 高 | 手ごとに限定 | 採用 |

DROPまたは10秒のdeadline到達時、DOは保存済みbodyを`PrefectureTowerGame.loadBoard`で復元し、既存と同じ県形状・質量・摩擦・重力・安定判定で固定ステップを進める。安定または5秒相当の300tickで止め、最終盤面と完了までのtick数を保持する。Roomをそのtick数と同じ時間だけ`dropping`にし、両クライアントは元の盤面と入力から1人用と同じ60Hz落下を描画する。期限後にDOが確定盤面をbroadcastして次の手番を始める。クライアント側のMatter状態は演出用であり、正しさの根拠は常にDOの確定盤面である。

対戦用の台幅は`BATTLE_PLATFORM_WIDTH_SCALE = 0.5`をサーバーの移動制限・物理計算とクライアント描画で共有する。縮めるのは横幅だけで、台の厚みとデスライン高さは維持する。1人用はscale 1のまま変更しない。

この方式では落下アニメーション中の60Hzスナップショットは送らない。ネットワーク遅延、CPU、無料運用を優先し、確定結果を手ごとに1回送る。将来演出が必要なら、authoritativeな確定結果を変えず、クライアントだけで落下予測アニメーションを再生できる。

## Deadlineと再接続

deadlineは`Date.now()`基準の絶対時刻としてDO storageへ保存し、Alarmを最も近い手番期限、県送り期限、再接続猶予へ設定する。クライアントのカウントダウンは表示だけであり、期限判定には使わない。

WebSocket切断時はplayerを即敗北にせず、同じRoom専用tokenで30秒間再参加できる。期限は切断中も進む。30秒を過ぎると相手勝利になる。明示的な退出は即座に相手勝利となる。

## 県送りデータ

`public/assets/prefecture-hints.json`はゲーム中に外部APIを呼ばない静的データである。教科書に載る定番の名所を避け、郷土料理、ローカルな食べ方、地域習慣、地場産業から各県4件以上の難しめな雑学を人手で選び、`npm run hints:generate`で生成する。出典と年次を確認できる意外な都道府県ランキングも加える。全ヒントの難易度は3以上とし、単独表示でもデータ上は他県と重複しない文章にする。サーバーは4つの県候補それぞれについて、所属するヒントから1件をseed付きでランダムに選ぶ。カードには名前とprefecture codeを送らず、選択後にサーバーが対応codeを相手のcurrentへ適用する。

県送り中は両プレイヤーへ同じ4枚の公開カードを送る。選択権を持たない側はカードを閲覧できるが操作できない。選択または5秒の期限切れ後は`prefectureAttackReveal`へ遷移し、選ばれたカードにだけ正解県名を500ms公開してから、相手の次の手番へ進む。

`tests/assets.test.ts`が47県の網羅、fact数、ID重複、県名の直接混入、difficultyを検証する。文化・交通・産業などのfactを追加する際も同じschemaを維持する。

## コスト制御

- 毎フレーム通信・保存をしない。
- 入力イベントと手ごとの確定スナップショットだけを送る。
- 物理計算はDROP時だけ行う。
- 外部DB、AI API、ログ永続化、リプレイ保存を使わない。
- 無操作または終了Roomは1時間でstorageを削除できる。
- WebSocket Hibernation APIを使い、待機中にObjectをメモリへ常駐させない。

## Phase対応

1. `BattleStateMachine`で交互手番、deadline、勝敗を純粋ロジック化。
2. Worker / Durable Object / WebSocketとDROP時物理を追加。
3. Room作成、招待URL、token再接続を追加。
4. 10県以降5県ごとの県送りを追加。
5. 静的hint schemaと検証を追加。
6. モバイルoverlay、接続表示、unit/E2E、CI、運用手順を追加。
