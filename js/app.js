// 画面の切り替えと入力チェック。保存は store.js、データ処理は model.js が担当する。
import * as store from './store.js';
import {
  PRESET_SITES,
  NAME_MAX,
  filterCompanies,
  usedSites,
  parseBackup,
  countImport,
  backupFileName,
} from './model.js';

const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('back-btn');
const settingsBtn = document.getElementById('settings-btn');
const addBtn = document.getElementById('add-btn');
const toastEl = document.getElementById('toast');

const listState = { query: '', site: '' };

/* ---------- 小さなDOMヘルパー（文字列は必ず textContent で入れる） ---------- */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function setHeader(title, { back = false, settings = true, add = false } = {}) {
  titleEl.textContent = title;
  document.title = title === '転職先メモ' ? title : `${title} | 転職先メモ`;
  backBtn.hidden = !back;
  settingsBtn.hidden = !settings;
  addBtn.hidden = !add;
}

let toastTimer;
function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 2500);
}

function confirmDialog(message, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    const dlg = h(
      'dialog',
      {},
      h('p', {}, message),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => dlg.close('cancel') }, 'キャンセル'),
        h(
          'button',
          { class: danger ? 'btn btn-primary btn-danger-fill' : 'btn btn-primary', type: 'button', onclick: () => dlg.close('ok') },
          okLabel,
        ),
      ),
    );
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue === 'ok');
      dlg.remove();
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

/* ---------- 一覧 ---------- */
async function renderList() {
  setHeader('転職先メモ', { add: true });
  const all = await store.getAll();
  const sites = usedSites(all);
  if (listState.site && !sites.includes(listState.site)) listState.site = '';

  if (all.length === 0) {
    view.replaceChildren(
      h('div', { class: 'empty' }, h('strong', {}, '行きたい会社を登録しましょう'), '右下の「＋」から登録できます'),
    );
    return;
  }

  const listEl = h('ul', { class: 'list' });
  const countEl = h('p', { class: 'count' });

  const draw = () => {
    const items = filterCompanies(all, listState);
    countEl.textContent = `${items.length}件`;
    if (items.length === 0) {
      listEl.replaceChildren(h('li', { class: 'empty' }, '条件に合う会社はありません'));
      return;
    }
    listEl.replaceChildren(
      ...items.map((c) =>
        h(
          'li',
          {},
          h(
            'button',
            { class: 'card', type: 'button', onclick: () => go(`#/c/${encodeURIComponent(c.id)}`) },
            h('div', { class: 'card-name' }, c.name),
            c.sites.length ? h('div', { class: 'chips' }, c.sites.map((s) => h('span', { class: 'chip' }, s))) : null,
            c.memo ? h('div', { class: 'card-memo' }, c.memo) : null,
          ),
        ),
      ),
    );
  };

  const search = h('input', {
    class: 'search',
    type: 'search',
    placeholder: '会社名・メモで検索',
    'aria-label': '会社名・メモで検索',
    value: listState.query,
    oninput: (e) => {
      listState.query = e.target.value;
      draw();
    },
  });

  const filterBtns = ['', ...sites].map((s) =>
    h(
      'button',
      {
        class: 'filter',
        type: 'button',
        'aria-pressed': String(listState.site === s),
        onclick: () => {
          listState.site = s;
          filterBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(['', ...sites][i] === s)));
          draw();
        },
      },
      s || 'すべて',
    ),
  );

  view.replaceChildren(
    h('div', { class: 'toolbar' }, search, sites.length ? h('div', { class: 'filters' }, filterBtns) : null),
    countEl,
    listEl,
  );
  draw();
}

/* ---------- 詳細 ---------- */
async function renderDetail(id) {
  const c = await store.get(id);
  if (!c) return renderNotFound();
  setHeader(c.name, { back: true });

  const fmt = (iso) => new Date(iso).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });

  view.replaceChildren(
    h(
      'div',
      { class: 'detail' },
      h('h2', {}, c.name),
      h(
        'div',
        {},
        h('div', { class: 'detail-label' }, '利用サイト'),
        c.sites.length ? h('div', { class: 'chips' }, c.sites.map((s) => h('span', { class: 'chip' }, s))) : h('span', { class: 'muted' }, '未登録'),
      ),
      h(
        'div',
        {},
        h('div', { class: 'detail-label' }, '求人URL'),
        c.url
          ? h('a', { class: 'detail-url', href: c.url, target: '_blank', rel: 'noopener noreferrer' }, c.url)
          : h('span', { class: 'muted' }, '未登録'),
      ),
      h(
        'div',
        {},
        h('div', { class: 'detail-label' }, 'メモ'),
        c.memo ? h('div', { class: 'detail-memo' }, c.memo) : h('span', { class: 'muted' }, '未登録'),
      ),
      h('div', { class: 'detail-meta' }, `登録 ${fmt(c.createdAt)}・更新 ${fmt(c.updatedAt)}`),
    ),
    h(
      'div',
      { class: 'actions', style: 'margin-top:14px' },
      h('button', { class: 'btn btn-danger', type: 'button', onclick: () => onDelete(c) }, '削除'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go(`#/c/${encodeURIComponent(c.id)}/edit`) }, '編集'),
    ),
  );
}

