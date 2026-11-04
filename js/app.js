// 画面の切り替えと入力チェック。保存・同期は store.js、データ処理は model.js が担当する。
import * as store from './store.js';
import { readLegacyCompanies } from './legacy.js';
import {
  PRESET_SITES,
  NAME_MAX,
  FIELD_TITLE_MAX,
  fieldsOf,
  usedFieldTitles,
  newId,
  TITLE_MAX,
  SESSION_TYPES,
  filterCompanies,
  usedSites,
  sessionsOf,
  sessionLabel,
  formatDate,
  todayString,
  toBackup,
  parseBackup,
  backupFileName,
  pickNewer,
} from './model.js';

const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('back-btn');
const settingsBtn = document.getElementById('settings-btn');
const addBtn = document.getElementById('add-btn');
const toastEl = document.getElementById('toast');

const listState = { query: '', site: '' };
let signedIn = false;
/** データが同期で変わったときに今の画面を更新する関数（入力中のフォームでは null） */
let refreshView = null;
/** 同期の状態が変わったときに表示を更新する関数（設定画面のみ） */
let refreshStatus = null;

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
function toast(message, ms = 2500) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), ms);
}

function confirmDialog(message, okLabel = 'OK', { danger = false, cancelLabel = 'キャンセル' } = {}) {
  return new Promise((resolve) => {
    const dlg = h(
      'dialog',
      {},
      h('p', {}, message),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => dlg.close('cancel') }, cancelLabel),
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

const lsGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* 保存できなくても動作には影響しない */
  }
};

const enc = encodeURIComponent;
const companyHash = (id) => `#/c/${enc(id)}`;
const sessionHash = (cid, sid) => `#/c/${enc(cid)}/s/${enc(sid)}`;

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function chips(items) {
  return h('div', { class: 'chips' }, items.map((s) => h('span', { class: 'chip' }, s)));
}

function field(label, content, { required = false, forId = null } = {}) {
  return h(
    'div',
    { class: 'field' },
    forId
      ? h('label', { for: forId }, label, required ? h('span', { class: 'req' }, '必須') : null)
      : h('span', { class: 'label' }, label),
    content,
  );
}

function showErrors(errors, map) {
  let first = null;
  for (const [key, { input, error }] of Object.entries(map)) {
    error.textContent = errors[key] ?? '';
    if (errors[key]) {
      input.setAttribute('aria-invalid', 'true');
      first ??= input;
    } else {
      input.removeAttribute('aria-invalid');
    }
  }
  first?.focus();
}

