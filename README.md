# Composer Arranger

Composer Arranger は、コード進行からメロディ・フレーズ・モチーフの候補を生成し、
比較・採用した結果を Logic Pro へ渡すための共同アレンジャーです。

DAW を目指すアプリではありません。ノート編集や細かな打ち込みは Logic Pro 側で行う前提で、
このアプリは「候補を出す」「聴き比べる」「採用したものを Logic Pro が読める形で渡す」ところまでを担当します。

## コンセプト

### 共同アレンジャー

コード進行を入力すると、Melody Engine がルールベースで複数のメロディ候補を生成します。
最終的な採否は常に人が行い、アプリは選択肢を提示する役割に徹します。

### アイデア生成支援

「良いメロディを1つ当てる」のではなく、切り口の異なる候補を並べて聴き比べられるようにすることを重視しています。
セクションごとに、通常のメロディだけでなく短いモチーフ・オスティナート・ドローンなど異なる性格の候補も生成できます。

### Logic Proとの役割分担

| Composer Arranger が担うもの | Logic Pro が担うもの |
| --- | --- |
| コード進行の入力・セクション構成 | 音源選び・ミックス・マスタリング |
| メロディ／フレーズ／モチーフ候補の生成と比較 | 細かなノート編集・打ち込み |
| 採用結果の MIDI 書き出し(セクションマーカー付き) | 演奏表現・オートメーション |

## 主な機能

- **コード入力**: `F#m(add9) | E | D | Dsus2` のようなテキスト表記でのコード入力、入力内容の解析結果・警告表示
- **Chord Generator 連携**: [Chord Generator](https://github.com/sskmsl/composer-os-chord-generator) の書き出しファイルを読み込み、曲名・テンポ・セクション・コードを引き継いで開始
- **セクション編集**: セクションの追加・複製・削除・ドラッグでの並び替え、Section Role(イントロ/Aメロ/サビ など)の設定
- **セクション内容の指定**: 各セクションで鳴らす内容を Melody / Motif / Ostinato / Drone / 無音 から選択(現在はイントロ以外へも設定可能)。Auto選択時はセクション適合度・Song Profile適合度・和声的な面白さ・構造の明瞭さ・間の心地よさを評価し、多様性を保ちながら3案を選抜
- **メロディ生成**: コード進行・セクション・Song Profile から複数のメロディ候補を生成。ノート単位・小節単位でのロックと部分再生成に対応
- **セクション接続(Transition)**: 前セクションの終止・音域・方向性・Motifの傾向を踏まえ、Resolved / Suspended / Open / Carry-over / Pickup / Call & Responseの6戦略から接続候補を計画。前セクションの採用メロディが変わった場合は接続情報が古い旨を表示
- **フレーズ生成**: 2〜8小節の独立したフレーズ候補を3案生成し、個別に試聴・再生成
- **Counter Generator**: Active Melodyの休符・隙間へ、Bell/Piano/Strings/Guitar/Synthの5スタイルから合いの手・応答フレーズ候補を生成。主旋律との衝突を検知
- **Decoration Generator**: 前後セクションの構造とコード進行から、装飾(Decorative)・移行(Transition)・終止(Ending)いずれかのフィル候補を生成。Active Melodyがなくても使える
- **候補の比較・採用**: 複数候補をブラインドで聴き比べ、Star/却下などで評価しながらセクションごとに採用案を決定
- **曲全体のプレビュー**: 採用したセクションを繋げて曲全体を試聴。セクション境界だけを前後1小節ずつ再生して繋がりを確認する機能もある
- **MIDI Export**: セクション単位・曲全体単位で SMF 書き出し。セクション名をマーカーとして出力し、Logic Pro 側で構成を確認できる。Counter/Decorationは専用トラックとして分離
- **Full Song Arrangement**: 全曲のEnergy Curveから8つの実音候補を生成し、品質・独自性・制作意図を評価して選抜。選ばれたDrums/Bass/Synth/Stringsへ役割別のVelocity・音価・microtimingを適用して独立MIDI出力
- **プロジェクト保存・同期**: ブラウザ内(IndexedDB)への自動保存、Supabaseによる端末間同期、プロジェクト一覧からの再開・複製・削除、JSON ファイルでの書き出し・読み込み
- **AI Arrangement Partner (Preview)**: 自然言語の相談と現在のコード・Active Melody・Section・Technique preferenceから、異なる3つのArrangement Intentを提案。選択したIntentを既存Generatorの設定へ変換して音の候補を生成
- **Undo/Redo**: 生成・編集操作の履歴管理

## ワークフロー

```text
コード入力 (または Chord Generator から取り込み)
  ↓
セクション構成の確認・編集
  ↓
候補生成 (メロディ / フレーズ / モチーフなど)
  ↓
比較・採用
  ↓
(任意) Counter / Decoration で合いの手・装飾フレーズを追加
  ↓
MIDI Export (セクションマーカー付き)
  ↓
Logic Pro で編曲・ミックス
```

## 技術構成

- React 19 + TypeScript + Vite
- Tailwind CSS v4
- zustand(状態管理)
- idb(IndexedDB によるローカル永続化)
- Supabase Auth / Database(設定時のみ有効な端末間同期)
- Web Audio API(プレビュー再生)
- ビルド出力を GitHub Pages へデプロイ

生成・試聴・MIDI出力はブラウザ内で完結します。Supabase設定時だけ、保存プロジェクトの認証・端末間同期にクラウドを利用します。環境変数が無いローカル開発では従来どおりローカル専用で動作します。

## Cloud同期の設定

1. コードジェネレーターと同じSupabase projectのSQL Editorで `supabase/arranger-projects.sql` を実行する。
2. ローカルでは `.env.local` に `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` を設定する。
3. GitHub Pagesでは同名のRepository Secretsを設定する。

AI Arrangement Partnerを利用する場合は、Supabase Edge Function Secretへ
`COMPOSER_ARRANGER_OPENAI_API_KEY`を登録し、`composer-arranger-ai` Functionをデプロイする。
API keyはフロントエンド用の`VITE_*`環境変数やGitHubへ登録しない。

公開版はSupabase設定時にログイン必須となる。同じアカウントでログインすると、全Composer Arranger projectが更新日時を基準に統合される。別端末での削除はtombstoneとして同期され、古い端末から削除済みprojectが復活しない。

## 開発状況

**Completed**

- コード入力・セクション編集・Chord Generator 連携
- メロディ／フレーズ生成、ロック・部分再生成、Develop a Seed(継続/変奏など)
- セクション内容(Melody/Motif/Ostinato/Drone/無音)の生成と MIDI トラック分離、Auto選択の品質評価・多様性選抜
- セクション間の接続(Transition)を考慮したメロディ生成
- Counter Generator・Decoration Generator(主旋律を保護する共通基盤・衝突回避つき)
- リズム/拍節の自然さ、候補多様性選抜、Generator Profileごとの生成規則の改善
- 候補比較・採用ワークフロー
- MIDI Export(セクションマーカー付き)、プロジェクト保存・IndexedDB自動保存

**In Progress**

- なし(直近の改善は上記Completedへ反映済み)

**Future**

- 複数レイヤーの重ね合わせ(モチーフ+オスティナートの同時使用など)
- Arrangement Engine(Pad/Texture/FX を含む本格的な伴奏生成)
- 既存 MIDI やオーディオを読み込んでの改善提案(Logic Pro Round Trip)

## Philosophy

Composer Arranger は作曲を自動化するツールではなく、創作のヒントを提示する共同アレンジャーです。
最終的にどの音を残すかは常に人が決め、アプリはその判断のための材料を用意することに徹します。
