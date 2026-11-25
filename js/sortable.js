// ドラッグで順番を並べ替える部品（マウスと指のタッチの両方で動く）。
//
// 行の「つまみ」（handle）を押したまま上下に動かすと、その行が指についてきて、ほかの行がよけて動く。
// つまみ以外を触ったときは何もしないので、スマホでは今まで通り画面をスクロールできる。
// 画面の上下の端に近づくと自動でスクロールする。つまみにフォーカスして ↑↓ キーでも1つずつ動かせる。
//
// 並べ替えの途中は、つかんでいる行そのものは DOM の中で動かさず、まわりの行を入れ替える。
// （つかんでいる行を動かすと、ブラウザによっては指の追跡（pointer capture）が外れてしまうため）

const EDGE = 64; // 画面の端からこの距離に入ったら自動でスクロールする(px)
const MAX_SPEED = 16; // 自動スクロールの1フレームあたりの最大の量(px)
const ANIM = 'transform 160ms ease';

/**
 * @param {HTMLElement} container 行が直接の子として並んでいる要素
 * @param {object} opts
 * @param {string} opts.item 行のセレクタ（container の直接の子だけが対象）
 * @param {string} opts.handle つまみのセレクタ（行の中にある）
 * @param {(from: number, to: number, item: HTMLElement, how: 'drag' | 'key') => void} opts.onMove 順番が変わったとき
 * @param {() => void} [opts.onEnd] ドラッグが終わったとき（順番が変わらなくても呼ぶ）
 * @param {() => {top?: number, bottom?: number}} [opts.insets] 画面の上下でほかの物に隠れている幅（固定ヘッダーなど）
 * @returns {{ isDragging: () => boolean }}
 */