/* ---------- ログイン ---------- */
function renderLogin() {
  setHeader('転職先メモ', { settings: false });
  refreshView = null;
  refreshStatus = null;
  const email = h('input', { id: 'l-email', type: 'email', autocomplete: 'username', inputmode: 'email', autocapitalize: 'off' });
  const password = h('input', { id: 'l-password', type: 'password', autocomplete: 'current-password' });
  const error = h('div', { class: 'error', role: 'alert' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'ログイン');

  const onSubmit = async (e) => {
    e.preventDefault();
    error.textContent = '';
    submit.disabled = true;
    submit.textContent = 'ログイン中…';
    try {
      await store.signIn(email.value, password.value);
      // 画面の切り替えは onAuth が行う
    } catch (err) {
      error.textContent = store.authErrorMessage(err);
      submit.disabled = false;
      submit.textContent = 'ログイン';
    }
  };

  const onReset = async () => {
    error.textContent = '';
    if (!email.value.trim()) {
      error.textContent = '先にメールアドレスを入力してください';
      email.focus();
      return;
    }
    try {
      await store.resetPassword(email.value);
      toast('パスワード再設定のメールを送りました', 4000);
    } catch (err) {
      error.textContent = store.authErrorMessage(err);
    }
  };

  view.replaceChildren(
    h(
      'form',
      { class: 'form login', novalidate: true, onsubmit: onSubmit },
      h('p', { class: 'lead' }, 'Firebase に登録したメールアドレスとパスワードでログインしてください。スマホとパソコンで同じデータを見られます。'),
      field('メールアドレス', email, { forId: 'l-email' }),
      field('パスワード', password, { forId: 'l-password' }),
      error,
      submit,
      h('button', { class: 'link-btn', type: 'button', onclick: onReset }, 'パスワードを忘れた場合'),
    ),
  );
}

function renderSetupNeeded() {
  setHeader('転職先メモ', { settings: false });
  view.replaceChildren(
    h(
      'div',
      { class: 'empty' },
      h('strong', {}, 'Firebase の設定がまだです'),
      'js/firebase-config.js に Firebase の設定値を入れてください。',
    ),
  );
}

function renderLoading(message = '読み込み中…') {
  setHeader('転職先メモ', { settings: false });
  view.replaceChildren(h('div', { class: 'empty' }, message));
}

/* ---------- 一覧 ---------- */
function renderList() {
  setHeader('転職先メモ', { add: true });

  const listEl = h('ul', { class: 'list' });
  const countEl = h('p', { class: 'count' });
  const filtersEl = h('div', { class: 'filters' });
  const search = h('input', {
    class: 'search',
    type: 'search',
    placeholder: '会社名・メモで検索',
    'aria-label': '会社名・メモで検索',
    value: listState.query,
    oninput: (e) => {
      listState.query = e.target.value;
      update();
    },
  });
  const toolbar = h('div', { class: 'toolbar' }, search, filtersEl);

  function update() {
    const all = store.getAll();
    if (all.length === 0) {
      view.replaceChildren(
        h('div', { class: 'empty' }, h('strong', {}, '行きたい会社を登録しましょう'), '右下の「＋」から登録できます'),
      );
      return;
    }
    if (!view.contains(toolbar)) view.replaceChildren(toolbar, countEl, listEl);

    const sites = usedSites(all);
    if (listState.site && !sites.includes(listState.site)) listState.site = '';
    filtersEl.hidden = sites.length === 0;
    filtersEl.replaceChildren(
      ...['', ...sites].map((s) =>
        h(
          'button',
          {
            class: 'filter',
            type: 'button',
            'aria-pressed': String(listState.site === s),
            onclick: () => {
              listState.site = s;
              update();
            },
          },
          s || 'すべて',
        ),
      ),
    );

    const items = filterCompanies(all, listState);
    countEl.textContent = `${items.length}件`;
    if (items.length === 0) {
      listEl.replaceChildren(h('li', { class: 'empty' }, '条件に合う会社はありません'));
      return;
    }
    const allSessions = store.getAllSessions();
    listEl.replaceChildren(
      ...items.map((c) => {
        const n = allSessions.filter((s) => s.companyId === c.id).length;
        return h(
          'li',
          {},
          h(
            'button',
            { class: 'card', type: 'button', onclick: () => go(companyHash(c.id)) },
            h('div', { class: 'card-name' }, c.name),
            c.sites.length ? chips(c.sites) : null,
            c.memo ? h('div', { class: 'card-memo' }, c.memo) : null,
            n ? h('div', { class: 'card-meta' }, `面接・セミナー記録 ${n}件`) : null,
          ),
        );
      }),
    );
  }

  update();
  refreshView = update;
}

/* ---------- 会社の詳細 ---------- */
function renderDetail(id) {
  const c = store.get(id);
  if (!c) return renderNotFound('この会社は見つかりませんでした');
  setHeader(c.name, { back: true });

  const fmt = (iso) => new Date(iso).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
  const list = sessionsOf(store.getAllSessions(), c.id);

  view.replaceChildren(
    h(
      'div',
      { class: 'detail' },
      h('h2', {}, c.name),
      h('div', {}, h('div', { class: 'detail-label' }, '利用サイト'), c.sites.length ? chips(c.sites) : h('span', { class: 'muted' }, '未登録')),
      h(
        'div',
        {},
        h('div', { class: 'detail-label' }, '求人URL'),
        c.url
          ? h('a', { class: 'detail-url', href: c.url, target: '_blank', rel: 'noopener noreferrer' }, c.url)
          : h('span', { class: 'muted' }, '未登録'),
      ),
      h('div', {}, h('div', { class: 'detail-label' }, 'メモ'), c.memo ? h('div', { class: 'pre' }, c.memo) : h('span', { class: 'muted' }, '未登録')),
      fieldsOf(c).map((f) =>
        h(
          'div',
          { class: 'custom-field' },
          h('div', { class: 'custom-field-title' }, f.title),
          f.body ? h('div', { class: 'pre' }, f.body) : h('span', { class: 'muted' }, '未記入'),
        ),
      ),
      h('div', { class: 'detail-meta' }, `登録 ${fmt(c.createdAt)}・更新 ${fmt(c.updatedAt)}`),
    ),
    h(
      'div',
      { class: 'actions', style: 'margin-top:14px' },
      h('button', { class: 'btn btn-danger', type: 'button', onclick: () => onDelete(c) }, '削除'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go(`${companyHash(c.id)}/edit`) }, '編集'),
    ),
    h(
      'section',
      { class: 'sessions' },
      h(
        'div',
        { class: 'section-head' },
        h('h3', {}, '面接・セミナー記録'),
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => go(`${companyHash(c.id)}/s/new`) }, '＋ 記録を追加'),
      ),
      list.length
        ? h(
            'ul',
            { class: 'list' },
            list.map((s) =>
              h(
                'li',
                {},
                h(
                  'button',
                  { class: 'card', type: 'button', onclick: () => go(sessionHash(c.id, s.id)) },
                  h('div', { class: 'card-meta' }, [formatDate(s.date) || '日付なし', h('span', { class: 'chip chip-sub' }, s.type)]),
                  h('div', { class: 'card-name' }, sessionLabel(s)),
                  h('div', { class: 'card-memo' }, `聞かれたこと ${s.asked.length}件・自分の質問 ${s.myQuestions.length}件`),
                ),
              ),
            ),
          )
        : h('p', { class: 'muted small' }, '面接やセミナーで聞かれたこと、自分がした質問を記録できます'),
    ),
  );
}

