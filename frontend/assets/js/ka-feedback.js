/**
 * "Does this match your floor?" under an answer (the calculator result and the Studio's yarn plan). A verdict, and what
 * the floor actually runs where the person says, goes to /api/feedback: it is what the engines are corrected from.
 *
 *   KAFeedback.show(box, { key, tool, input, shown })   draws it (and keeps what was typed while the answer is the same)
 */
(function () {
  'use strict';
  var CSS = '.kafb{margin:10px 0 0;padding:10px 12px;border:1px solid var(--line,#D9DDE2);border-radius:10px;background:var(--bg2,#fff);font-size:12px;line-height:1.5;color:var(--t2,#43474E)}' +
    '.kafb-q{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.kafb-q b{font-size:12.5px;color:var(--t1,#191C1F)}' +
    '.kafb button{font:600 12px var(--sans,system-ui);border-radius:999px;border:1px solid var(--line,#D9DDE2);background:var(--bg,#fff);color:var(--t1,#191C1F);padding:6px 13px;cursor:pointer;min-height:32px}' +
    '.kafb button.on{border-color:#1857C4;background:rgba(24,87,196,.09);color:#1857C4}.kafb button.send{background:#1857C4;border-color:#1857C4;color:#fff}.kafb button:disabled{opacity:.55;cursor:default}' +
    '.kafb-more{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-top:10px}.kafb-more label{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--t3,#5B616A)}' +
    '.kafb-more input,.kafb-more textarea{font:13px var(--sans,system-ui);padding:7px 9px;border:1px solid var(--line,#D9DDE2);border-radius:8px;background:var(--bg,#fff);color:var(--t1,#191C1F);width:100%;box-sizing:border-box}' +
    '.kafb-more .wide{grid-column:1/-1}.kafb-msg{margin-top:6px;min-height:1em}';
  function style() {
    if (document.getElementById('kafb-css')) return;
    var s = document.createElement('style'); s.id = 'kafb-css'; s.textContent = CSS; document.head.appendChild(s);
  }
  var FIELDS = [['count', 'Yarn count(s) you knit', 'e.g. 30/1 + 16/1'], ['sl', 'Stitch length, mm', 'e.g. 2.85'], ['gauge', 'Gauge (GG)', 'e.g. 24'], ['dia', 'Diameter (inch)', 'e.g. 30'], ['gsm', 'Finished GSM you get', 'e.g. 180']];

  function show(box, ctx) {
    if (!box || !ctx) return;
    if (box.dataset.key === ctx.key) { box._ctx = ctx; return; }
    style();
    box.dataset.key = ctx.key; box._ctx = ctx;
    box.innerHTML = '<div class="kafb"><div class="kafb-q"><b>Does this match what your floor knits?</b>' +
      '<button type="button" data-v="right">Yes</button><button type="button" data-v="close">Close</button><button type="button" data-v="wrong">No</button></div>' +
      '<form class="kafb-more" hidden>' + FIELDS.map(function (f) { return '<label>' + f[1] + '<input name="' + f[0] + '" maxlength="60" placeholder="' + f[2] + '" autocomplete="off"></label>'; }).join('') +
      '<label class="wide">Anything else (optional)<textarea name="note" rows="2" maxlength="1000" placeholder="Machine, buyer’s requirement, what went wrong on the roll…"></textarea></label>' +
      '<div class="wide"><button type="submit" class="send">Send</button></div></form>' +
      '<div class="kafb-msg" aria-live="polite">Your answer and these figures are recorded so the system can be corrected.</div></div>';
    var verdict = null, root = box.firstChild, form = root.querySelector('form'), msg = root.querySelector('.kafb-msg');
    var buttons = [].slice.call(root.querySelectorAll('[data-v]'));
    function send() {
      var c = box._ctx, actual = {};
      FIELDS.forEach(function (f) { var v = form.elements[f[0]].value.trim(); if (v) actual[f[0]] = v; });
      root.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
      msg.textContent = 'Sending…';
      fetch('/api/feedback', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: c.tool, verdict: verdict, input: c.input, shown: c.shown, actual: actual, note: form.elements.note.value }) })
        .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Not sent.'); return d; }); })
        .then(function () { form.hidden = true; msg.textContent = 'Thank you — recorded.'; })
        .catch(function (e) { root.querySelectorAll('button').forEach(function (b) { b.disabled = false; }); msg.textContent = e.message || 'Not sent. Try again.'; });
    }
    buttons.forEach(function (b) {
      b.addEventListener('click', function () {
        verdict = b.getAttribute('data-v');
        buttons.forEach(function (x) { x.classList.toggle('on', x === b); });
        if (verdict === 'right') { form.hidden = true; send(); return; }
        form.hidden = false;
        msg.textContent = verdict === 'wrong' ? 'Tell us what your floor runs, or what is wrong.' : 'What is different? Fill in what you know.';
        form.elements.count.focus();
      });
    });
    form.addEventListener('submit', function (e) { e.preventDefault(); send(); });
  }

  window.KAFeedback = { show: show };
})();
