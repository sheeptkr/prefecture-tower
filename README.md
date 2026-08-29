# 都道府県タワー

実際の面積・距離関係を保った47都道府県を積み上げるWeb物理ゲームです。従来の1人用に加え、招待URLで友達と遊べるオンライン2人対戦を収録しています。Vite、TypeScript、Matter.js 0.20、独自Canvas 2Dレンダラーで構築しています。

[ブラウザで都道府県タワーを遊ぶ](https://sheeptkr.github.io/prefecture-tower/)

## 遊び方

- `←` / `→` または `A` / `D`: 左右移動
- `Q` / `E`: 15度ずつ回転
- `Space`: 落下（決定後は操作不可）
- スマートフォンでは画面下部の5ボタンを使用

配置中は県本体の幅の半分まで足場の左右へはみ出せます。落下後に安定判定が完了しない場合も、5秒で現在の県を確定して次へ進みます。

県は毎回47県から独立・等確率で抽選されます。`?seed=20260401`のようにURLへseedを付けると同じ順番を再現できます。フィールド上にあるいずれかの県の最大陸地がデスラインを越えると終了します。

## 開発

Node.js 22以上を使用します。

```sh
npm install
npm run dev
```

オンライン対戦を試す場合は、別のターミナルでCloudflare Workerを起動します。

```sh
npm run dev:worker
```

Viteはローカル環境では自動的に`http://localhost:8787`、公開ビルドでは既定のCloudflare Workerを対戦APIとして使います。任意のWorkerへ接続する場合は、Vite起動時に`VITE_BATTLE_API_URL`を設定してください。

```sh
VITE_BATTLE_API_URL=https://prefecture-tower-battle.example.workers.dev npm run dev
```

生成済みの`public/assets/prefectures.json`をコミットしているため、ゲーム実行時に外部APIへアクセスしません。

```sh
npm run lint
npm test
npm run data:validate
npm run build
npm run build:worker
npm run test:e2e
```

## オンライン対戦

- Room IDは紛らわしい文字を除いた6文字で、アカウント登録は不要です。
- 2人揃うとseed付き乱数で先攻を決め、1つのタワーへ交互に積みます。
- 対戦では判断と崩れやすさを高めるため、台の横幅を1人用の50%にします。
- 1手は10秒。期限時はサーバーが現在の位置・角度で自動DROPします。
- DROP後は両ブラウザで1人用と同じ固定60Hzの落下経過を描画し、落下が完了してから次の10秒手番を開始します。
- 10県到達後、5県ごとに直前のプレイヤーが5秒の「県送り」を行います。時間切れはサーバーseedから4候補の1つを選びます。
- 一時切断は同じブラウザに保存したreconnect tokenで30秒間再接続できます。通常手番と県送りの時計は止まりません。
- 決着後は両プレイヤーが「もう一度対戦」を選ぶと、同じRoom ID・接続のまま盤面をリセットして次の試合を開始できます。
- 手番外入力、範囲外座標、任意角度、候補外カード、期限後入力はサーバー側で受理しません。

### 状態と物理の同期

正しいRoom、手番、配置入力、期限、県抽選、県送り、勝敗、RNG状態はRoomごとのDurable Objectが管理します。Matter.jsをDOで常時60Hz動かすことはせず、DROP確定時だけ既存ゲームと同じ固定60Hz・最大300tickの物理計算をまとめて実行します。確定した全bodyの位置、角度、速度、sleep状態を1回だけ両クライアントへ送り、クライアントはそのスナップショットを描画します。

両ブラウザだけの決定論的再生はブラウザ差と再接続時のずれが残り、操作側ブラウザを正とする方式は改ざんに弱く、常時サーバー計算はCPUと通信を浪費します。DROP時バースト計算は既存のMatter.js挙動を再利用しつつ、1手あたりの通信を入力イベントと確定スナップショットに限定できるため採用しています。詳細は[対戦アーキテクチャ](docs/battle-architecture.md)を参照してください。

### Cloudflareへのデプロイ

1. `wrangler.jsonc`の`ALLOWED_ORIGIN`を実際のGitHub Pages originへ合わせる。
2. `npx wrangler login`後、`npx wrangler deploy`を実行する。初回はSQLite-backed Durable Object `BattleRoom`のmigration `v1`も適用される。
3. GitHubリポジトリのActions variable `BATTLE_API_URL`へ、デプロイされたWorker URLを登録する。
4. `main`へpushし、既存Pages workflowでフロントを配信する。

Workerは外部DB、AI API、常時稼働VMを使いません。Room状態はDurable Object内の小さなJSONだけで、ゲーム終了後または無操作1時間後に破棄できます。料金・無料枠はCloudflare側で変更され得るため、公開前にアカウントの現在のlimitsを確認してください。

## 形状データの再生成

```sh
npm run data:generate
```

初回のみ固定GitHubコミットと国土地理院ベクトルタイルへのネットワーク接続が必要です。原データは`.cache/`へ置かれ、リポジトリには含まれません。

生成処理は次の順序です。

1. `simplify-japan-geojson`の固定コミットから47県を取得
2. 市区町村を県単位へ結合し、ポリゴンの穴を除去
3. 全国共通のランベルト正積方位図法（中心36°N, 138°E）でkm座標へ変換
4. 最大陸地の重心をローカル原点にし、保持島の実距離を維持
5. Visvalingam法で本体20～80頂点、島6～24頂点へ簡略化
6. `poly-decomp`で最大256の凸パーツへ事前分解
7. 出典URL、固定revision、SHA-256、竹島タイル座標をJSON内のマニフェストへ保存

通常の離島は省略し、東京・沖縄に収録された全島、北方領土、淡路島、佐渡島、小豆島、竹島を保持しています。竹島は2026年4月1日版の地理院地図Vector海岸線を9タイルから取得し、閉じた陸地リングへ連結しています。

`+units=km`のデータ契約を保ちつつ、proj4js内部では同じ投影をメートルで計算して1000で除算しています（proj4jsのLAEAに必要なゼロのfalse easting/northingも明示）。県ごとの正規化は行いません。

## 物理と記録

- 固定60Hz、position iterations 10、velocity iterations 8
- 重力scale 0.0018、反発0、動摩擦0.3、静止摩擦0.5、空気抵抗0.06（足場は動摩擦0.6、静止摩擦0.7）
- 保持面積を中央値で割った質量（上限8）
- 凸パーツの面積加重重心を使用し、各パーツの重心距離を平行軸の定理で慣性モーメントへ反映
- 足場または他県への支持点上に重心の水平投影があり、線速度・角速度が0.35秒間しきい値以下なら1県として得点。5秒でタイムアウトして進行を保証
- 次の県を配置している間も、フィールド上の県の物理演算を継続
- 安定判定済みの県はMatter.jsのsleep状態へ移行し、他県の衝突時に自動で起床
- 複合剛体の多点接触で生じる上向き速度を0.35へ制限し、回転を保ったまま跳ね上がりを抑制
- 高さは足場上の最大陸地だけで計測し、遠隔島は除外
- ベスト得点と最高高度を`localStorage`へ保存

## データ出典・ライセンス

- [国土数値情報（行政区域データ）2026年](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html)（国土交通省）を加工した[simplify-japan-geojson固定コミット](https://github.com/ricewin/simplify-japan-geojson/tree/58c561b557eab3a08ee7aa17b6837bcd789cdf43)を使用。データセットは[CC BY 4.0](https://github.com/ricewin/simplify-japan-geojson/blob/58c561b557eab3a08ee7aa17b6837bcd789cdf43/LICENSE)で提供されており、本プロジェクトでは県単位結合、選択的な島保持、投影、穴除去、追加簡略化、凸分解を行っています。
- 竹島の海岸線は[地理院地図Vector](https://github.com/gsi-cyberjapan/gsimaps-vector-experiment)（国土地理院）の2026年4月1日版ベクトルタイルを加工しています。
- 利用にあたっては[国土数値情報コンテンツ利用規約](https://nlftp.mlit.go.jp/ksj/other/agreement.html)および[国土地理院コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)も確認してください。

係争地域を含む表現は、採用した日本の公的データ表現に基づくものです。国際的主張の判定や見解の表明を目的としていません。

ゲームのソースコードは[MIT License](LICENSE)です。主要なOSSはMatter.js（MIT）、poly-decomp.js（MIT）、proj4js（MIT）、mapshaper（MPL-2.0）です。各依存関係のライセンスは`package-lock.json`に固定された配布元も参照してください。