async function onDelete(c) {
  if (!(await confirmDialog(`「${c.name}」を削除しますか？元に戻せません。`, '削除する', true))) return;
  try {
    await store.remove(c.id);
    toast('削除しました');
    go('#/');
  } catch (err) {
    toast(`削除できませんでした（${err.message}）`);
  }
}

/* ---------- 登録／編集 ---------- */
async function renderForm(id) {
  let existing = null;
  if (id) {
    existing = await store.get(id);
    if (!existing) return renderNotFound();
  }
  setHeader(existing ? '編集' : '会社を登録', { back: true, settings: false });

  const all = await store.getAll();
  const selected = new Set(existing?.sites ?? []);
  const siteChoices = [...new Set([...PRESET_SITES, ...usedSites(all), ...selected])];

  const nameInput = h('input', {
    id: 'f-name',
    type: 'text',
    autocomplete: 'off',
    maxlength: String(NAME_MAX),
    value: existing?.name ?? '',
    'aria-describedby': 'e-name',
  });
  const urlInput = h('input', {
    id: 'f-url',
    type: 'url',
    inputmode: 'url',
    autocomplete: 'off',
    autocapitalize: 'off',
    placeholder: 'https://',
    value: existing?.url ?? '',
    'aria-describedby': 'e-url',
  });
  const memoInput = h('textarea', { id: 'f-memo', placeholder: '志望動機、面接で聞かれたことなど' });
  memoInput.value = existing?.memo ?? '';
  const nameErr = h('div', { class: 'error', id: 'e-name', role: 'alert' });
  const urlErr = h('div', { class: 'error', id: 'e-url', role: 'alert' });

  const optionsEl = h('div', { class: 'site-options', role: 'group', 'aria-label': '利用サイト' });
  const drawSites = () => {
    optionsEl.replaceChildren(
      ...siteChoices.map((s) =>
        h(
          'button',
          {
            class: 'site-option',
            type: 'button',
            'aria-pressed': String(selected.has(s)),
            onclick: (e) => {
              if (selected.has(s)) selected.delete(s);
              else selected.add(s);
              e.currentTarget.setAttribute('aria-pressed', String(selected.has(s)));
            },
          },
          s,
        ),
      ),
    );
  };
  drawSites();

  const customInput = h('input', { type: 'text', placeholder: 'その他のサイト名', 'aria-label': 'その他のサイト名', autocomplete: 'off' });
  const addCustom = () => {
    const v = customInput.value.trim();
    if (!v) return;
    if (!siteChoices.includes(v)) siteChoices.push(v);
    selected.add(v);
    customInput.value = '';
    drawSites();
  };
  customInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      addCustom();
    }
  });

  const onSubmit = async (e) => {
    e.preventDefault();
    if (customInput.value.trim()) addCustom();
    const input = {
      name: nameInput.value,
      sites: siteChoices.filter((s) => selected.has(s)),
      url: urlInput.value,
      memo: memoInput.value,
    };
    nameErr.textContent = '';
    urlErr.textContent = '';
    nameInput.removeAttribute('aria-invalid');
    urlInput.removeAttribute('aria-invalid');
    try {
      const saved = existing ? await store.update(existing.id, input) : await store.add(input);
      toast(existing ? '保存しました' : '登録しました');
      // 編集画面を履歴に残さず詳細へ
      history.replaceState(null, '', `#/c/${encodeURIComponent(saved.id)}`);
      render();
    } catch (err) {
      if (err instanceof store.ValidationError) {
        if (err.errors.name) {
          nameErr.textContent = err.errors.name;
          nameInput.setAttribute('aria-invalid', 'true');
        }
        if (err.errors.url) {
          urlErr.textContent = err.errors.url;
          urlInput.setAttribute('aria-invalid', 'true');
        }
        (err.errors.name ? nameInput : urlInput).focus();
      } else {
        toast(`保存できませんでした（${err.message}）`);
      }
    }
  };

  view.replaceChildren(
    h(
      'form',
      { class: 'form', novalidate: true, onsubmit: onSubmit },
      h('div', { class: 'field' }, h('label', { for: 'f-name' }, '会社名', h('span', { class: 'req' }, '必須')), nameInput, nameErr),
      h(
        'div',
        { class: 'field' },
        h('span', { class: 'label' }, '利用サイト（複数選べます）'),
        optionsEl,
        h('div', { class: 'site-add' }, customInput, h('button', { class: 'btn btn-small', type: 'button', onclick: addCustom }, '追加')),
      ),
      h('div', { class: 'field' }, h('label', { for: 'f-url' }, '求人URL'), urlInput, urlErr),
      h('div', { class: 'field' }, h('label', { for: 'f-memo' }, 'メモ'), memoInput),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => go(parentHash()) }, 'キャンセル'),
        h('button', { class: 'btn btn-primary', type: 'submit' }, '保存'),
      ),
    ),
  );
  if (!existing) nameInput.focus();
}

