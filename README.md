# Composer Arranger

コード進行と短いモチーフから、メロディ候補を生成・発展・比較するための作曲支援アプリ。
[Composer_OS_Composer_Arranger_Spec_v1_5](./docs/spec-source.md) に基づく実装。

Composer OS内では [Chord Generator](https://github.com/sskmsl/composer-os-chord-generator) とは別アプリとして実装し、
Composer Project (JSON) を介して連携する(仕様書2章)。

## 現在の実装スコープ

仕様書は7フェーズ構成(Melody → Arrangement → Logic Round Trip → Extended Arrangement)だが、
このリポジトリは **Phase 1(Melody実用最小版)+ Phase 2(Melody作曲支援の核)** のみを実装している。

実装済み:

- Composer Project の読込・保存・JSON書き出し/読み込み(schemaVersion 1.1, 14章)
- Chord Generatorの `.composer-song.json` 読み込み
  (曲名・テンポ・セクション順・コード・繰り返しを新規Composer Projectへ変換)
  - Section ROLEは両アプリ共通の10種類
    (イントロ / Aメロ / Bメロ / サビ / 落ちサビ / 大サビ / Cメロ /
    ブリッジ / 間奏 / アウトロ)
- 手動コード入力("F#m(add9) | E | D | Dsus2" 形式, 6.3章)
- Generate from Chords: ルールベースのMelody Engineによる6候補生成(9章)
  - Harmonic Map / Phrase Planner / Rhythm & Pitch Motif / Motif Development / Scoring / Diversity Filter
  - Song Profile初期値傾向(9.9.1)・セクション別生成ルール(8章)を反映
- Phrase Ideas: コード・Section Role・Song Profileから、2〜4小節の独立した3候補を生成
  - Motif / Rhythm / Contour / Harmonic Approach / Cadenceを実音より先に計画
  - 個別試聴・個別再生成・Logic Pro向けMIDI書き出し
  - 設計詳細: [Phrase Generation](./docs/phrase-generation.md)
- 3.3章の客観的特徴量の算出・表示(類似度スコアは非表示)
- ピアノロール(コード背景・フレーズ境界・クライマックス表示・Lock表示)
- Pitch Lock(ノート単位)・Bar Lock(小節単位)、選択範囲のみ再生成(10章)
- Develop a Seed: Continue / Variation(rhythm・pitch)/ Answer Phrase / Expand / Lift / Restrain(5.2章)
- Web Audioによる簡易プレビュー再生(Melody Only / Chords + Melody / Chords Only)
- Logic Pro向け SMF Type 1 書き出し
- Undo/Redo、生成履歴、IndexedDBへの自動保存(15章・17章)

未実装(今後のフェーズで対応):

- Arrangement / Audition モジュール(Phase 3〜7)
- Improve Existing Melody(既存MIDI読込による改善提案)
- MIDI Import・自動コード判定
- Logic Pro Round Trip(WAV/ステム読込・解析)

## デザイン

`DESIGN-apple.md` のデザイントークン(Action Blue #0066cc、SF Pro、pill型ボタン、
ヘアラインボーダー、単一の柔らかいシャドウ)を、マーケティングサイトではなく
DAW隣接の制作ツールとして再解釈し、近黒(#000000〜#2a2a2c)のダークUIをベースにしている。

## 技術スタック

Composer OS Chord Generatorと同一スタック: React 19 + TypeScript + Vite + Tailwind CSS v4 +
zustand + idb (IndexedDB)。Electronパッケージングは現フェーズでは未導入(Webアプリとして動作)。

## セットアップ

```bash
npm install
npm run dev
```

## アーキテクチャ

```text
src/
  core/            Music Domain Core (Note/Chord/Section/Melody/Project の型とロジック)
  melody-engine/    Melody Engine (9章: Harmonic Map〜Diversity Filter、Develop a Seed、選択範囲再生成)
  phrase-engine/    2〜4小節のPhrase計画・品質評価・多様性選抜・個別再生成
  midi/             SMF Type 1 エンコーダ・書き出し
  audio/            Web Audioプレビュー再生・コードボイシング
  storage/          IndexedDB永続化、Composer Project JSONの読み書き
  store/            zustand: アプリ状態・Undo/Redo・生成アクション
  app/              UIコンポーネント(TopBar/LeftPanel/RightPanel/BottomBar/PianoRoll等)
  ui/               Apple design tokensベースの共通UIプリミティブ
```

生成ロジックは決定論的seed(mulberry32)を使用し、同一seed・同一入力から同じ結果を再現できる(仕様書18章 受け入れ条件13)。

## 既知の設計上の簡略化(レビュー時の参考)

- Develop a Seedのシード入力は、フリーハンド入力UIの代わりに「既存候補のノートを選択してSeedにする」方式にしている。
- コードシンボルのパースはジャズ理論の完全網羅ではなく、ポップ/シネマティック領域で頻出する記法を対象にしている(`src/core/chord.ts`)。
- Undo/Redoは仕様書10章の「生成単位/ノート単位」の2階層を区別せず、単一のプロジェクトスナップショット履歴として実装している。
