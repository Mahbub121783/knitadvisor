// KnitAdvisor · API documentation page: the plans and endpoints come from /api/catalogue, so the page can never list something the API does not serve.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var origin = window.location.origin;
  var BODY = '{ "fabric": "single_jersey", "gsm": 160, "composition": "100% Cotton" }';

  var CODE = {
    curl: 'curl -X POST ' + origin + '/api/v1/calculate \\\n  -H "Authorization: Bearer ka_live_YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d \'' + BODY + '\'',
    node: "const res = await fetch('" + origin + "/api/v1/calculate', {\n  method: 'POST',\n  headers: {\n    Authorization: 'Bearer ' + process.env.KNITADVISOR_KEY,\n    'Content-Type': 'application/json',\n  },\n  body: JSON.stringify(" + BODY + "),\n});\nconst data = await res.json();\nif (!res.ok) throw new Error(data.code + ': ' + data.error);\nconsole.log(data.yarn, res.headers.get('X-Quota-Remaining'));",
    py: "import os, requests\n\nr = requests.post(\n    '" + origin + "/api/v1/calculate',\n    headers={'Authorization': 'Bearer ' + os.environ['KNITADVISOR_KEY']},\n    json={'fabric': 'single_jersey', 'gsm': 160, 'composition': '100% Cotton'},\n    timeout=30,\n)\ndata = r.json()\nr.raise_for_status()\nprint(data['yarn'], r.headers.get('X-Quota-Remaining'))",
  };
  function code(l) { $('ad-code').textContent = CODE[l]; Array.prototype.forEach.call($('ad-tabs').children, function (b) { b.classList.toggle('on', b.getAttribute('data-l') === l); }); }
  $('ad-tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-l]'); if (b) code(b.getAttribute('data-l')); });
  code('curl');

  fetch('/api/catalogue', { headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (c) {
    var f = function (n) { return Number(n).toLocaleString('en'); };
    $('ad-plans').innerHTML = '<tr><th>Plan</th><th>Calls a month</th><th>Calls a minute</th></tr>' + Object.keys(c.plans).map(function (k) { var p = c.plans[k]; return '<tr><td><b>' + esc(p.label) + '</b></td><td>' + f(p.monthly_calls) + '</td><td>' + f(p.calls_per_minute) + '</td></tr>'; }).join('') +
      '<tr><td colspan="3" style="color:var(--t3);font-size:12px">A figure agreed for your account can differ from its plan’s; the headers always show the key’s own.</td></tr>';
    var groups = {};
    c.endpoints.forEach(function (e) { (groups[e.group] = groups[e.group] || []).push(e); });
    $('ad-endpoints').innerHTML = Object.keys(groups).map(function (g) {
      return '<h3 style="font-size:14px;margin:16px 0 4px">' + esc(g) + '</h3><div class="ad-scroll"><table class="ad-t">' + groups[g].map(function (e) {
        return '<tr><td style="white-space:nowrap"><span class="ad-m ' + esc(e.method) + '">' + esc(e.method) + '</span></td><td><code>' + esc(e.path) + '</code>' + (e.key_required ? ' <span class="ad-key">key</span>' : '') + '<div>' + esc(e.summary) + '</div></td></tr>';
      }).join('') + '</table></div>';
    }).join('');
  }).catch(function () { $('ad-endpoints').innerHTML = '<p>The endpoint list could not be loaded.</p>'; $('ad-plans').innerHTML = ''; });
})();
