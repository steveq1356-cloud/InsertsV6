/* InsertPress Planner — the start screen: open a file, pick up where you left
 * off, recent jobs (their STLs are kept in IndexedDB), the machine setup card,
 * and the example gallery.
 */
(function () {
  'use strict';
  const IP = window.IP;
  IP.ui = IP.ui || {};
  const MAX_RECENT = 6;

  function ago(t) {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    const d = Math.round(s / 86400);
    return d === 1 ? 'yesterday' : `${d} days ago`;
  }

  function init(ctx) {
    const { $, S, esc, K } = ctx;
    const ls = IP.store.ls, files = IP.store.files;
    const thumbs = new Map();
    const recents = () => ls.get(K.recent, []) || [];

    function card(o) {
      return `<button class="xcard" ${o.attr}>
        <span class="xthumb"${o.thumb ? ` style="background-image:url(${o.thumb})"` : ''}></span>
        <span class="xname">${esc(o.name)}</span><span class="xsub">${esc(o.sub)}</span></button>`;
    }

    function render() {
      const sess = ls.get(K.session, null);
      const res = $('resume');
      res.hidden = !sess || !!(S.part && S.recentId === sess.recentId);
      if (sess && !res.hidden) {
        const rec = recents().find((r) => r.id === sess.recentId);
        $('resume-name').textContent = sess.name;
        $('resume-sub').textContent = `${sess.inserts} insert${sess.inserts === 1 ? '' : 's'} · ${sess.step === 'review' ? 'reviewing' : 'on ' + sess.step} · ${ago(sess.savedAt)}`;
        $('resume-thumb').style.backgroundImage = rec && rec.thumb ? `url(${rec.thumb})` : '';
      }
      if (S.part && S.screen === 'start') {
        res.hidden = false;
        $('resume-name').textContent = S.name;
        $('resume-sub').textContent = 'Open now';
        $('btn-resume').textContent = 'Back to it';
      } else $('btn-resume').textContent = 'Continue';
      const done = ls.get(K.setup, false), s = S.settings;
      $('setup-card-t').textContent = done ? (S.profile || 'Default machine settings') : 'Set up your machine';
      $('setup-card-d').textContent = done
        ? `${s.bedX} × ${s.bedY} mm, ${s.mode === 'xy' ? 'X/Y' : 'Z only'}, ${s.feed === 'tray' ? `tray with ${IP.tray.count(s)} pockets` : 'inserts by hand'}.`
        : 'Two minutes: bed size, fence, iron, float sensor, and the insert tray. Every answer has a sensible default.';
      $('btn-setup-2').textContent = done ? 'Edit setup' : 'Start setup';
      $('setup-card').classList.toggle('todo', !done);
      const rs = recents();
      $('recent-shelf').hidden = !rs.length;
      $('recent').innerHTML = rs.map((r) => card({ attr: `data-recent="${r.id}"`, thumb: r.thumb, name: r.name,
        sub: `${r.inserts} insert${r.inserts === 1 ? '' : 's'} · ${ago(r.savedAt)}` })).join('');
      $('gallery').innerHTML = IP.EXAMPLES.map((ex) => card({ attr: `data-example="${ex.id}"`, thumb: thumbs.get(ex.id), name: ex.name, sub: ex.shows })).join('');
    }

    function drawThumbs() {
      const todo = IP.EXAMPLES.filter((e) => !thumbs.has(e.id));
      if (!todo.length) return;
      const ex = todo[0];
      try { thumbs.set(ex.id, IP.thumb.render(IP.stl.preparePart(ex.make(), {}).positions, 180, 120)); } catch (e) { thumbs.set(ex.id, ''); }
      const el = document.querySelector(`[data-example="${ex.id}"] .xthumb`);
      if (el && thumbs.get(ex.id)) el.style.backgroundImage = `url(${thumbs.get(ex.id)})`;
      setTimeout(drawThumbs, 0);
    }

    /** A new part was loaded: start a recent entry for it. */
    function remember() {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      S.recentId = id;
      let thumb = '';
      try { thumb = IP.thumb.render(S.part.positions, 180, 120); } catch (e) { /* no canvas */ }
      // an example keeps one entry; when the shelf is full, examples go before your own STLs
      const list = recents().filter((r) => r.id !== id && !(S.exampleId && r.example === S.exampleId));
      list.unshift({ id, name: S.name, savedAt: Date.now(), inserts: 0, example: S.exampleId, thumb, job: null });
      while (list.length > MAX_RECENT) {
        let i = list.map((r) => !!r.example).lastIndexOf(true);
        if (i <= 0) i = list.length - 1;
        files.del('stl:' + list.splice(i, 1)[0].id);
      }
      ls.set(K.recent, list);
      if (S.srcBuf) files.put('stl:' + id, S.srcBuf);
    }
    /** The session was saved: keep its recent entry current. */
    function update(rec) {
      const list = recents();
      const r = list.find((x) => x.id === S.recentId);
      if (!r) return;
      Object.assign(r, { name: rec.name, savedAt: rec.savedAt, inserts: rec.inserts, job: rec.job, step: rec.step });
      if (!ls.set(K.recent, list)) { r.thumb = ''; ls.set(K.recent, list); }
    }

    async function openRecent(id, step) {
      const r = recents().find((x) => x.id === id);
      if (!r) { ctx.toast('That job is no longer stored.', true); return; }
      const job = r.job;
      if (r.example) ctx.loadExample(r.example, job, id);
      else {
        const buf = await files.get('stl:' + id);
        if (!buf) { ctx.toast(`The STL for ${r.name} wasn't kept (browser storage is off or full). Open the file again.`, true); return; }
        if (!ctx.loadSTL(buf, r.name, job, id)) return;
      }
      if (job && step && step !== 'part') ctx.goStep(step);
      ctx.toast(`Picked up ${r.name} where you left off.`);
    }

    $('btn-resume').addEventListener('click', () => {
      if (S.part && S.screen === 'start') { ctx.goStep(S.step); return; }
      const sess = ls.get(K.session, null);
      if (sess) openRecent(sess.recentId, sess.step);
    });
    $('btn-resume-x').addEventListener('click', () => { ls.del(K.session); render(); });
    $('btn-setup-2').addEventListener('click', () => ctx.ui.setup.open('bed'));
    $('btn-recent-clear').addEventListener('click', () => {
      for (const r of recents()) files.del('stl:' + r.id);
      ls.set(K.recent, []); ls.del(K.session);
      // the open part keeps a fresh entry, so its session can still be picked up after a reload
      if (S.part) { remember(); ctx.saveSession(); }
      render();
    });
    $('recent').addEventListener('click', (e) => { const b = e.target.closest('[data-recent]'); if (b) openRecent(b.dataset.recent, null); });
    $('gallery').addEventListener('click', (e) => { const b = e.target.closest('[data-example]'); if (b) ctx.loadExample(b.dataset.example); });

    render();
    setTimeout(drawThumbs, 30);
    return { render, remember, update, openRecent };
  }

  IP.ui.start = { init };
})();