async function onDelete(c) {
  const n = store.sessionsFor(c.id).length;
  const extra = n ? `面接・セミナー記録${n}件も一緒に削除されます。` : '';
  if (!(await confirmDialog(`「${c.name}」を削除しますか？${extra}元に戻せません。`, '削除する', { danger: true }))) return;
  store.remove(c.id);
  toast('削除しました');
  go('#/');
}

/* ---------- 会社の登録／編集 ---------- */
function renderForm(id) {
  let existing = null;
  if (id) {
    existing = store.get(id);
    if (!existing) return renderNotFound('この会社は見つかりませんでした');
  }
  setHeader(existing ? '編集' : '会社を登録', { back: true, settings: false });
  refreshView = null;

  const selected = new Set(existing?.sites ?? []);
  const siteChoices = [...new Set([...PRESET_SITES, ...usedSites(store.getAll()), ...selected])];

  const nameInput = h('input', { id: 'f-name', type: 'text', autocomplete: 'off', maxlength: String(NAME_MAX), value: existing?.name ?? '' });
  const urlInput = h('input', {
    id: 'f-url',
    type: 'url',
    inputmode: 'url',
    autocomplete: 'off',
    autocapitalize: 'off',
    placeholder: 'https://',
    value: existing?.url ?? '',
  });
  const memoInput = h('textarea', { id: 'f-memo', placeholder: '志望動機、気になる点など' });
  memoInput.value = existing?.memo ?? '';
  const nameErr = h('div', { class: 'error', role: 'alert' });
  const urlErr = h('div', { class: 'error', role: 'alert' });
  const fields = fieldsEditor(fieldsOf(existing), usedFieldTitles(store.getAll()));

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

  const onSubmit = (e) => {
    e.preventDefault();
    if (customInput.value.trim()) addCustom();
    const input = {
      name: nameInput.value,
      sites: siteChoices.filter((s) => selected.has(s)),
      url: urlInput.value,
      memo: memoInput.value,
      fields: fields.value(),
    };
    try {
      const saved = existing ? store.update(existing.id, input) : store.add(input);
      toast(existing ? '保存しました' : '登録しました');
      history.replaceState(null, '', companyHash(saved.id));
      render();
    } catch (err) {
      if (err instanceof store.ValidationError) {
        showErrors(err.errors, {
          name: { input: nameInput, error: nameErr },
          url: { input: urlInput, error: urlErr },
          ...fields.errorTargets(),
        });
      } else {
        toast(err.message);
      }
    }
  };

  view.replaceChildren(
    h(
      'form',
      { class: 'form', novalidate: true, onsubmit: onSubmit },
      field('会社名', [nameInput, nameErr], { required: true, forId: 'f-name' }),
      field('利用サイト（複数選べます）', [
        optionsEl,
        h('div', { class: 'site-add' }, customInput, h('button', { class: 'btn btn-small', type: 'button', onclick: addCustom }, '追加')),
      ]),
      field('求人URL', [urlInput, urlErr], { forId: 'f-url' }),
      field('メモ', memoInput, { forId: 'f-memo' }),
      h('div', { class: 'field' }, h('span', { class: 'label' }, '自分で作る項目'), fields.el),
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

/** はじめて使うときに出す項目名の候補 */
const FIELD_SUGGESTIONS = ['逆質問', '志望動機', '自己PR', '面接で言うこと'];

/** 項目名と内容の組（逆質問・志望動機など）を自由に追加・削除・並べ替えできる部品 */
function fieldsEditor(initial, usedTitles) {
  const rowsEl = h('div', { class: 'qa-rows' });
  const suggestEl = h('div', { class: 'field-suggest' });
  const rows = [];

  const redraw = () => {
    rowsEl.replaceChildren(...rows.map((r) => r.row));
    rows.forEach((r, i) => {
      r.up.disabled = i === 0;
      r.down.disabled = i === rows.length - 1;
    });
    drawSuggestions();
  };
  const move = (entry, d) => {
    const i = rows.indexOf(entry);
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    redraw();
    // 押したボタンにフォーカスを残す（端まで来て押せなくなったら反対側のボタンへ）
    const btn = d < 0 ? entry.up : entry.down;
    (btn.disabled ? (d < 0 ? entry.down : entry.up) : btn).focus();
  };
  const addRow = (f = {}, focus = null) => {
    const title = h('input', {
      type: 'text',
      class: 'field-title-input',
      maxlength: String(FIELD_TITLE_MAX),
      placeholder: '項目名（例：逆質問）',
      'aria-label': '項目名',
      autocomplete: 'off',
      value: f.title ?? '',
      oninput: () => drawSuggestions(),
    });
    const body = h('textarea', { class: 'field-body-input', rows: '4', placeholder: '内容', 'aria-label': '内容' });
    body.value = f.body ?? '';
    const error = h('div', { class: 'error', role: 'alert' });
    const up = h('button', { class: 'icon-mini', type: 'button', 'aria-label': '上へ', title: '上へ', onclick: () => move(entry, -1) }, '↑');
    const down = h('button', { class: 'icon-mini', type: 'button', 'aria-label': '下へ', title: '下へ', onclick: () => move(entry, 1) }, '↓');
    const del = h(
      'button',
      {
        class: 'link-btn danger',
        type: 'button',
        onclick: () => {
          rows.splice(rows.indexOf(entry), 1);
          redraw();
        },
      },
      'この項目を消す',
    );
    const row = h(
      'div',
      { class: 'qa-row custom-field-row' },
      h('div', { class: 'qa-row-head' }, h('div', { class: 'row-move' }, up, down), del),
      title,
      error,
      body,
    );
    const entry = { id: f.id || newId(), row, title, body, error, up, down };
    rows.push(entry);
    redraw();
    if (focus === 'title') title.focus();
    if (focus === 'body') body.focus();
  };
  function drawSuggestions() {
    const have = new Set(rows.map((r) => r.title.value.trim()));
    const titles = [...new Set([...usedTitles, ...FIELD_SUGGESTIONS])].filter((t) => !have.has(t)).slice(0, 8);
    suggestEl.replaceChildren(
      ...(titles.length ? [h('span', { class: 'muted small' }, '候補：')] : []),
      ...titles.map((t) => h('button', { class: 'site-option', type: 'button', onclick: () => addRow({ title: t }, 'body') }, `＋ ${t}`)),
    );
  }

  initial.forEach((f) => addRow(f));
  redraw();
  const el = h(
    'div',
    {},
    rowsEl,
    h('button', { class: 'btn btn-small btn-add', type: 'button', onclick: () => addRow({}, 'title') }, '＋ 項目を追加'),
    suggestEl,
  );
  return {
    el,
    value: () => rows.map((r) => ({ id: r.id, title: r.title.value, body: r.body.value })),
    errorTargets: () => Object.fromEntries(rows.map((r) => [`field:${r.id}`, { input: r.title, error: r.error }])),
  };
}

/* ---------- 面接・セミナー記録の詳細 ---------- */
function qaList(pairs, aLabel) {
  if (!pairs.length) return h('p', { class: 'muted' }, 'なし');
  return h(
    'ol',
    { class: 'qa-list' },
    pairs.map((p) =>
      h(
        'li',
        {},
        h('div', { class: 'qa-q' }, p.q || '（質問なし）'),
        p.a ? h('div', { class: 'qa-a' }, h('span', { class: 'qa-a-label' }, aLabel), h('div', { class: 'pre' }, p.a)) : null,
      ),
    ),
  );
}

function renderSessionDetail(cid, sid) {
  const c = store.get(cid);
  const s = store.getSession(sid);
  if (!c || !s || s.companyId !== cid) return renderNotFound('この記録は見つかりませんでした');
  setHeader(sessionLabel(s), { back: true });

  view.replaceChildren(
    h(
      'div',
      { class: 'detail' },
      h('div', { class: 'card-meta' }, [formatDate(s.date) || '日付なし', h('span', { class: 'chip chip-sub' }, s.type)]),
      h('h2', {}, sessionLabel(s)),
      h('div', { class: 'muted' }, c.name),
      h('div', {}, h('div', { class: 'detail-label' }, `聞かれたこと（${s.asked.length}件）`), qaList(s.asked, '自分の答え')),
      h('div', {}, h('div', { class: 'detail-label' }, `自分がした質問（${s.myQuestions.length}件）`), qaList(s.myQuestions, '返ってきた答え')),
      h('div', {}, h('div', { class: 'detail-label' }, '感想・反省メモ'), s.memo ? h('div', { class: 'pre' }, s.memo) : h('span', { class: 'muted' }, 'なし')),
    ),
    h(
      'div',
      { class: 'actions', style: 'margin-top:14px' },
      h('button', { class: 'btn btn-danger', type: 'button', onclick: () => onDeleteSession(s) }, '削除'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go(`${sessionHash(cid, sid)}/edit`) }, '編集'),
    ),
  );
}

async function onDeleteSession(s) {
  if (!(await confirmDialog(`「${sessionLabel(s)}」の記録を削除しますか？元に戻せません。`, '削除する', { danger: true }))) return;
  store.removeSession(s.id);
  toast('削除しました');
  go(companyHash(s.companyId));
}

/* ---------- 面接・セミナー記録の登録／編集 ---------- */
/** 質問と答えの組を何件でも入力できる部品 */
function qaEditor(initial, { qLabel, aLabel, addLabel, name }) {
  const rowsEl = h('div', { class: 'qa-rows' });
  const rows = [];
  const renumber = () =>
    rows.forEach((r, i) => {
      r.num.textContent = `${i + 1}`;
    });
  const addRow = (pair = { q: '', a: '' }, focus = false) => {
    const q = h('textarea', { class: 'qa-input-q', rows: '2', placeholder: qLabel, 'aria-label': qLabel });
    const a = h('textarea', { class: 'qa-input-a', rows: '3', placeholder: aLabel, 'aria-label': aLabel });
    q.value = pair.q;
    a.value = pair.a;
    const num = h('span', { class: 'qa-num' });
    const row = h(
      'div',
      { class: 'qa-row', 'data-name': name },
      h(
        'div',
        { class: 'qa-row-head' },
        num,
        h(
          'button',
          {
            class: 'link-btn danger',
            type: 'button',
            onclick: () => {
              rows.splice(rows.indexOf(entry), 1);
              row.remove();
              renumber();
            },
          },
          'この質問を消す',
        ),
      ),
      q,
      a,
    );
    const entry = { row, q, a, num };
    rows.push(entry);
    rowsEl.append(row);
    renumber();
    if (focus) q.focus();
  };
  (initial.length ? initial : [{ q: '', a: '' }]).forEach((p) => addRow(p));
  const el = h('div', {}, rowsEl, h('button', { class: 'btn btn-small btn-add', type: 'button', onclick: () => addRow(undefined, true) }, addLabel));
  return { el, value: () => rows.map((r) => ({ q: r.q.value, a: r.a.value })) };
}

function renderSessionForm(cid, sid) {
  const c = store.get(cid);
  if (!c) return renderNotFound('この会社は見つかりませんでした');
  let existing = null;
  if (sid) {
    existing = store.getSession(sid);
    if (!existing || existing.companyId !== cid) return renderNotFound('この記録は見つかりませんでした');
  }
  setHeader(existing ? '記録を編集' : '記録を追加', { back: true, settings: false });
  refreshView = null;

  let type = existing?.type ?? SESSION_TYPES[0];
  const typeErr = h('div', { class: 'error', role: 'alert' });
  const typeGroup = h('div', { class: 'site-options', role: 'radiogroup', 'aria-label': '種類' });
  const drawTypes = () =>
    typeGroup.replaceChildren(
      ...SESSION_TYPES.map((t) =>
        h(
          'button',
          {
            class: 'site-option',
            type: 'button',
            role: 'radio',
            'aria-checked': String(t === type),
            'aria-pressed': String(t === type),
            onclick: () => {
              type = t;
              drawTypes();
            },
          },
          t,
        ),
      ),
    );
  drawTypes();

  const dateInput = h('input', { id: 's-date', type: 'date', value: existing ? existing.date : todayString() });
  const dateErr = h('div', { class: 'error', role: 'alert' });
  const titleInput = h('input', {
    id: 's-title',
    type: 'text',
    autocomplete: 'off',
    maxlength: String(TITLE_MAX),
    placeholder: '例：一次面接、会社説明会',
    value: existing?.title ?? '',
  });
  const titleErr = h('div', { class: 'error', role: 'alert' });
  const asked = qaEditor(existing?.asked ?? [], {
    qLabel: '聞かれたこと',
    aLabel: '自分の答え',
    addLabel: '＋ 聞かれたことを追加',
    name: 'asked',
  });
  const mine = qaEditor(existing?.myQuestions ?? [], {
    qLabel: '自分がした質問',
    aLabel: '返ってきた答え',
    addLabel: '＋ 自分の質問を追加',
    name: 'mine',
  });
  const memoInput = h('textarea', { id: 's-memo', placeholder: '雰囲気、うまく答えられなかったこと、次に活かしたいことなど' });
  memoInput.value = existing?.memo ?? '';

  const onSubmit = (e) => {
    e.preventDefault();
    const input = {
      type,
      date: dateInput.value,
      title: titleInput.value,
      asked: asked.value(),
      myQuestions: mine.value(),
      memo: memoInput.value,
    };
    try {
      const saved = existing ? store.updateSessionById(existing.id, input) : store.addSession(cid, input);
      toast(existing ? '保存しました' : '記録しました');
      history.replaceState(null, '', sessionHash(cid, saved.id));
      render();
    } catch (err) {
      if (err instanceof store.ValidationError) {
        showErrors(err.errors, {
          type: { input: typeGroup, error: typeErr },
          date: { input: dateInput, error: dateErr },
          title: { input: titleInput, error: titleErr },
        });
      } else {
        toast(err.message);
      }
    }
  };

  view.replaceChildren(
    h('p', { class: 'muted form-company' }, c.name),
    h(
      'form',
      { class: 'form', novalidate: true, onsubmit: onSubmit },
      field('種類', [typeGroup, typeErr]),
      field('日付', [dateInput, dateErr], { forId: 's-date' }),
      field('名前', [titleInput, titleErr], { forId: 's-title' }),
      field('聞かれたこと と 自分の答え', asked.el),
      field('自分がした質問 と 返ってきた答え', mine.el),
      field('感想・反省メモ', memoInput, { forId: 's-memo' }),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => go(parentHash()) }, 'キャンセル'),
        h('button', { class: 'btn btn-primary', type: 'submit' }, '保存'),
      ),
    ),
  );
}

