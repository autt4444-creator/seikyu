/* ============================================================
   Supabase 接続設定
   ============================================================
   このファイルを編集して Supabase の接続情報を設定してください。

   【手順】
   1. https://supabase.com にサインアップ（無料）
   2. 「New Project」で新規プロジェクト作成
      - Region: Northeast Asia (Tokyo) を推奨
      - DB Password: 任意の強いパスワードを設定（後で使うのでメモ）
      - 数分待つと作成完了
   3. 左メニュー「SQL Editor」→「New query」
      schema.sql の中身をコピペして「Run」をクリック
   4. 左メニュー「Authentication」→「Providers」→「Email」
      "Confirm email" を OFF にする（招待制ではないので即時利用可能に）
   5. 左メニュー（歯車アイコン）「Project Settings」→「API」
      下記 2 つの値をコピー:
        - Project URL
        - anon public key
   6. 下の YOUR_PROJECT_URL と YOUR_ANON_KEY を実際の値に書き換える
   7. このファイルを保存して Cloudflare Pages にアップロード
   ============================================================ */

window.APP_CONFIG = {
  SUPABASE_URL: 'YOUR_PROJECT_URL',
  SUPABASE_ANON_KEY: 'YOUR_ANON_KEY',
};
