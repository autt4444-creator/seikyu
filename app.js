/* ============================================================
   見積書・請求書作成 Web アプリ
   Supabase 版（複数ユーザー共有 / クラウド保存）
   ============================================================ */

// ---------- Utilities ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => 'd_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDaysISO = (iso, days) => {
  const d = new Date(iso); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const fmtDate = (iso) => iso ? iso.replace(/-/g, '/') : '';
const fmtYen = (n) => '¥' + Math.round(n || 0).toLocaleString('ja-JP');
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TAX_RATE = 0.10;
const MAX_ITEMS = 10;
const TYPE_LABEL = { estimate: '見積書', invoice: '請求書' };
const STATUS_LABEL = { draft: '下書き', unpaid: '未払い', paid: '支払済み' };

// LocalStorage v2 キー（旧データの取り込み用）
const LEGACY_STORAGE_KEY = 'invoice-app-v2';

// ---------- Supabase ----------
let sb = null;
let currentUser = null;

// In-memory cache（Supabase からロードしたデータ）
let db = {
  documents: [],
  issuer: { name: '', address: '', phone: '', email: '' },
};

function isConfigured() {
  const c = window.APP_CONFIG;
  if (!c) return false;
  if (!c.SUPABASE_URL || !c.SUPABASE_ANON_KEY) return false;
  if (c.SUPABASE_URL.startsWith('YOUR_') || c.SUPABASE_ANON_KEY.startsWith('YOUR_')) return false;
  if (!c.SUPABASE_URL.startsWith('http')) return false;
  return true;
}

// ---------- Toast / Modal ----------
function toast(msg, type = 'success') {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(40px)';
    el.style.transition = '0.2s';
  }, 2400);
  setTimeout(() => el.remove(), 2700);
}