/* ---------- 設定 ---------- */
const STATUS_TEXT = {
  synced: '同期済み',
  pending: '未送信の変更があります。ネットにつながると自動で送信されます',
  offline: 'オフラインです。この端末に保存されたデータを表示しています',
};

function renderSettings() {
  setHeader('設定', { back: true, settings: false });

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
  const statusEl = h('p', { class: 'sync-status' });
  const countEl = h('p', {});
  const update = () => {
    const st = store.syncStatus();
    statusEl.textContent = STATUS_TEXT[st];
    statusEl.dataset.status = st;
    countEl.textContent = `会社${store.getAll().length}件と面接・セミナー記録${store.getAllSessions().length}件をファイルに保存します。機種変更やもしもの時のための控えです。`;
  };
  update();
  refreshView = update;
  refreshStatus = update;

  view.replaceChildren(
    h(
      'section',
      { class: 'section' },
      h('h2', {}, 'アカウントと同期'),
      h('p', {}, `ログイン中：${store.currentEmail()}`),
      statusEl,
      h('p', {}, '同じアカウントでログインすれば、スマホとパソコンで同じデータを見られます。'),
      h('button', { class: 'btn', type: 'button', onclick: onSignOut }, 'ログアウト'),
    ),
    h('section', { class: 'section' }, h('h2', {}, 'バックアップを書き出す'), countEl, h('button', { class: 'btn btn-primary', type: 'button', onclick: onExport }, '書き出す')),
    h(
      'section',
      { class: 'section' },
      h('h2', {}, 'バックアップを読み込む'),
      h('p', {}, '書き出したファイルから戻します。同じ会社・記録は上書きされ、ないものは追加されます。'),
      h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, 'ファイルを選ぶ'),
      fileInput,
    ),
  );
  showLegacySection();
}

