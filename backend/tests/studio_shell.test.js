// The Studio workspace (frontend/assets/js/studio-shell.js) lays the SAME cards out as steps: every card it names must exist, every card of the page must be in a step,
// every tab its viewer lists must exist, and the files the page loads must be there.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Running Studio Shell Tests ---');
const FRONT = path.join(__dirname, '..', '..', 'frontend');
const html = fs.readFileSync(path.join(FRONT, 'studio.html'), 'utf8');
const shell = fs.readFileSync(path.join(FRONT, 'assets', 'js', 'studio-shell.js'), 'utf8');
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

{
  // every selector in the step map is a card that exists
  const cfg = shell.slice(shell.indexOf('var CFG'), shell.indexOf('var state ='));
  const sel = [...cfg.matchAll(/'#([\w-]+)'/g)].map((m) => m[1]);
  assert(sel.length >= 25, `the step map names ${sel.length} cards`);
  const missing = sel.filter((s) => !ids.has(s));
  assert.deepStrictEqual(missing, [], `cards named in the steps but not in the page: ${missing.join(', ')}`);
  // …and once only: a card in two steps would be moved from the first
  const dup = sel.filter((s, i) => sel.indexOf(s) !== i);
  assert.deepStrictEqual(dup, [], `a card in two steps: ${dup.join(', ')}`);
  console.log(`✓ the step map: ${sel.length} cards, every one is in the page, none twice`);
}
{
  // every card of the weft and warp pages is in a step
  const cfg = shell.slice(shell.indexOf('var CFG'), shell.indexOf('var state ='));
  const named = new Set([...cfg.matchAll(/'#([\w-]+)'/g)].map((m) => m[1]));
  named.add('ws-view');        // the cloth card is the right-hand dock of the weft workspace (not in a step)
  for (const [root, from, to] of [['st-weft', 'id="st-weft"', 'id="st-warp"'], ['st-warp', 'id="st-warp"', '<script']]) {
    const part = html.slice(html.indexOf(from), html.indexOf(to, html.indexOf(from) + 10));
    const cards = [...part.matchAll(/<div class="st-card[^"]*"(?: id="([^"]+)")?/g)].map((m) => m[1] || '(no id)');
    const orphan = cards.filter((c) => c === '(no id)' || !named.has(c));
    assert.deepStrictEqual(orphan, [], `${root}: cards in no step: ${orphan.join(', ')}`);
  }
  // the cards that sit above the layout (development sheet, cam sheet, jacquard, colours) are in steps too
  ['sh-card', 'cs-card', 'jq-card', 'cw-card'].forEach((c) => assert(named.has(c), c + ' is in a step'));
  console.log('✓ every card of the weft and warp pages belongs to a step: nothing is left on the page by itself');
}
{
  // the viewer's tabs exist, and each tab of the page is offered by some step
  const tabsHtml = [...html.matchAll(/<button type="button"[^>]*data-tab="([\w]+)"/g)].map((m) => m[1]);
  const panes = new Set([...html.matchAll(/id="pane-([\w]+)"/g)].map((m) => m[1]));
  tabsHtml.forEach((t) => assert(panes.has(t), `tab ${t} has a pane`));
  const lists = [...shell.matchAll(/viewer: \[([^\]]*)\]/g)].map((m) => m[1].split(',').map((x) => x.trim().replace(/'/g, '')));
  const offered = new Set(lists.flat());
  lists.flat().forEach((t) => assert(tabsHtml.includes(t), `the shell offers tab ${t}, which the page does not have`));
  const left = tabsHtml.filter((t) => !offered.has(t));
  assert.deepStrictEqual(left, [], `tabs no step offers: ${left.join(', ')}`);
  assert(lists.every((l) => l[0] === '3d'), 'the cloth is the first tab of every step');
  console.log(`✓ the viewer: ${tabsHtml.length} tabs, each offered by a step, each with its pane, the cloth first everywhere`);
}
{
  // what the page loads is there; the old Simple / Expert script is gone
  for (const m of html.matchAll(/(?:src|href)="(assets\/[^"?]+)(?:\?[^"]*)?"/g)) assert(fs.existsSync(path.join(FRONT, m[1])), `${m[1]} is loaded by the page`);
  assert(!/studio-mode\.js/.test(html), 'the Simple / Expert switch is gone');
  assert(/studio-shell\.js/.test(html) && /studio-shell\.css/.test(html));
  // the shell script is the last of the layout scripts: it runs after the cards exist
  assert(html.indexOf('studio-shell.js') > html.indexOf('id="st-warp"'));
  console.log('✓ the page loads the shell and its style, every file it loads exists, the old switch is gone');
}
{
  // the engine modules still find their cards by id: no id the scripts read was lost in the page
  const need = ['st-status', 'st-checks', 'st-gates', 'st-tech', 'st-weft', 'st-warp', 'st-stripe', 'st-template', 'st-gsm', 'wp-bars', 'wp-out', 'wp-status', 'sh-go', 'st-savebar', 'st-pbrbar', 'jq-go', 'cw-builder'];
  need.forEach((i) => assert(ids.has(i), `#${i} is in the page`));
  console.log('✓ the ids the engine scripts read are all still in the page');
}
console.log('Studio shell tests passed');