export function sortable(container, { item: itemSel, handle: handleSel, onMove, onEnd = () => {}, insets = () => ({}) }) {
  let st = null; // ドラッグ中の状態

  const rows = () => [...container.children].filter((el) => el.matches(itemSel));
  const sibling = (el, dir) => {
    let s = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
    while (s && !s.matches(itemSel)) s = dir < 0 ? s.previousElementSibling : s.nextElementSibling;
    return s;
  };
  const rowOf = (target) => {
    const hd = target.closest?.(handleSel);
    const row = hd?.closest(itemSel);
    return row && row.parentElement === container ? { hd, row } : null;
  };

  container.addEventListener('pointerdown', (e) => {
    if (st || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const hit = rowOf(e.target);
    if (!hit) return;
    e.preventDefault(); // 文字の選択や、スマホの長押しメニューを出さない
    hit.hd.focus({ preventScroll: true });
    try {
      hit.hd.setPointerCapture(e.pointerId);
    } catch {
      // 指がすでに離れているなど。そのままでもドラッグはできる
    }
    st = {
      row: hit.row,
      hd: hit.hd,
      pointerId: e.pointerId,
      y: e.clientY,
      grab: e.clientY - hit.row.getBoundingClientRect().top,
      dy: 0,
      from: rows().indexOf(hit.row),
      scroller: scrollParent(container),
      raf: 0,
    };
    hit.row.classList.add('is-dragging');
    document.body.classList.add('is-sorting');
    hit.hd.addEventListener('pointermove', onPointerMove);
    hit.hd.addEventListener('pointerup', finish);
    hit.hd.addEventListener('pointercancel', finish);
    hit.hd.addEventListener('lostpointercapture', finish);
    st.raf = requestAnimationFrame(autoScroll);
  });

  // iOS の古い Safari は touch-action を無視することがあるので、つまみの上ではスクロールを止める
  container.addEventListener(
    'touchmove',
    (e) => {
      if (st) e.preventDefault();
    },
    { passive: false },
  );

  container.addEventListener('keydown', (e) => {
    if (st || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const hit = rowOf(e.target);
    if (!hit) return;
    e.preventDefault();
    const list = rows();
    const from = list.indexOf(hit.row);
    const to = from + (e.key === 'ArrowUp' ? -1 : 1);
    if (to >= 0 && to < list.length) onMove(from, to, hit.row, 'key');
  });

  function onPointerMove(e) {
    if (!st || e.pointerId !== st.pointerId) return;
    st.y = e.clientY;
    layout();
  }

  /**
   * 指の位置に行を合わせ、となりの行の真ん中を越えたら入れ替える
   * （上へは行の上の辺、下へは行の下の辺で比べる。高さの違う行同士でも端まで動かせるように）
   */
  function layout() {
    const { row } = st;
    // offsetTop（変形を無視した位置）と画面上の位置の差。スクロールすると変わるので毎回はかる
    const base = row.getBoundingClientRect().top - st.dy - row.offsetTop;
    const list = rows();
    const first = list[0];
    const last = list[list.length - 1];
    const min = first.offsetTop;
    const max = last.offsetTop + last.offsetHeight - row.offsetHeight;
    const top = Math.min(max, Math.max(min, st.y - st.grab - base));
    const bottom = top + row.offsetHeight;
    const mid = (el) => el.offsetTop + el.offsetHeight / 2;
    for (;;) {
      const prev = sibling(row, -1);
      const next = sibling(row, 1);
      if (prev && top < mid(prev)) slide(prev, () => container.insertBefore(prev, row.nextSibling));
      else if (next && bottom > mid(next)) slide(next, () => container.insertBefore(next, row));
      else break;
    }
    st.dy = top - row.offsetTop;
    row.style.transform = `translateY(${st.dy}px)`;
  }

  /** となりの行を入れ替え、元の位置から新しい位置へなめらかに動かす */
  function slide(el, move) {
    const before = el.getBoundingClientRect().top;
    move();
    el.style.transition = 'none';
    el.style.transform = '';
    const after = el.getBoundingClientRect().top;
    el.style.transform = `translateY(${before - after}px)`;
    void el.offsetHeight; // ここで一度位置を確定させてから動かす
    el.style.transition = ANIM;
    el.style.transform = '';
  }

  function autoScroll() {
    if (!st) return;
    const sc = st.scroller;
    const pad = insets();
    const isPage = sc === document.scrollingElement;
    const r = isPage ? { top: 0, bottom: window.innerHeight } : sc.getBoundingClientRect();
    const top = r.top + (pad.top ?? 0);
    const bottom = r.bottom - (pad.bottom ?? 0);
    let v = 0;
    if (st.y < top + EDGE) v = -Math.ceil(MAX_SPEED * Math.min(1, (top + EDGE - st.y) / EDGE));
    else if (st.y > bottom - EDGE) v = Math.ceil(MAX_SPEED * Math.min(1, (st.y - (bottom - EDGE)) / EDGE));
    if (v) {
      const before = sc.scrollTop;
      sc.scrollTop = before + v;
      if (sc.scrollTop !== before) layout();
    }
    st.raf = requestAnimationFrame(autoScroll);
  }

  function finish(e) {
    if (!st || (e && e.pointerId !== st.pointerId)) return;
    const { row, hd, from, raf } = st;
    st = null;
    cancelAnimationFrame(raf);
    hd.removeEventListener('pointermove', onPointerMove);
    hd.removeEventListener('pointerup', finish);
    hd.removeEventListener('pointercancel', finish);
    hd.removeEventListener('lostpointercapture', finish);
    if (hd.hasPointerCapture?.(e?.pointerId)) hd.releasePointerCapture(e.pointerId);
    document.body.classList.remove('is-sorting');
    row.classList.remove('is-dragging');
    // つかんでいた行を、空いた場所へなめらかに収める
    row.style.transition = ANIM;
    row.style.transform = '';
    setTimeout(() => {
      for (const el of rows()) {
        el.style.transition = '';
        el.style.transform = '';
      }
    }, 200);
    const to = rows().indexOf(row);
    if (to !== from && to >= 0) onMove(from, to, row, 'drag');
    onEnd();
  }

  return { isDragging: () => st !== null };
}

/** el を中に入れてスクロールしている要素（なければページ全体） */
function scrollParent(el) {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement || document.documentElement;
}
