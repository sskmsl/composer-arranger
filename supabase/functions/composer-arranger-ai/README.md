# Composer Arranger AI Edge Function

ログイン済みComposer Arrangerユーザーの楽曲コンテキストを受け取り、3つの構造化されたArrangement Intentを返す。

## Secrets

- `COMPOSER_ARRANGER_OPENAI_API_KEY`: OpenAI Project API key（必須）
- `COMPOSER_ARRANGER_OPENAI_MODEL`: 任意。未設定時は`gpt-5.6-luna`

Supabaseが提供する`SUPABASE_URL`と`SUPABASE_ANON_KEY`でアクセストークンを検証する。OpenAI API keyをフロントエンドやGitHub Actionsへ渡してはならない。

## Deploy

```sh
supabase functions deploy composer-arranger-ai --project-ref vyeezhjzlyrigojsnkgd
```

JWT検証は既定の有効状態を維持し、関数内でも`/auth/v1/user`へ照会する。
