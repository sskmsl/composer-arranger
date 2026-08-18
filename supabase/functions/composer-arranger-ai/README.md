# Composer Arranger AI Edge Function

ログイン済みComposer Arrangerユーザーの楽曲コンテキストを受け取り、3つの構造化されたArrangement Intentを返す。

## Secrets

- `COMPOSER_ARRANGER_OPENAI_API_KEY`: OpenAI Project API key（必須）
- `COMPOSER_ARRANGER_OPENAI_MODEL`: 任意。未設定時は`gpt-5.6-luna`
- `COMPOSER_ARRANGER_OPENAI_AUDIO_MODEL`: 任意。未設定時は`gpt-audio-1.5`

Supabaseが提供する`SUPABASE_URL`と`SUPABASE_ANON_KEY`でアクセストークンを検証する。OpenAI API keyをフロントエンドやGitHub Actionsへ渡してはならない。

音源添付時はMP3/WAV（12MB・10分以内）をリクエスト中だけ`gpt-audio-1.5`へ渡し、保存しない。音声モデルの観察結果を`gpt-5.6-luna`が既存のコード・Active Melodyと統合する。音源なしの従来相談も利用できる。

## Deploy

```sh
supabase functions deploy composer-arranger-ai --project-ref vyeezhjzlyrigojsnkgd
```

JWT検証は既定の有効状態を維持し、関数内でも`/auth/v1/user`へ照会する。