/** この端末に同期前のデータが残っていれば、クラウドに移すボタンを出す */
async function showLegacySection() {
  const anchor = view.firstChild;
  const legacy = await readLegacyCompanies().catch(() => []);
  if (!legacy.length || !anchor?.isConnected) return;
  view.insertBefore(
    h(
      'section',
      { class: 'section', 'data-legacy': '' },
      h('h2', {}, 'この端末の以前のデータ'),
      h('p', {}, `同期を入れる前にこの端末だけに保存した会社が${legacy.length}件残っています。クラウドに無いもの・クラウドより新しいものだけを移します。`),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => migrateLegacy({ fromSettings: true }) }, 'クラウドに移す'),
    ),
    anchor.nextSibling,
  );
}

async function onSignOut() {
  const pending = store.syncStatus() === 'pending';
  const msg = pending
    ? 'まだ送信されていない変更があります。いまログアウトすると、その変更は失われる可能性があります。ログアウトしますか？'
    : 'ログアウトしますか？';
  if (!(await confirmDialog(msg, 'ログアウト', { danger: pending }))) return;
  history.replaceState(null, '', '#/');
  await store.signOut();
}

async function onExport() {
  try {
    const text = store.exportBackup();
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
  let preview;
  try {
    preview = store.previewImport(await file.text());
  } catch (err) {
    toast(`読み込めませんでした（${err.message}）`, 4000);
    return;
  }
  const { companies: c, sessions: s } = preview;
  const ok = await confirmDialog(
    `会社${c.added + c.updated}件（追加${c.added}・上書き${c.updated}）と、記録${s.added + s.updated}件（追加${s.added}・上書き${s.updated}）を読み込みます。よろしいですか？`,
    '読み込む',
  );
  if (!ok) return;
  go('#/');
  await saveToCloud(preview.data, '読み込みました');
}

/**
 * まとめて保存し、サーバーに届いたのを確認してから完了を知らせる。
 * 成功したら true、断られたら false。
 */
async function saveToCloud(data, doneMessage) {
  toast(navigator.onLine ? 'クラウドに保存中…' : 'オフラインです。ネットにつながると送信されます', 600000);
  try {
    await store.importData(data);
    toast(doneMessage);
    return true;
  } catch (err) {
    console.error(err);
    toast(store.saveErrorMessage(err), 8000);
    return false;
  }
}

/* ---------- 以前の版（端末内保存）からの移行 ---------- */
// 以前の版は移行に成功したか確かめずに「移行済み」にしていたので、キーを変えてもう一度確認する。
const legacyKey = (uid) => `legacy-migrated-v2:${uid}`;
let migrating = false;

/** ログイン直後に、まだ移していない以前のデータがあれば移すか聞く */
async function maybeMigrateLegacy(user) {
  if (lsGet(legacyKey(user.uid))) return;
  await migrateLegacy({ fromSettings: false });
}

/**
 * 以前のデータのうちクラウドに無い・より新しいものを移す。
 * サーバーへの保存を確認できたときだけ「移行済み」と記録する。
 */
async function migrateLegacy({ fromSettings }) {
  if (migrating) return;
  migrating = true;
  try {
    const legacy = await readLegacyCompanies().catch(() => []);
    if (!legacy.length) {
      const uid = store.currentUid();
      if (!fromSettings && uid) lsSet(legacyKey(uid), 'none');
      return;
    }
    let data;
    try {
      data = parseBackup(JSON.stringify(toBackup(legacy, [])));
    } catch (err) {
      toast(`この端末の以前のデータを読み込めませんでした（${err.message}）`, 5000);
      return;
    }
    if (fromSettings && !navigator.onLine) {
      toast('オフラインです。ネットにつながってから試してください', 4000);
      return;
    }
    // 端末のキャッシュではなく、クラウドの最新の状態と比べる
    try {
      await store.waitForServer();
    } catch {
      return; // 読み込めなかったことはすでに表示している。次に開いたときにまた確かめる
    }
    const uid = store.currentUid();
    if (!uid) return;
    const toMove = pickNewer(store.getAll(), data.companies);
    if (!toMove.length) {
      lsSet(legacyKey(uid), 'done');
      if (fromSettings) toast('以前のデータはすべてクラウドに入っています');
      return;
    }
    const ok = await confirmDialog(
      `この端末に、同期を入れる前のデータが${toMove.length}社分残っています。クラウドに移して、パソコンでも見られるようにしますか？`,
      '移す',
      { cancelLabel: '今はしない' },
    );
    if (!ok || store.currentUid() !== uid) return;
    const saved = await saveToCloud({ companies: toMove, sessions: [] }, `${toMove.length}社をクラウドに移しました`);
    if (saved) lsSet(legacyKey(uid), 'done');
  } finally {
    migrating = false;
  }
}

function renderNotFound(message) {
  setHeader('見つかりません', { back: true });
  view.replaceChildren(h('div', { class: 'empty' }, h('strong', {}, message), '削除された可能性があります'));
}

/* ---------- ルーティング ---------- */
function parentHash() {
  const path = location.hash.replace(/^#/, '') || '/';
  let m;
  if ((m = path.match(/^\/c\/([^/]+)\/s\/([^/]+)\/edit$/))) return `#/c/${m[1]}/s/${m[2]}`;
  if ((m = path.match(/^\/c\/([^/]+)\/(edit|s\/.+)$/))) return `#/c/${m[1]}`;
  return '#/';
}

function render({ keepScroll = false } = {}) {
  if (!signedIn) return;
  const y = window.scrollY;
  refreshView = null;
  refreshStatus = null;
  const path = location.hash.replace(/^#/, '') || '/';
  const dec = decodeURIComponent;
  let m;
  try {
    if (path === '/new') renderForm(null);
    else if (path === '/settings') renderSettings();
    else if ((m = path.match(/^\/c\/([^/]+)\/s\/new$/))) renderSessionForm(dec(m[1]), null);
    else if ((m = path.match(/^\/c\/([^/]+)\/s\/([^/]+)\/edit$/))) renderSessionForm(dec(m[1]), dec(m[2]));
    else if ((m = path.match(/^\/c\/([^/]+)\/s\/([^/]+)$/))) {
      renderSessionDetail(dec(m[1]), dec(m[2]));
      refreshView = () => render({ keepScroll: true });
    } else if ((m = path.match(/^\/c\/([^/]+)\/edit$/))) renderForm(dec(m[1]));
    else if ((m = path.match(/^\/c\/([^/]+)$/))) {
      renderDetail(dec(m[1]));
      refreshView = () => render({ keepScroll: true });
    } else renderList();
  } catch (err) {
    console.error(err);
    view.replaceChildren(h('div', { class: 'empty' }, h('strong', {}, '表示できませんでした'), err.message));
  }
  window.scrollTo(0, keepScroll ? y : 0);
}

backBtn.addEventListener('click', () => go(parentHash()));
settingsBtn.addEventListener('click', () => go('#/settings'));
addBtn.addEventListener('click', () => go('#/new'));
window.addEventListener('hashchange', () => render());

/* ---------- 起動 ---------- */
function start() {
  if (!store.isConfigured()) {
    renderSetupNeeded();
    return;
  }
  renderLoading();
  store.init();
  store.onData(() => refreshView?.());
  store.onStatus(() => refreshStatus?.());
  store.onError((err, kind) => toast(store.saveErrorMessage(err, kind), 6000));
  store.onAuth(async (user) => {
    if (!user) {
      signedIn = false;
      store.stopSync();
      renderLogin();
      return;
    }
    renderLoading('データを読み込み中…');
    await store.startSync(user);
    signedIn = true;
    render();
    maybeMigrateLegacy(user);
  });
}

start();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service Worker 登録失敗', err));
}
