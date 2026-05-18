# seikyu

## ASP 成果連携テストページ

`asp-test.html` は、ASP のクリック URL から受け取った `campaign`（URL パス内のキャンペーンID）、`bId`、`param1` などを使って、ボタン押下でテスト成果を送信するページです。


## GitHub + Vercel で公開する手順

1. GitHub にこのリポジトリを push します。
2. Vercel の Dashboard で「Add New...」→「Project」を選びます。
3. GitHub 連携を選び、このリポジトリを Import します。
4. Framework Preset は静的サイトとして扱えるため、特別なビルド設定は不要です。Build Command は空、Output Directory も空のままで構いません。
5. Project Name を `g2tesuto` にすると、通常は `https://g2tesuto.vercel.app` のようなドメインになります。
6. Deploy を押します。
7. デプロイ後、次の URL を ASP に入稿できます。

```text
https://g2tesuto.vercel.app/H558ec8Ha0ffaf0N/cl/?bId={ASP側のクリックIDマクロ}&param1={ASP側のAF値マクロ}
```

Vercel では `vercel.json` の rewrites により、`/:campaign/cl/` 形式の URL が `asp-test.html` に内部転送されます。

## Step 1. 公開ドメインを決める

ASP に最初に入稿する URL は、ASP 側の `https://trident.catsys.jp/` ではなく、このリポジトリを公開した自分側のドメインです。

他のテスト環境と同じように `g2tesuto` という名前で使う場合は、Vercel のプロジェクト名を `g2tesuto` にして公開します。Vercel なら、通常は次のようなドメインになります。

```text
https://g2tesuto.vercel.app
```

独自ドメインを使う場合は、Vercel の「Custom domains」に追加したドメインを使ってください。

`config.js` の `ASP_TEST_PUBLIC_BASE_URL` に公開ドメインを入れると、画面の「テスト URL 生成」でもそのドメインの入稿 URL を作れます。

```js
ASP_TEST_PUBLIC_BASE_URL: 'https://g2tesuto.vercel.app',
```

空のままにした場合は、現在アクセスしているドメインを使ってテスト URL を生成します。

### ASP に入稿する URL

`g2tesuto` で公開した場合、ASP に登録する入稿 URL は次の形です。

```text
https://g2tesuto.vercel.app/H558ec8Ha0ffaf0N/cl/?bId={ASP側のクリックIDマクロ}&param1={ASP側のAF値マクロ}
```

手動テスト用に固定値で開く場合は、次のようにします。

```text
https://g2tesuto.vercel.app/H558ec8Ha0ffaf0N/cl/?bId=859b6df3&param1={AFの値}
```

パスの `H558ec8Ha0ffaf0N` はキャンペーンIDとして扱われ、成果通知先 URL の `{campaign}` に差し込めます。

ローカルや通常の静的ホスティングでは、直接 `asp-test.html` を開いてください。

```text
http://localhost:8000/asp-test.html?bId=859b6df3&param1={AFの値}
```

### テスト URL の生成

画面の「テスト URL 生成」で、以下を入力すると ASP クリック URL 形式のテスト URL を生成・コピーできます。

- 公開ドメイン: `https://g2tesuto.vercel.app`
- キャンペーンID: `H558ec8Ha0ffaf0N`
- bId: `859b6df3`
- param1（AF の値）: `{AFの値}`

生成例:

```text
https://g2tesuto.vercel.app/H558ec8Ha0ffaf0N/cl/?bId=859b6df3&param1={AFの値}
```

### 成果通知先の設定

`config.js` の `ASP_TEST_CONVERSION_URL` に成果通知先 URL を設定してください。

```js
ASP_TEST_CONVERSION_URL: 'https://asp.example.com/conversion?campaign={campaign}&bId={bId}&param1={param1}',
ASP_TEST_METHOD: 'GET_PIXEL',
```

`{campaign}` / `{bId}` / `{param1}` のように URL パラメータ名を波括弧で書くと、テスト URL の値で置換されます。`cvUrl` と `method` と `baseUrl` をテスト URL に付けると、一時的に上書きできます。
