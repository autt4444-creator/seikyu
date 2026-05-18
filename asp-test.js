/* ============================================================
   ASP 成果連携テスト用ランディングページ
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const ASP_TEST_STORAGE_KEY = 'asp-test-results-v1';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function getRouteContext() {
  const parts = location.pathname.split('/').filter(Boolean);
  const clIndex = parts.findIndex((part) => part.toLowerCase() === 'cl');
  return {
    campaign: clIndex > 0 ? parts[clIndex - 1] : '',
    isClickPath: clIndex > 0,
  };
}

function getQueryParams() {
  return Object.fromEntries(new URLSearchParams(location.search).entries());
}

function getTrackingParams() {
  const params = getQueryParams();
  const route = getRouteContext();
  if (route.campaign && !params.campaign) params.campaign = route.campaign;
  return params;
}

function buildUrl(template, params) {
  const urlText = String(template || '').trim();
  if (!urlText) return '';

  const replaced = urlText.replace(/\{([a-zA-Z0-9_-]+)\}/g, (_, key) =>
    encodeURIComponent(params[key] || ''));
  const url = new URL(replaced, location.href);

  Object.entries(params).forEach(([key, value]) => {
    if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  });
  url.searchParams.set('test', '1');
  url.searchParams.set('converted_at', new Date().toISOString());
  return url.toString();
}

function normalizeBaseUrl(url) {
  const value = String(url || '').trim().replace(/\/+$/, '');
  return value || location.origin;
}

function getConfig() {
  const appConfig = window.APP_CONFIG || {};
  const params = getQueryParams();
  return {
    endpoint: params.cvUrl || appConfig.ASP_TEST_CONVERSION_URL || '',
    method: (params.method || appConfig.ASP_TEST_METHOD || 'GET_PIXEL').toUpperCase(),
    publicBaseUrl: normalizeBaseUrl(params.baseUrl || appConfig.ASP_TEST_PUBLIC_BASE_URL || ''),
    params: getTrackingParams(),
  };
}

function saveResult(result) {
  const current = JSON.parse(localStorage.getItem(ASP_TEST_STORAGE_KEY) || '[]');
  current.unshift(result);
  localStorage.setItem(ASP_TEST_STORAGE_KEY, JSON.stringify(current.slice(0, 20)));
}

function loadResults() {
  try {
    return JSON.parse(localStorage.getItem(ASP_TEST_STORAGE_KEY) || '[]');
  } catch (_) {
    return [];
  }
}

function renderParams(params) {
  const entries = Object.entries(params);
  if (!entries.length) {
    return '<div class="empty compact">URL にパラメータがありません。例：<code>?bId=3caedd08</code></div>';
  }
  return `
    <div class="table-wrap">
      <table class="list">
        <thead><tr><th>パラメータ</th><th>値</th></tr></thead>
        <tbody>
          ${entries.map(([key, value]) => `
            <tr><td><strong>${escapeHtml(key)}</strong></td><td>${escapeHtml(value)}</td></tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderResults() {
  const results = loadResults();
  $('#result-log').innerHTML = results.length ? `
    <div class="table-wrap">
      <table class="list">
        <thead><tr><th>日時</th><th>方式</th><th>送信先</th><th>状態</th></tr></thead>
        <tbody>
          ${results.map((r) => `
            <tr>
              <td>${escapeHtml(new Date(r.createdAt).toLocaleString('ja-JP'))}</td>
              <td>${escapeHtml(r.method)}</td>
              <td class="break-all">${escapeHtml(r.url)}</td>
              <td><span class="badge badge-${r.ok ? 'paid' : 'unpaid'}">${r.ok ? '送信済み' : '失敗'}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  ` : '<div class="empty compact">まだ送信履歴はありません。</div>';
}

function setStatus(message, type = 'success') {
  $('#send-status').innerHTML = `<div class="auth-${type === 'error' ? 'error' : 'success'}">${escapeHtml(message)}</div>`;
}

function sendByPixel(url) {
  return new Promise((resolve) => {
    const img = new Image();
    // 成果通知先が 204 や空レスポンスを返す ASP でもリクエスト自体は送られるため、
    // onerror でも失敗扱いにせず、短いタイムアウト後に送信済みとして扱います。
    const finish = () => resolve();
    img.onload = finish;
    img.onerror = finish;
    img.src = url;
    setTimeout(finish, 1500);
  });
}

async function sendConversion() {
  const config = getConfig();
  const endpoint = $('#cv-endpoint').value.trim();
  const method = $('#cv-method').value;
  const url = buildUrl(endpoint, config.params);

  if (!url) {
    setStatus('成果通知先 URL を入力してください。', 'error');
    return;
  }

  $('#send-button').disabled = true;
  $('#send-button').textContent = '送信中...';
  setStatus('成果を送信しています...');

  let ok = true;
  try {
    if (method === 'GET_PIXEL') {
      await sendByPixel(url);
    } else {
      await fetch(url, { method: method === 'POST' ? 'POST' : 'GET', mode: 'no-cors' });
    }
    setStatus('テスト成果を送信しました。ASP 側のテスト成果ログをご確認ください。');
  } catch (err) {
    ok = false;
    setStatus(err.message || String(err), 'error');
  } finally {
    saveResult({ createdAt: new Date().toISOString(), method, url, ok });
    renderResults();
    $('#send-button').disabled = false;
    $('#send-button').textContent = '成果を送信する';
  }
}

function createClickUrl(baseUrl, campaign, bId, param1) {
  const safeCampaign = encodeURIComponent(String(campaign || '').trim() || 'H558ec8Ha0ffaf0N');
  const url = new URL(`/${safeCampaign}/cl/`, normalizeBaseUrl(baseUrl));
  url.searchParams.set('bId', String(bId || '').trim() || '859b6df3');
  if (String(param1 || '').trim()) url.searchParams.set('param1', String(param1).trim());
  return url.toString();
}

function init() {
  const config = getConfig();
  const route = getRouteContext();
  const sampleUrl = `${config.publicBaseUrl}/H558ec8Ha0ffaf0N/cl/?bId=859b6df3&param1=${encodeURIComponent('{AFの値}')}`;
  const previewUrl = buildUrl(config.endpoint, config.params);

  $('#view').innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">ASP 成果連携テスト</h1>
        <div class="page-sub">テスト URL に付与されたクリック ID などを使い、ボタン押下で成果通知を送信します。</div>
      </div>
      <a class="btn" href="index.html">帳票アプリへ戻る</a>
    </div>

    <div class="card asp-hero">
      <div>
        <div class="asp-eyebrow">テスト URL</div>
        <div class="asp-url">${escapeHtml(location.href)}</div>
        <div class="text-small muted mt-3">参考例：${escapeHtml(sampleUrl)}</div>
        ${route.campaign ? `<div class="text-small muted mt-3">キャンペーンID：<strong>${escapeHtml(route.campaign)}</strong></div>` : ''}
      </div>
      <button class="btn btn-primary btn-lg" id="send-button">成果を送信する</button>
    </div>

    <div class="card">
      <h3 class="card-title">テスト URL 生成</h3>
      <div class="field">
        <label>公開ドメイン</label>
        <input type="url" id="gen-base-url" value="${escapeHtml(config.publicBaseUrl)}" placeholder="https://g2tesuto.vercel.app">
        <div class="text-small muted mt-3">ASP に入稿する URL のドメインです。Vercel の <code>https://g2tesuto.vercel.app</code> のような公開 URL を入れてください。</div>
      </div>
      <div class="form-grid-3">
        <div class="field">
          <label>キャンペーンID</label>
          <input type="text" id="gen-campaign" value="${escapeHtml(route.campaign || 'H558ec8Ha0ffaf0N')}" placeholder="H558ec8Ha0ffaf0N">
        </div>
        <div class="field">
          <label>bId</label>
          <input type="text" id="gen-bid" value="${escapeHtml(config.params.bId || '859b6df3')}" placeholder="859b6df3">
        </div>
        <div class="field">
          <label>param1（AF の値）</label>
          <input type="text" id="gen-param1" value="${escapeHtml(config.params.param1 || '{AFの値}')}" placeholder="{AFの値}">
        </div>
      </div>
      <div class="row-flex asp-generated-row">
        <input type="text" id="generated-url" readonly>
        <button class="btn" id="copy-generated-url" type="button">コピー</button>
        <a class="btn" id="open-generated-url" href="#">開く</a>
      </div>
      <div class="text-small muted mt-3">参考URL形式：<code>https://ac.cross-system.com/H558ec8Ha0ffaf0N/cl/?bId=859b6df3&amp;param1={AFの値}</code></div>
    </div>

    <div class="card">
      <h3 class="card-title">成果通知設定</h3>
      <div class="field">
        <label>成果通知先 URL</label>
        <input type="url" id="cv-endpoint" value="${escapeHtml(config.endpoint)}" placeholder="https://asp.example.com/conversion?bId={bId}">
        <div class="text-small muted mt-3"><code>{bId}</code> のように URL パラメータ名を波括弧で書くと、テスト URL の値で置換します。</div>
      </div>
      <div class="field">
        <label>送信方式</label>
        <select id="cv-method">
          <option value="GET_PIXEL" ${config.method === 'GET_PIXEL' ? 'selected' : ''}>GET（計測ピクセル）</option>
          <option value="GET" ${config.method === 'GET' ? 'selected' : ''}>GET（fetch / no-cors）</option>
          <option value="POST" ${config.method === 'POST' ? 'selected' : ''}>POST（fetch / no-cors）</option>
        </select>
      </div>
      <div id="send-status"></div>
      <div class="text-small muted mt-3 break-all">送信プレビュー：<span id="preview-url">${escapeHtml(previewUrl || '未設定')}</span></div>
    </div>

    <div class="card">
      <h3 class="card-title">受け取った URL パラメータ</h3>
      ${renderParams(config.params)}
    </div>

    <div class="card">
      <h3 class="card-title">送信履歴（このブラウザのみ）</h3>
      <div id="result-log"></div>
    </div>
  `;

  $('#send-button').onclick = sendConversion;
  $('#cv-endpoint').oninput = updatePreview;
  $('#cv-method').onchange = updatePreview;

  const updateGeneratedUrl = () => {
    const url = createClickUrl($('#gen-base-url').value, $('#gen-campaign').value, $('#gen-bid').value, $('#gen-param1').value);
    $('#generated-url').value = url;
    $('#open-generated-url').href = url;
  };
  ['gen-base-url', 'gen-campaign', 'gen-bid', 'gen-param1'].forEach((id) => {
    $('#' + id).oninput = updateGeneratedUrl;
  });
  $('#copy-generated-url').onclick = async () => {
    updateGeneratedUrl();
    try {
      await navigator.clipboard.writeText($('#generated-url').value);
      setStatus('生成したテスト URL をコピーしました。');
    } catch (_) {
      $('#generated-url').select();
      document.execCommand('copy');
      setStatus('生成したテスト URL をコピーしました。');
    }
  };
  updateGeneratedUrl();
  renderResults();
}

function updatePreview() {
  const params = getTrackingParams();
  $('#preview-url').textContent = buildUrl($('#cv-endpoint').value, params) || '未設定';
}

document.addEventListener('DOMContentLoaded', init);