function confirmModal(message) {
  return new Promise((resolve) => {
    const root = $('#modal-root');
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal">
          <div class="modal-header"><h3 class="modal-title">確認</h3></div>
          <div class="modal-body">${escapeHtml(message)}</div>
          <div class="modal-footer">
            <button class="btn" id="cm-cancel">キャンセル</button>
            <button class="btn btn-danger" id="cm-ok">実行</button>
          </div>
        </div>
      </div>
    `;
    $('#cm-cancel').onclick = () => { root.innerHTML = ''; resolve(false); };
    $('#cm-ok').onclick = () => { root.innerHTML = ''; resolve(true); };
  });
}

// ---------- Tax / Totals ----------
function calcTotals(items) {
  const subtotal = items.reduce((s, it) =>
    s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);
  const tax = Math.floor(subtotal * TAX_RATE);
  const total = subtotal + tax;
  return { subtotal, tax, total };
}

// ---------- Data conversion ----------
function rowToDoc(row) {
  return {
    id: row.id,
    type: row.type,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    client: row.client || { name: '', address: '' },
    title: row.title || '',
    items: row.items || [],
    subtotal: Number(row.subtotal) || 0,
    tax: Number(row.tax) || 0,
    total: Number(row.total) || 0,
    status: row.status || 'draft',
    note: row.note || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

function docToRow(doc) {
  return {
    id: doc.id,
    type: doc.type,
    issue_date: doc.issueDate,
    due_date: doc.dueDate || null,
    client: doc.client || {},
    title: doc.title || '',
    items: doc.items || [],
    subtotal: doc.subtotal || 0,
    tax: doc.tax || 0,
    total: doc.total || 0,
    status: doc.status || 'draft',
    note: doc.note || '',
    created_by: currentUser?.id || null,
  };
}

// ---------- Server I/O ----------
async function loadDB() {
  const [docsRes, issuerRes] = await Promise.all([
    sb.from('documents').select('*').order('created_at', { ascending: false }),
    sb.from('issuer').select('*').eq('id', 1).maybeSingle(),
  ]);

  if (docsRes.error) throw docsRes.error;
  if (issuerRes.error && issuerRes.error.code !== 'PGRST116') throw issuerRes.error;

  db.documents = (docsRes.data || []).map(rowToDoc);
  db.issuer = issuerRes.data
    ? {
        name: issuerRes.data.name || '',
        address: issuerRes.data.address || '',
        phone: issuerRes.data.phone || '',
        email: issuerRes.data.email || '',
      }
    : { name: '', address: '', phone: '', email: '' };
}

async function upsertDoc(doc) {
  const row = docToRow(doc);
  const { data, error } = await sb
    .from('documents')
    .upsert(row)
    .select()
    .single();
  if (error) throw error;
  const updated = rowToDoc(data);
  const idx = db.documents.findIndex((d) => d.id === updated.id);
  if (idx >= 0) db.documents[idx] = updated;
  else db.documents.unshift(updated);
  return updated;
}

async function deleteDocRemote(id) {
  const { error } = await sb.from('documents').delete().eq('id', id);
  if (error) throw error;
  db.documents = db.documents.filter((d) => d.id !== id);
}

async function saveIssuerRemote(issuer) {
  const { error } = await sb
    .from('issuer')
    .upsert({ id: 1, ...issuer });
  if (error) throw error;
  db.issuer = { ...issuer };
}

// ---------- Routing ----------
function navigate(route, params = {}) {
  const queryStr = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  location.hash = '#/' + route + (queryStr ? '?' + queryStr : '');
}

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [path, query] = hash.split('?');
  const params = {};
  if (query) {
    for (const pair of query.split('&')) {
      const [k, v] = pair.split('=');
      params[k] = decodeURIComponent(v || '');
    }
  }
  return { route: path || 'dashboard', params };
}

const routes = {
  dashboard: renderDashboard,
  new: renderForm,
  edit: renderForm,
  view: renderDetail,
  settings: renderSettings,
};

function router() {
  if (!currentUser) return; // guard against auth-less navigation
  const { route, params } = parseHash();
  const handler = routes[route] || renderDashboard;
  $$('.topnav a').forEach((el) => {
    el.classList.toggle('active', el.dataset.route === (route === 'settings' ? 'settings' : 'dashboard'));
  });
  window.scrollTo(0, 0);
  handler(params);
}

window.addEventListener('hashchange', router);

// ---------- Helpers ----------
function findDoc(id) { return db.documents.find((d) => d.id === id); }

function ensureIssuerSet() {
  return !!(db.issuer.name && db.issuer.address);
}

// ============================================================
// Setup screen (config not yet entered)
// ============================================================
function renderSetupScreen() {
  $('#topbar').hidden = true;
  $('#view').innerHTML = `
    <div class="setup-wrap">
      <div class="card">
        <h1 class="page-title" style="text-align:center;">セットアップが必要です</h1>
        <div class="page-sub" style="text-align:center;margin-bottom:18px;">
          以下の手順で Supabase に接続してください
        </div>

        <div class="setup-step">
          <div class="setup-step-num">1</div>
          <div class="setup-step-body">
            <strong>Supabase に登録</strong><br>
            <a href="https://supabase.com" target="_blank" class="link">https://supabase.com</a> でサインアップ（無料）<br>
            「New Project」で新規プロジェクトを作成（Region: Tokyo 推奨）
          </div>
        </div>

        <div class="setup-step">
          <div class="setup-step-num">2</div>
          <div class="setup-step-body">
            <strong>データベースを作成</strong><br>
            左メニュー「<code>SQL Editor</code>」→ <code>New query</code><br>
            添付の <code>schema.sql</code> の中身を貼り付けて「<code>Run</code>」
          </div>
        </div>

        <div class="setup-step">
          <div class="setup-step-num">3</div>
          <div class="setup-step-body">
            <strong>メール確認を OFF にする（任意）</strong><br>
            左メニュー「<code>Authentication</code>」→「<code>Providers</code>」→「<code>Email</code>」<br>
            「<code>Confirm email</code>」を OFF にすると登録後すぐ使えます
          </div>
        </div>

        <div class="setup-step">
          <div class="setup-step-num">4</div>
          <div class="setup-step-body">
            <strong>API キーを取得</strong><br>
            左メニュー「<code>Project Settings</code>」→「<code>API</code>」<br>
            「<code>Project URL</code>」と「<code>anon public</code> key」をコピー
          </div>
        </div>

        <div class="setup-step">
          <div class="setup-step-num">5</div>
          <div class="setup-step-body">
            <strong>config.js を編集</strong><br>
            <code>config.js</code> の <code>YOUR_PROJECT_URL</code> と <code>YOUR_ANON_KEY</code> を実際の値に書き換える
          </div>
        </div>

        <div class="setup-step">
          <div class="setup-step-num">6</div>
          <div class="setup-step-body">
            <strong>Cloudflare Pages にアップロード</strong><br>
            <a href="https://dash.cloudflare.com" target="_blank" class="link">Cloudflare</a> にサインアップ → Workers & Pages → Pages → Upload assets<br>
            このフォルダ全体（index.html / styles.css / app.js / config.js / schema.sql）をドラッグ&ドロップ
          </div>
        </div>

        <div style="margin-top:18px;padding:12px;background:var(--bg);border-radius:6px;font-size:12px;color:var(--text-muted);">
          💡 すべて完了したらこのページを再読み込みしてください
        </div>
      </div>
    </div>
  `;
}

// ============================================================
// Auth screens
// ============================================================
function renderAuthScreen(mode = 'login', message = null) {
  $('#topbar').hidden = true;
  const isSignup = mode === 'signup';
  $('#view').innerHTML = `
    <div class="auth-wrap">
      <div class="auth-logo">
        <div class="brand-mark">請</div>
      </div>

      <div class="auth-card">
        <h1 class="auth-title">${isSignup ? '新規登録' : 'ログイン'}</h1>
        <div class="auth-sub">${isSignup ? 'アカウントを作成して開始' : 'メールアドレスでログイン'}</div>

        <div id="auth-msg"></div>

        <div class="field">
          <label>メールアドレス</label>
          <input type="email" id="auth-email" autocomplete="email">
        </div>
        <div class="field">
          <label>パスワード</label>
          <input type="password" id="auth-password" autocomplete="${isSignup ? 'new-password' : 'current-password'}">
        </div>

        <button class="btn btn-primary" id="auth-submit" style="width:100%;justify-content:center;">
          ${isSignup ? '登録する' : 'ログイン'}
        </button>

        <div class="auth-toggle">
          ${isSignup ? 'すでにアカウントをお持ちの方' : 'アカウントをお持ちでない方'}
          <a href="#" id="auth-switch">${isSignup ? 'ログイン' : '新規登録'}</a>
        </div>
      </div>
    </div>
  `;

  if (message) {
    $('#auth-msg').innerHTML = `<div class="auth-${message.type || 'success'}">${escapeHtml(message.text)}</div>`;
  }

  $('#auth-switch').onclick = (e) => {
    e.preventDefault();
    renderAuthScreen(isSignup ? 'login' : 'signup');
  };

  const submit = async () => {
    const email = $('#auth-email').value.trim();
    const password = $('#auth-password').value;
    if (!email || !password) {
      $('#auth-msg').innerHTML = '<div class="auth-error">メールアドレスとパスワードを入力してください</div>';
      return;
    }
    if (password.length < 6) {
      $('#auth-msg').innerHTML = '<div class="auth-error">パスワードは 6 文字以上で入力してください</div>';
      return;
    }

    $('#auth-submit').disabled = true;
    $('#auth-submit').textContent = '処理中...';

    try {
      if (isSignup) {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          renderAuthScreen('login', {
            type: 'success',
            text: '確認メールを送信しました。メール内のリンクをクリックしてからログインしてください。',
          });
          return;
        }
        // Auto-login (when "Confirm email" is OFF in Supabase)
        await onLoggedIn();
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await onLoggedIn();
      }
    } catch (err) {
      $('#auth-submit').disabled = false;
      $('#auth-submit').textContent = isSignup ? '登録する' : 'ログイン';
      let msg = err.message || String(err);
      if (msg.includes('Invalid login credentials')) msg = 'メールアドレスまたはパスワードが正しくありません';
      else if (msg.includes('User already registered')) msg = 'このメールアドレスは既に登録されています';
      else if (msg.includes('Email not confirmed')) msg = 'メール確認が完了していません。受信ボックスを確認してください。';
      $('#auth-msg').innerHTML = `<div class="auth-error">${escapeHtml(msg)}</div>`;
    }
  };

  $('#auth-submit').onclick = submit;
  $('#auth-email').onkeydown = (e) => { if (e.key === 'Enter') submit(); };
  $('#auth-password').onkeydown = (e) => { if (e.key === 'Enter') submit(); };
  setTimeout(() => $('#auth-email')?.focus(), 50);
}

// ============================================================
// Loading screen
// ============================================================
function renderLoading(text = '読み込み中...') {
  $('#topbar').hidden = true;
  $('#view').innerHTML = `<div class="loading-screen">${escapeHtml(text)}</div>`;
}

// ============================================================
// Dashboard
// ============================================================
function renderDashboard() {
  const view = $('#view');
  const estimates = db.documents.filter((d) => d.type === 'estimate');
  const invoices = db.documents.filter((d) => d.type === 'invoice');
  const unpaidCount = invoices.filter((d) => d.status === 'unpaid').length;
  const unpaidTotal = invoices
    .filter((d) => d.status === 'unpaid')
    .reduce((s, d) => s + (d.total || 0), 0);

  view.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">ダッシュボード</h1>
        <div class="page-sub">作成済の帳票一覧（全ユーザー共有）</div>
      </div>
      <div class="row-flex">
        <button class="btn" onclick="reloadAll()">🔄 更新</button>
        <button class="btn" onclick="navigate('new', {type:'estimate'})">＋ 見積書を作成</button>
        <button class="btn btn-primary" onclick="navigate('new', {type:'invoice'})">＋ 請求書を作成</button>
      </div>
    </div>

    ${!ensureIssuerSet() ? `
      <div class="card mb-4" style="border-color:var(--warning);background:var(--warning-soft);">
        <div class="row-flex">
          <div>
            <strong>自社情報が未登録です</strong>
            <div class="text-small muted">帳票に表示される発行者情報を登録してください</div>
          </div>
          <div class="spacer"></div>
          <button class="btn" onclick="navigate('settings')">設定へ</button>
        </div>
      </div>
    ` : ''}

    <div class="stat-grid">
      <div class="stat">
        <div class="stat-label">見積書</div>
        <div class="stat-value">${estimates.length} <span style="font-size:13px;color:var(--text-muted);font-weight:normal;">件</span></div>
      </div>
      <div class="stat">
        <div class="stat-label">請求書</div>
        <div class="stat-value">${invoices.length} <span style="font-size:13px;color:var(--text-muted);font-weight:normal;">件</span></div>
      </div>
      <div class="stat">
        <div class="stat-label">未払い件数</div>
        <div class="stat-value" style="color:${unpaidCount > 0 ? 'var(--warning)' : 'var(--text)'};">${unpaidCount}</div>
      </div>
      <div class="stat">
        <div class="stat-label">未払い合計</div>
        <div class="stat-value" style="color:${unpaidTotal > 0 ? 'var(--warning)' : 'var(--text)'};">${fmtYen(unpaidTotal)}</div>
      </div>
    </div>

    <div class="card">
      <div class="tabs">
        <button class="tab active" data-tab="estimate">見積書 (${estimates.length})</button>
        <button class="tab" data-tab="invoice">請求書 (${invoices.length})</button>
      </div>
      <div id="list-content"></div>
    </div>
  `;

  const renderList = (type) => {
    const docs = (type === 'estimate' ? estimates : invoices)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    $('#list-content').innerHTML = docs.length === 0 ? `
      <div class="empty">
        <div class="empty-title">${TYPE_LABEL[type]}がありません</div>
        右上の「＋ ${TYPE_LABEL[type]}を作成」から新規作成できます
      </div>
    ` : `
      <div class="table-wrap">
        <table class="list">
          <thead>
            <tr>
              <th>件名</th>
              <th>宛先</th>
              <th>発行日</th>
              <th>${type === 'estimate' ? '有効期限' : '支払期限'}</th>
              <th class="num">金額</th>
              ${type === 'invoice' ? '<th>状態</th>' : ''}
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${docs.map((d) => `
              <tr class="clickable" onclick="navigate('view', {id:'${d.id}'})">
                <td><strong>${escapeHtml(d.title || '（無題）')}</strong></td>
                <td>${escapeHtml(d.client?.name || '-')}</td>
                <td>${fmtDate(d.issueDate)}</td>
                <td>${fmtDate(d.dueDate)}</td>
                <td class="num">${fmtYen(d.total)}</td>
                ${type === 'invoice' ? `<td><span class="badge badge-${d.status}">${STATUS_LABEL[d.status]}</span></td>` : ''}
                <td class="text-right" onclick="event.stopPropagation()">
                  <button class="btn btn-sm" onclick="navigate('edit', {id:'${d.id}'})">編集</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  };

  $$('.tab').forEach((t) => {
    t.onclick = () => {
      $$('.tab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      renderList(t.dataset.tab);
    };
  });
  renderList('estimate');
}

// ============================================================
// Form (create / edit)
// ============================================================
function renderForm(params) {
  const view = $('#view');
  let doc;
  let isEdit = false;

  if (params.id) {
    const found = findDoc(params.id);
    if (!found) { toast('見つかりません', 'error'); navigate('dashboard'); return; }
    doc = JSON.parse(JSON.stringify(found));
    isEdit = true;
  } else if (params.fromEstimate) {
    const src = findDoc(params.fromEstimate);
    if (!src) { toast('変換元の見積書が見つかりません', 'error'); navigate('dashboard'); return; }
    doc = {
      id: uid(),
      type: 'invoice',
      issueDate: todayISO(),
      dueDate: addDaysISO(todayISO(), 30),
      client: { ...src.client },
      title: src.title,
      items: src.items.map((it) => ({ ...it })),
      note: src.note || '',
      status: 'unpaid',
    };
  } else {
    const type = params.type === 'invoice' ? 'invoice' : 'estimate';
    doc = {
      id: uid(),
      type,
      issueDate: todayISO(),
      dueDate: addDaysISO(todayISO(), 30),
      client: { name: '', address: '' },
      title: '',
      items: [{ name: '', quantity: 1, unitPrice: 0 }],
      note: '',
      status: type === 'invoice' ? 'unpaid' : 'draft',
    };
  }

  view.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${isEdit ? '編集' : '新規作成'}</h1>
        <div class="page-sub">${isEdit ? '保存済の帳票を編集します' : 'フォームに入力して保存してください'}</div>
      </div>
      <div class="row-flex">
        <button class="btn" onclick="history.back()">戻る</button>
      </div>
    </div>

    <div class="tabs">
      <button class="tab ${doc.type === 'estimate' ? 'active' : ''}" data-type="estimate">見積書</button>
      <button class="tab ${doc.type === 'invoice' ? 'active' : ''}" data-type="invoice">請求書</button>
    </div>

    <div class="card">
      <div class="form-grid-2">
        <div class="field">
          <label>発行日<span class="req">*</span></label>
          <input type="date" id="f-issue" value="${doc.issueDate}">
        </div>
        <div class="field">
          <label id="f-due-label">${doc.type === 'estimate' ? '有効期限' : '支払期限'}</label>
          <input type="date" id="f-due" value="${doc.dueDate || ''}">
        </div>
      </div>

      <div class="field">
        <label>件名</label>
        <input type="text" id="f-title" value="${escapeHtml(doc.title || '')}" placeholder="例：○○制作業務一式">
      </div>

      <div class="form-grid-2">
        <div class="field">
          <label>宛先（会社名・担当者）<span class="req">*</span></label>
          <input type="text" id="f-client-name" value="${escapeHtml(doc.client?.name || '')}" placeholder="株式会社○○">
        </div>
        <div class="field">
          <label>宛先住所</label>
          <input type="text" id="f-client-address" value="${escapeHtml(doc.client?.address || '')}" placeholder="東京都...">
        </div>
      </div>
    </div>

    <div class="card mt-3">
      <div class="row-flex mb-2">
        <h3 class="card-title" style="margin:0;">明細</h3>
        <span class="text-small muted">最大 ${MAX_ITEMS} 行 / 消費税 10% 固定</span>
        <div class="spacer"></div>
        <button type="button" class="btn btn-sm" id="btn-add-item">＋ 明細追加</button>
      </div>

      <table class="items-table">
        <thead>
          <tr>
            <th style="width:30px;">#</th>
            <th>品目名</th>
            <th class="num" style="width:90px;">数量</th>
            <th class="num" style="width:120px;">単価</th>
            <th class="num" style="width:130px;">小計</th>
            <th style="width:36px;"></th>
          </tr>
        </thead>
        <tbody id="items-body"></tbody>
      </table>

      <div class="totals-box">
        <div class="totals-grid" id="totals-grid"></div>
      </div>
    </div>

    <div class="card mt-3">
      <div class="field">
        <label>備考</label>
        <textarea id="f-note" rows="3" placeholder="フッターに表示されます">${escapeHtml(doc.note || '')}</textarea>
      </div>
      ${doc.type === 'invoice' ? `
        <div class="field">
          <label>支払いステータス</label>
          <select id="f-status">
            <option value="unpaid" ${doc.status === 'unpaid' ? 'selected' : ''}>未払い</option>
            <option value="paid" ${doc.status === 'paid' ? 'selected' : ''}>支払済み</option>
          </select>
        </div>
      ` : ''}
    </div>

    <div class="form-actions">
      ${isEdit ? `<button class="btn btn-danger" id="btn-delete">削除</button><div class="spacer"></div>` : '<div class="spacer"></div>'}
      <button class="btn" id="btn-save">保存</button>
      <button class="btn btn-primary" id="btn-save-view">保存して PDF プレビュー</button>
    </div>
  `;

  $$('.tab[data-type]').forEach((t) => {
    t.onclick = () => {
      const newType = t.dataset.type;
      if (newType === doc.type) return;
      doc.type = newType;
      if (newType === 'invoice' && !doc.status) doc.status = 'unpaid';
      $('#f-due-label').textContent = newType === 'estimate' ? '有効期限' : '支払期限';
      $$('.tab[data-type]').forEach((x) => x.classList.toggle('active', x === t));
      const noteCard = $('#f-note').closest('.card');
      if (newType === 'invoice' && !$('#f-status')) {
        const div = document.createElement('div');
        div.className = 'field';
        div.innerHTML = `
          <label>支払いステータス</label>
          <select id="f-status">
            <option value="unpaid" selected>未払い</option>
            <option value="paid">支払済み</option>
          </select>
        `;
        noteCard.appendChild(div);
      } else if (newType === 'estimate' && $('#f-status')) {
        $('#f-status').closest('.field').remove();
      }
    };
  });

  const itemsBody = $('#items-body');
  const renderItems = () => {
    itemsBody.innerHTML = doc.items.map((it, idx) => {
      const total = (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
      return `
        <tr data-idx="${idx}">
          <td class="muted">${idx + 1}</td>
          <td><input type="text" data-field="name" value="${escapeHtml(it.name || '')}" placeholder="品目名"></td>
          <td><input type="number" data-field="quantity" value="${it.quantity || 0}" step="0.01" class="num"></td>
          <td><input type="number" data-field="unitPrice" value="${it.unitPrice || 0}" step="1" class="num"></td>
          <td class="num">${fmtYen(total)}</td>
          <td><button type="button" class="btn btn-ghost btn-icon" data-remove>×</button></td>
        </tr>
      `;
    }).join('');

    itemsBody.querySelectorAll('tr').forEach((tr) => {
      const idx = Number(tr.dataset.idx);
      tr.querySelectorAll('[data-field]').forEach((input) => {
        input.oninput = () => {
          doc.items[idx][input.dataset.field] = input.value;
          const t = (Number(doc.items[idx].quantity) || 0) * (Number(doc.items[idx].unitPrice) || 0);
          tr.cells[4].textContent = fmtYen(t);
          renderTotals();
        };
      });
      tr.querySelector('[data-remove]').onclick = () => {
        if (doc.items.length === 1) {
          toast('明細は最低 1 行必要です', 'error'); return;
        }
        doc.items.splice(idx, 1);
        renderItems();
        renderTotals();
      };
    });
  };

  const renderTotals = () => {
    const t = calcTotals(doc.items);
    $('#totals-grid').innerHTML = `
      <div class="label">小計</div><div class="val">${fmtYen(t.subtotal)}</div>
      <div class="label">消費税 (10%)</div><div class="val">${fmtYen(t.tax)}</div>
      <div class="total-label">合計</div><div class="total-val">${fmtYen(t.total)}</div>
    `;
  };

  $('#btn-add-item').onclick = () => {
    if (doc.items.length >= MAX_ITEMS) {
      toast(`明細は最大 ${MAX_ITEMS} 行までです`, 'error'); return;
    }
    doc.items.push({ name: '', quantity: 1, unitPrice: 0 });
    renderItems();
    renderTotals();
  };

  renderItems();
  renderTotals();

  const collect = () => {
    doc.issueDate = $('#f-issue').value;
    doc.dueDate = $('#f-due').value || null;
    doc.title = $('#f-title').value.trim();
    doc.client = {
      name: $('#f-client-name').value.trim(),
      address: $('#f-client-address').value.trim(),
    };
    doc.note = $('#f-note').value;
    if (doc.type === 'invoice' && $('#f-status')) {
      doc.status = $('#f-status').value;
    } else if (doc.type === 'estimate') {
      doc.status = 'draft';
    }
    doc.items = doc.items.map((it) => ({
      name: String(it.name || '').trim(),
      quantity: Number(it.quantity) || 0,
      unitPrice: Number(it.unitPrice) || 0,
      total: (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
    }));
    const t = calcTotals(doc.items);
    doc.subtotal = t.subtotal;
    doc.tax = t.tax;
    doc.total = t.total;
  };

  const validate = () => {
    if (!doc.issueDate) { toast('発行日を入力してください', 'error'); return false; }
    if (!doc.client.name) { toast('宛先を入力してください', 'error'); return false; }
    if (doc.items.some((it) => !it.name)) { toast('品目名が空の行があります', 'error'); return false; }
    return true;
  };

  $('#btn-save').onclick = async () => {
    collect();
    if (!validate()) return;
    $('#btn-save').disabled = true;
    try {
      await upsertDoc(doc);
      toast('保存しました');
      navigate('dashboard');
    } catch (err) {
      console.error(err);
      toast('保存に失敗しました: ' + (err.message || err), 'error');
      $('#btn-save').disabled = false;
    }
  };

  $('#btn-save-view').onclick = async () => {
    collect();
    if (!validate()) return;
    $('#btn-save-view').disabled = true;
    try {
      await upsertDoc(doc);
      toast('保存しました');
      navigate('view', { id: doc.id });
    } catch (err) {
      console.error(err);
      toast('保存に失敗しました: ' + (err.message || err), 'error');
      $('#btn-save-view').disabled = false;
    }
  };

  if (isEdit) {
    $('#btn-delete').onclick = async () => {
      if (!await confirmModal('この帳票を削除します。よろしいですか？')) return;
      try {
        await deleteDocRemote(doc.id);
        toast('削除しました');
        navigate('dashboard');
      } catch (err) {
        toast('削除に失敗しました: ' + (err.message || err), 'error');
      }
    };
  }
}

// ============================================================
// Detail (PDF preview)
// ============================================================
function renderDetail(params) {
  const doc = findDoc(params.id);
  const view = $('#view');
  if (!doc) { view.innerHTML = '<div class="empty">見つかりません</div>'; return; }

  view.innerHTML = `
    <div class="page-header no-print">
      <div>
        <h1 class="page-title">${TYPE_LABEL[doc.type]}：${escapeHtml(doc.title || '（無題）')}</h1>
        <div class="page-sub">
          ${doc.type === 'invoice' ? `<span class="badge badge-${doc.status}">${STATUS_LABEL[doc.status]}</span>　` : ''}
          ${escapeHtml(doc.client?.name || '')}
        </div>
      </div>
      <div class="row-flex">
        <button class="btn" onclick="navigate('dashboard')">一覧へ</button>
      </div>
    </div>

    <div class="detail-actions no-print">
      <button class="btn" onclick="window.print()">🖨 PDF として印刷</button>
      <button class="btn" onclick="navigate('edit', {id:'${doc.id}'})">編集</button>
      <button class="btn" onclick="duplicateDoc('${doc.id}')">複製</button>
      ${doc.type === 'estimate'
        ? `<button class="btn btn-success" onclick="navigate('new', {fromEstimate:'${doc.id}'})">→ 請求書に変換</button>`
        : ''}
      ${doc.type === 'invoice' && doc.status === 'unpaid'
        ? `<button class="btn btn-success" onclick="markPaid('${doc.id}')">支払済みにする</button>`
        : ''}
      ${doc.type === 'invoice' && doc.status === 'paid'
        ? `<button class="btn" onclick="markUnpaid('${doc.id}')">未払いに戻す</button>`
        : ''}
      <div class="spacer"></div>
      <button class="btn btn-danger" onclick="deleteDoc('${doc.id}')">削除</button>
    </div>

    ${renderPDF(doc)}
  `;
}

function renderPDF(doc) {
  const issuer = db.issuer;
  return `
    <div class="pdf-page">
      <div class="pdf-header">
        <div></div>
        <div class="pdf-title">${TYPE_LABEL[doc.type]}</div>
      </div>

      <div class="pdf-meta">
        <div class="pdf-customer">
          ${escapeHtml(doc.client?.name || '')} 御中
          ${doc.client?.address ? `<div style="font-size:10pt;font-weight:normal;margin-top:4px;">${escapeHtml(doc.client.address)}</div>` : ''}
        </div>
        <div class="pdf-meta-info">
          <dl>
            <dt>発行日</dt><dd>${fmtDate(doc.issueDate)}</dd>
            <dt>${doc.type === 'estimate' ? '有効期限' : '支払期限'}</dt><dd>${fmtDate(doc.dueDate)}</dd>
          </dl>
        </div>
      </div>

      ${doc.title ? `<div class="pdf-subject"><strong>件名：</strong>${escapeHtml(doc.title)}</div>` : ''}

      <div class="pdf-amount-banner">
        <span class="label">${doc.type === 'estimate' ? 'お見積金額' : 'ご請求金額'}（税込）</span>
        <span class="value">${fmtYen(doc.total)}</span>
      </div>

      <table class="pdf-items">
        <thead>
          <tr>
            <th style="width:8%;">No.</th>
            <th>品目名</th>
            <th style="width:14%;">数量</th>
            <th style="width:18%;">単価</th>
            <th style="width:20%;">小計</th>
          </tr>
        </thead>
        <tbody>
          ${doc.items.map((it, i) => `
            <tr>
              <td class="center">${i + 1}</td>
              <td>${escapeHtml(it.name || '')}</td>
              <td class="num">${Number(it.quantity || 0).toLocaleString('ja-JP')}</td>
              <td class="num">${fmtYen(it.unitPrice)}</td>
              <td class="num">${fmtYen((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0))}</td>
            </tr>
          `).join('')}
          ${Array.from({ length: Math.max(0, 5 - doc.items.length) }).map(() => `
            <tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>
          `).join('')}
        </tbody>
      </table>

      <div class="pdf-totals">
        <table>
          <tr><td>小計</td><td class="num">${fmtYen(doc.subtotal)}</td></tr>
          <tr><td>消費税 (10%)</td><td class="num">${fmtYen(doc.tax)}</td></tr>
          <tr class="total"><td>合計（税込）</td><td class="num">${fmtYen(doc.total)}</td></tr>
        </table>
      </div>

      <div class="pdf-issuer">
        <div class="pdf-issuer-name">${escapeHtml(issuer.name || '（自社名未設定）')}</div>
        ${issuer.address ? `<div>${escapeHtml(issuer.address)}</div>` : ''}
        ${issuer.phone ? `<div>TEL：${escapeHtml(issuer.phone)}</div>` : ''}
        ${issuer.email ? `<div>${escapeHtml(issuer.email)}</div>` : ''}
      </div>

      ${doc.note ? `<div class="pdf-note">${escapeHtml(doc.note)}</div>` : ''}
    </div>
  `;
}

// ---------- Detail actions ----------
window.duplicateDoc = async (id) => {
  const src = findDoc(id);
  if (!src) return;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = uid();
  copy.issueDate = todayISO();
  copy.dueDate = addDaysISO(todayISO(), 30);
  if (copy.type === 'invoice') copy.status = 'unpaid';
  try {
    await upsertDoc(copy);
    toast('複製しました');
    navigate('edit', { id: copy.id });
  } catch (err) {
    toast('複製に失敗しました: ' + (err.message || err), 'error');
  }
};

window.deleteDoc = async (id) => {
  if (!await confirmModal('この帳票を削除します。よろしいですか？')) return;
  try {
    await deleteDocRemote(id);
    toast('削除しました');
    navigate('dashboard');
  } catch (err) {
    toast('削除に失敗しました: ' + (err.message || err), 'error');
  }
};

window.markPaid = async (id) => {
  const d = findDoc(id);
  if (!d) return;
  d.status = 'paid';
  try {
    await upsertDoc(d);
    toast('支払済みにしました');
    router();
  } catch (err) {
    toast('更新に失敗しました', 'error');
  }
};

window.markUnpaid = async (id) => {
  const d = findDoc(id);
  if (!d) return;
  d.status = 'unpaid';
  try {
    await upsertDoc(d);
    toast('未払いに戻しました');
    router();
  } catch (err) {
    toast('更新に失敗しました', 'error');
  }
};

window.reloadAll = async () => {
  try {
    await loadDB();
    toast('最新データを取得しました');
    router();
  } catch (err) {
    toast('読み込みに失敗しました', 'error');
  }
};

// ============================================================
// Settings
// ============================================================
function renderSettings() {
  const view = $('#view');
  const i = db.issuer;
  const legacyData = (() => {
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  })();

  view.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">設定</h1>
        <div class="page-sub">自社情報を入力してください。すべての帳票に自動反映されます。</div>
      </div>
      <button class="btn" onclick="navigate('dashboard')">ダッシュボードへ</button>
    </div>

    <div class="card">
      <h3 class="card-title">自社情報</h3>
      <div class="field">
        <label>会社名 / 屋号<span class="req">*</span></label>
        <input type="text" id="s-name" value="${escapeHtml(i.name || '')}" placeholder="株式会社○○">
      </div>
      <div class="field">
        <label>住所<span class="req">*</span></label>
        <input type="text" id="s-address" value="${escapeHtml(i.address || '')}" placeholder="東京都千代田区...">
      </div>
      <div class="form-grid-2">
        <div class="field">
          <label>電話番号</label>
          <input type="tel" id="s-phone" value="${escapeHtml(i.phone || '')}" placeholder="03-0000-0000">
        </div>
        <div class="field">
          <label>メールアドレス</label>
          <input type="email" id="s-email" value="${escapeHtml(i.email || '')}" placeholder="info@example.com">
        </div>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" id="btn-save-settings">保存</button>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">アカウント</h3>
      <div class="text-small">
        ログイン中：<strong>${escapeHtml(currentUser?.email || '')}</strong>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">データ管理</h3>
      <div class="row-flex" style="flex-wrap:wrap;gap:8px;">
        <button class="btn" onclick="exportData()">JSON エクスポート</button>
        <button class="btn" onclick="document.getElementById('import-file').click()">JSON インポート</button>
        <input type="file" id="import-file" accept="application/json" style="display:none;" onchange="importData(this)">
        <button class="btn" onclick="reloadAll()">サーバーから再読み込み</button>
      </div>
      <div class="text-small muted mt-3">データはクラウドに保存されています（Supabase）。バックアップとして JSON エクスポートを推奨します。</div>

      ${legacyData && (legacyData.documents?.length > 0 || legacyData.issuer?.name) ? `
        <div style="border:1px dashed var(--primary);background:var(--primary-soft);border-radius:6px;padding:12px;margin-top:14px;">
          <div class="row-flex">
            <div>
              <strong>旧バージョンのローカルデータが見つかりました</strong>
              <div class="text-small muted">
                帳票 ${legacyData.documents?.length || 0} 件 / 自社情報 ${legacyData.issuer?.name ? '有り' : 'なし'}
              </div>
            </div>
            <div class="spacer"></div>
            <button class="btn btn-sm" onclick="migrateLegacy()">クラウドへ移行</button>
          </div>
        </div>
      ` : ''}
    </div>

    <div class="card">
      <h3 class="card-title">統計</h3>
      <div class="text-small" style="line-height:2;">
        見積書: ${db.documents.filter((d) => d.type === 'estimate').length} 件<br>
        請求書: ${db.documents.filter((d) => d.type === 'invoice').length} 件
      </div>
    </div>
  `;

  $('#btn-save-settings').onclick = async () => {
    const name = $('#s-name').value.trim();
    const address = $('#s-address').value.trim();
    if (!name || !address) { toast('会社名と住所は必須です', 'error'); return; }
    const issuer = {
      name,
      address,
      phone: $('#s-phone').value.trim(),
      email: $('#s-email').value.trim(),
    };
    $('#btn-save-settings').disabled = true;
    try {
      await saveIssuerRemote(issuer);
      toast('保存しました');
    } catch (err) {
      toast('保存に失敗しました: ' + (err.message || err), 'error');
    } finally {
      $('#btn-save-settings').disabled = false;
    }
  };
}

window.exportData = () => {
  const data = JSON.stringify(db, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `invoice-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

window.importData = (input) => {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    if (!await confirmModal('現在のクラウドデータに上書きインポートします。続行しますか？')) {
      input.value = ''; return;
    }
    try {
      const parsed = JSON.parse(e.target.result);
      if (parsed.issuer) await saveIssuerRemote(parsed.issuer);
      if (Array.isArray(parsed.documents)) {
        for (const doc of parsed.documents) {
          await upsertDoc(doc);
        }
      }
      toast('インポートしました');
      router();
    } catch (err) {
      toast('インポートに失敗しました: ' + (err.message || err), 'error');
    }
  };
  reader.readAsText(file);
};

window.migrateLegacy = async () => {
  if (!await confirmModal('ローカルデータをクラウドにアップロードします。続行しますか？')) return;
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    const parsed = JSON.parse(raw);
    if (parsed.issuer && parsed.issuer.name) {
      await saveIssuerRemote(parsed.issuer);
    }
    if (Array.isArray(parsed.documents)) {
      for (const doc of parsed.documents) {
        await upsertDoc(doc);
      }
    }
    toast('クラウドへ移行しました（ローカルデータも保持）');
    router();
  } catch (err) {
    toast('移行に失敗しました: ' + (err.message || err), 'error');
  }
};

// ============================================================
// Auth lifecycle
// ============================================================
async function onLoggedIn() {
  const { data: { session } } = await sb.auth.getSession();
  currentUser = session?.user || null;
  if (!currentUser) {
    renderAuthScreen();
    return;
  }
  renderLoading('データを読み込み中...');
  try {
    await loadDB();
  } catch (err) {
    console.error(err);
    $('#view').innerHTML = `
      <div class="empty">
        <div class="empty-title">データ読み込みに失敗しました</div>
        ${escapeHtml(err.message || String(err))}<br><br>
        <button class="btn" onclick="location.reload()">再読み込み</button>
      </div>
    `;
    return;
  }
  showApp();
}

function showApp() {
  $('#topbar').hidden = false;
  $('#topnav-user').textContent = currentUser?.email || '';
  $('#btn-logout').onclick = async () => {
    await sb.auth.signOut();
    currentUser = null;
    db = { documents: [], issuer: { name: '', address: '', phone: '', email: '' } };
    $('#topbar').hidden = true;
    location.hash = '';
    renderAuthScreen();
  };
  if (!location.hash) location.hash = '#/dashboard';
  router();
}

// ============================================================
// Init
// ============================================================
async function init() {
  // Topbar nav links
  $$('.topnav a').forEach((el) => {
    el.onclick = (e) => {
      if (el.dataset.route) {
        e.preventDefault();
        navigate(el.dataset.route);
      }
    };
  });

  // 1. Config check
  if (!isConfigured()) {
    renderSetupScreen();
    return;
  }

  // 2. Initialize Supabase client
  if (!window.supabase || !window.supabase.createClient) {
    $('#view').innerHTML = '<div class="empty">Supabase ライブラリが読み込めませんでした。ネットワークを確認してください。</div>';
    return;
  }
  sb = window.supabase.createClient(
    window.APP_CONFIG.SUPABASE_URL,
    window.APP_CONFIG.SUPABASE_ANON_KEY
  );

  // Listen for auth state changes
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      currentUser = null;
      $('#topbar').hidden = true;
      renderAuthScreen();
    }
  });

  // 3. Check existing session
  renderLoading();
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    currentUser = session.user;
    await onLoggedIn();
  } else {
    renderAuthScreen();
  }
}

document.addEventListener('DOMContentLoaded', init);

window.navigate = navigate;
window.router = router;