/* ---------- 設定（バックアップ） ---------- */
async function renderSettings() {
  setHeader('設定', { back: true, settings: false });
  const all = await store.getAll();

  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    hidden: true,
    onchange: async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) await onImport(file);
    },
  });

  view.replaceChildren(
    h(
      'section',
      { class: 'section' },
      h('h2', {}, 'バックアップを書き出す'),
      h('p', {}, `登録中の${all.length}件をファイルに保存します。ファイルアプリやiCloud Driveに保存しておくと、機種変更のときに戻せます。`),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: onExport }, '書き出す'),
    ),
    h(
      'section',
      { class: 'section' },
      h('h2', {}, 'バックアップを読み込む'),
      h('p', {}, '書き出したファイルから戻します。同じ会社は上書きされ、ない会社は追加されます。'),
      h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, 'ファイルを選ぶ'),
      fileInput,
    ),
    h(
      'section',
      { class: 'section' },
      h('h2', {}, 'データの保存場所について'),
      h('p', {}, 'データはこのスマホの中だけに保存され、外部には送られません。ホーム画面に追加して使い、ときどき書き出しておくのがおすすめです。'),
    ),
  );
}

async function onExport() {
  try {
    const text = await store.exportBackup();
    const name = backupFileName();
    const file = new File([text], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
        // 共有できなければダウンロードにフォールバック
      }
    }
    const url = URL.createObjectURL(file);
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('書き出しました');
  } catch (err) {
    toast(`書き出せませんでした（${err.message}）`);
  }
}

async function onImport(file) {
  let incoming;
  try {
    incoming = parseBackup(await file.text());
  } catch (err) {
    toast(`読み込めませんでした（${err.message}）`);
    return;
  }
  const { added, updated } = countImport(await store.getAll(), incoming);
  const ok = await confirmDialog(`${incoming.length}件を読み込みます（追加${added}件・上書き${updated}件）。よろしいですか？`, '読み込む');
  if (!ok) return;
  try {
    await store.importBackup(await file.text());
    toast(`読み込みました（追加${added}件・上書き${updated}件）`);
    go('#/');
  } catch (err) {
    toast(`読み込めませんでした（${err.message}）`);
  }
}

function renderNotFound() {
  setHeader('見つかりません', { back: true });
  view.replaceChildren(h('div', { class: 'empty' }, h('strong', {}, 'この会社は見つかりませんでした'), '削除された可能性があります'));
}

/* ---------- ルーティング ---------- */
async function render() {
  const path = location.hash.replace(/^#/, '') || '/';
  let m;
  try {
    if (path === '/') await renderList();
    else if (path === '/new') await renderForm(null);
    else if (path === '/settings') await renderSettings();
    else if ((m = path.match(/^\/c\/([^/]+)\/edit$/))) await renderForm(decodeURIComponent(m[1]));
    else if ((m = path.match(/^\/c\/([^/]+)$/))) await renderDetail(decodeURIComponent(m[1]));
    else await renderList();
  } catch (err) {
    console.error(err);
    view.replaceChildren(
      h('div', { class: 'empty' }, h('strong', {}, 'データを読み込めませんでした'), 'プライベートブラウズでは保存できないことがあります。通常モードで開いてください。'),
    );
  }
  window.scrollTo(0, 0);
}

function parentHash() {
  const path = location.hash.replace(/^#/, '') || '/';
  const m = path.match(/^\/c\/([^/]+)\/edit$/);
  return m ? `#/c/${m[1]}` : '#/';
}

backBtn.addEventListener('click', () => go(parentHash()));
settingsBtn.addEventListener('click', () => go('#/settings'));
addBtn.addEventListener('click', () => go('#/new'));
window.addEventListener('hashchange', render);

render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service Worker 登録失敗', err));
}
