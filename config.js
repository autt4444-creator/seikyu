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

  // ASP 成果連携テストページ（asp-test.html）用
  // ASP に入稿する公開ドメイン。例: 'https://g2tesuto.vercel.app'
  // 空の場合は、現在アクセスしているドメインを使ってテスト URL を生成します。
  ASP_TEST_PUBLIC_BASE_URL: '',
  // 例: 'https://asp.example.com/conversion?campaign={campaign}&bId={bId}&param1={param1}'
  // URL パラメータ名を {campaign} / {bId} / {param1} のように書くと、テスト URL の値で置換されます。
  ASP_TEST_CONVERSION_URL: '',
  // GET_PIXEL / GET / POST
  ASP_TEST_METHOD: 'GET_PIXEL',
};
