// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// three views: the ranked board, the model that priced it (with the traded evidence and a sandbox
// that re-ranks the board live), and the live-token set the model learned from. A row's detail view
// shows its figures, its price broken into factors, and its farm plan. No network: every byte it
// shows is in data.js. Views and filters read the URL (?view=detail&slug=..., ?cat=..., ?chain=...)
// so any state of the page can be linked and screenshotted.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var main = document.getElementById('board');
  var tabsEl = document.getElementById('tabs');
  if (!DATA || !main) return;

  var params = new URLSearchParams(location.search);
  var state = {
    view: params.get('view') || 'board',
    slug: params.get('slug') || null,
    q: params.get('q') || '',
    cat: params.get('cat') || '',
    chain: params.get('chain') || '',
    watch: params.get('watch') === '1',
    sort: 'rank',
    dir: 1,
  };

  /* ---------- small helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v) {
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(v);
  }
  function pct(v) {
    if (v == null) return '<span class="flat">—</span>';
    var cls = v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }
  function ageText(days) {
    if (days == null) return 'unknown';
    if (days < 90) return days + ' days';
    if (days < 730) return Math.round(days / 30.4) + ' months';
    return (days / 365.25).toFixed(1) + ' yrs';
  }
  function mult(x) { return '×' + Number(x).toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0'); }
  function isWatch(r) { return r.tvl_usd >= DATA.floor_usd; }
  function marketLine() {
    for (var i = 0; i < DATA.categories.length; i++) if (DATA.categories[i].category === 'All categories (market-wide)') return DATA.categories[i];
    return DATA.categories[0];
  }
  function bySlug(slug) {
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) return DATA.rows[i];
    return null;
  }

  /* ---------- masthead ---------- */
  var top = DATA.rows[0];
  document.getElementById('masthead').innerHTML =
    '<div class="eyebrow">Token launch radar · model ' + esc(DATA.model_version) + '</div>' +
    '<h1>Every unissued protocol, <span class="thin">priced.</span></h1>' +
    '<p class="lede">The radar scanned <strong>' + DATA.scanned_size + ' protocols</strong> and ranked the <strong>' +
    DATA.board_size + ' that record no token yet</strong> by what a launch would be worth if each protocol&rsquo;s record stayed as it is. ' +
    'The price is not a guess per name: it is each category&rsquo;s own traded multiple — what the market already pays for a dollar of TVL in protocols like it — ' +
    'adjusted for the protocol&rsquo;s seven-day growth and for how long it has run unissued. The board&rsquo;s top name today is <strong>' +
    esc(top.name) + '</strong> at <strong>' + money(top.implied_value_usd) + '</strong> implied. Every row carries the steps to farm it.</p>' +
    '<div class="stats">' +
    '<div class="stat"><b>' + DATA.scanned_size + '</b><span>protocols scanned</span></div>' +
    '<div class="stat"><b>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</b><span>watchlist covered</span></div>' +
    '<div class="stat"><b>' + DATA.board_size + '</b><span>pre-token ranked</span></div>' +
    '<div class="stat"><b>' + DATA.early_size + '</b><span>found below the floor</span></div>' +
    '<div class="stat"><b>' + DATA.live_size + '</b><span>traded, set as evidence</span></div>' +
    '</div>' +
    '<p class="source">Snapshot: ' + esc(DATA.source) + ' · as of ' + esc(DATA.as_of) + ' · watchlist floor ' + money(DATA.floor_usd) + ' TVL · values are the model&rsquo;s claim, not a prediction that a token will be issued.</p>';

  document.getElementById('colophon').innerHTML =
    '<div class="rule">Token Radar · model ' + esc(DATA.model_version) + '. Implied value = TVL × category multiple × growth multiplier × maturity multiplier. ' +
    'The category multiple is the median market-cap/TVL of the category&rsquo;s traded protocols in this same snapshot, pulled toward the market-wide median when the category is thin. ' +
    'A protocol is listed as pre-token when its record names no token; a record is not proof, and a launch is never promised. Farm plans are starting points, not advice.</div>';

  /* ---------- tabs ---------- */
  var VIEWS = [['board', 'The board'], ['model', 'The model'], ['live', 'Live tokens']];
  function renderTabs() {
    tabsEl.innerHTML = VIEWS.map(function (v) {
      var sel = state.view === v[0] || (state.view === 'detail' && v[0] === 'board');
      return '<button data-view="' + v[0] + '" aria-selected="' + sel + '">' + v[1] + '</button>';
    }).join('');
    Array.prototype.forEach.call(tabsEl.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { state.view = b.getAttribute('data-view'); state.slug = null; render(); });
    });
  }

  /* ---------- board view ---------- */
  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = 1; });
    return Object.keys(seen).sort();
  }
  function chains() {
    var seen = {};
    DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { seen[c] = (seen[c] || 0) + 1; }); });
    return Object.keys(seen).sort(function (a, b) { return seen[b] - seen[a]; });
  }
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watch && !isWatch(r)) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function sorted(rows) {
    var k = state.sort, d = state.dir;
    var val = {
      rank: function (r) { return r.rank; },
      name: function (r) { return r.name.toLowerCase(); },
      tvl: function (r) { return r.tvl_usd; },
      change: function (r) { return r.change_7d == null ? -1e9 : r.change_7d; },
      age: function (r) { return r.age_days == null ? -1 : r.age_days; },
      multiple: function (r) { return r.category_multiple; },
      implied: function (r) { return r.implied_value_usd; },
    }[k];
    return rows.slice().sort(function (a, b) {
      var x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * d;
    });
  }
  function th(key, label, cls) {
    var dir = state.sort === key ? ' <span class="dir">' + (state.dir === 1 ? '▲' : '▼') + '</span>' : '';
    return '<th class="sortable ' + (cls || '') + '" data-sort="' + key + '">' + label + dir + '</th>';
  }
  function boardView() {
    var rows = sorted(filtered());
    var html = '<section class="view"><h2>The board</h2>' +
      '<p class="note">Ranked by implied value under model ' + esc(DATA.model_version) + '. <b>Watchlist</b> marks the house&rsquo;s floor list — all ' +
      DATA.watchlist_size + ' are here — and <b>early</b> the pre-token protocols found below it, down to $5M of TVL. ' +
      'The band is the category&rsquo;s own spread, its price struck at the 25th and 75th percentile multiples. Click a row for its price breakdown and farm plan.</p>' +
      '<div class="controls">' +
      '<input type="search" id="q" placeholder="Search name or slug…" value="' + esc(state.q) + '">' +
      '<select id="cat"><option value="">All categories</option>' + categories().map(function (c) {
        return '<option' + (state.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>';
      }).join('') + '</select>' +
      '<select id="chain"><option value="">All chains</option>' + chains().map(function (c) {
        return '<option' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
      }).join('') + '</select>' +
      '<label class="check"><input type="checkbox" id="watch"' + (state.watch ? ' checked' : '') + '> Watchlist only</label>' +
      '<span class="count">' + rows.length + ' of ' + DATA.board_size + ' rows</span></div>' +
      '<table class="board"><thead><tr>' +
      th('rank', '#') + th('name', 'Protocol', 'name') + th('tvl', 'TVL') + th('change', '7d') + th('age', 'Unissued for') +
      th('multiple', 'Category ×') + th('implied', 'Implied value') + '<th class="band">Band (p25–p75)</th>' +
      '</tr></thead><tbody>';
    html += rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"><td class="num">' + r.rank + '</td>' +
        '<td class="name"><span class="pname">' + esc(r.name) + '</span>' +
        (isWatch(r) ? '<span class="badge">WATCHLIST</span>' : '<span class="badge early">EARLY</span>') +
        '<span class="pcat">' + esc(r.category || 'Uncategorised') + ' · <span class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</span></span></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td><td class="num">' + mult(r.category_multiple) + '</td>' +
        '<td class="val">' + money(r.implied_value_usd) + '</td>' +
        '<td class="band">' + money(r.value_low_usd) + ' – ' + money(r.value_high_usd) + '</td></tr>';
    }).join('');
    html += '</tbody></table></section>';
    main.innerHTML = html;
    main.setAttribute('aria-busy', 'false');
    document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; refreshTable(); });
    document.getElementById('cat').addEventListener('change', function (e) { state.cat = e.target.value; refreshTable(); });
    document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; refreshTable(); });
    document.getElementById('watch').addEventListener('change', function (e) { state.watch = e.target.checked; refreshTable(); });
    bindTable();
  }
  function refreshTable() {
    var keep = document.activeElement && document.activeElement.id;
    boardView();
    if (keep) { var el = document.getElementById(keep); if (el) { el.focus(); if (el.setSelectionRange) el.setSelectionRange(el.value.length, el.value.length); } }
  }
  function bindTable() {
    Array.prototype.forEach.call(main.querySelectorAll('th.sortable'), function (h) {
      h.addEventListener('click', function () {
        var k = h.getAttribute('data-sort');
        if (state.sort === k) state.dir = -state.dir;
        else { state.sort = k; state.dir = k === 'name' ? 1 : -1; if (k === 'rank') state.dir = 1; }
        refreshTable();
      });
    });
    Array.prototype.forEach.call(main.querySelectorAll('tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () { state.view = 'detail'; state.slug = tr.getAttribute('data-slug'); render(); });
    });
  }

  /* ---------- detail view ---------- */
  function splitStep(s) {
    var m = /^(.*) Cost: (.*)\. Time: (.*)\.$/.exec(s);
    if (!m) return { text: s, meta: '' };
    return { text: m[1], meta: 'Cost: ' + m[2] + ' · Time: ' + m[3] };
  }
  function detailView() {
    var r = bySlug(state.slug) || DATA.rows[0];
    var stat = null;
    DATA.categories.forEach(function (c) { if (c.category === (r.category || '(uncategorised)')) stat = c; });
    var base = r.tvl_usd * r.category_multiple;
    var html = '<section class="view"><button class="back" id="back">← Back to the board</button>' +
      '<div class="detail-head"><h2>' + esc(r.name) + '</h2><span class="rank">rank #' + r.rank + ' of ' + DATA.board_size + '</span>' +
      (isWatch(r) ? '<span class="badge">WATCHLIST</span>' : '<span class="badge early">EARLY · BELOW THE FLOOR</span>') + '</div>' +
      '<p class="note">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ') || 'no chains recorded') +
      ' · tracked by DefiLlama since ' + esc(r.listed_at || 'an unrecorded date') + '.</p>' +
      '<dl class="kv">' +
      '<div><dt>Implied value</dt><dd>' + money(r.implied_value_usd) + '</dd></div>' +
      '<div><dt>Value band</dt><dd>' + money(r.value_low_usd) + ' <small>to</small> ' + money(r.value_high_usd) + '</dd></div>' +
      '<div><dt>TVL</dt><dd>' + money(r.tvl_usd) + '</dd></div>' +
      '<div><dt>7-day change</dt><dd>' + (r.change_7d == null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</dd></div>' +
      '<div><dt>Unissued for</dt><dd>' + ageText(r.age_days) + '</dd></div>' +
      '<div><dt>Category multiple</dt><dd>' + mult(r.category_multiple) + ' <small>of TVL</small></dd></div>' +
      '</dl>' +
      '<h3>How the price is struck</h3><div class="formula">' +
      money(r.tvl_usd) + ' TVL × ' + mult(r.category_multiple) + ' <span class="why">(the ' + esc(r.category || 'market') + ' multiple: the median of its ' +
      (stat ? stat.live_n : 0) + ' traded peer' + (stat && stat.live_n === 1 ? '' : 's') + ' in this snapshot, pulled toward the market median)</span> = ' + money(base) + '<br>' +
      '× ' + r.growth_multiplier.toFixed(2) + ' <span class="why">(growth: its TVL moved ' + (r.change_7d == null ? 'an unrecorded amount' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + ' in seven days, clamped and weighted at ' + DATA.model.growth_weight + ')</span><br>' +
      '× ' + r.maturity_multiplier.toFixed(2) + ' <span class="why">(maturity: ' + ageText(r.age_days) + ' with no token, on a three-year ramp)</span><br>' +
      '= <span class="res">' + money(r.implied_value_usd) + '</span> <span class="why">implied launch value, inside a ' + money(r.value_low_usd) + ' – ' + money(r.value_high_usd) + ' band struck at the category&rsquo;s own quartiles.</span></div>' +
      '<h3>Farm plan</h3><ol class="steps">' +
      r.farm_steps.map(function (s) { var p = splitStep(s); return '<li>' + esc(p.text) + '<span class="meta">' + esc(p.meta) + '</span></li>'; }).join('') +
      '</ol></section>';
    main.innerHTML = html;
    main.setAttribute('aria-busy', 'false');
    document.getElementById('back').addEventListener('click', function () { state.view = 'board'; state.slug = null; render(); });
  }

  /* ---------- model view ---------- */
  function sandboxRows(gw, mf, mr) {
    var M = DATA.model;
    return DATA.rows.map(function (r) {
      var g = Math.min(M.growth_cap, Math.max(M.growth_floor, r.change_7d == null ? 0 : r.change_7d));
      var gm = 1 + (g / 100) * gw;
      var age = r.age_days == null ? M.unknown_age_days : r.age_days;
      var mm = mf + (Math.min(age, M.maturity_days) / M.maturity_days) * mr;
      return { name: r.name, rank: r.rank, val: r.tvl_usd * r.category_multiple * gm * mm };
    }).sort(function (a, b) { return b.val - a.val; }).slice(0, 8);
  }
  function modelView() {
    var M = DATA.model;
    var html = '<section class="view"><h2>The model, stated plainly</h2>' +
      '<p class="note">An implied value here is a claim about <b>what a launch would be worth if the protocol&rsquo;s record stayed as it is</b> — never a claim that a token is coming. ' +
      'It is built from the snapshot&rsquo;s own figures only, in three steps. <b>First, the multiple:</b> for each category, the traded protocols in this same snapshot show what the market pays for a dollar of TVL; ' +
      'the model takes their median, winsorizes the extremes, and pulls each category&rsquo;s line toward the market-wide line by ' + M.shrink_k + ' phantom peers in log space, so a category priced on two names — or on one extreme name — cannot run away with the board. ' +
      '<b>Second, growth:</b> the protocol&rsquo;s seven-day TVL change, clamped to ' + M.growth_floor + '%…+' + M.growth_cap + '%, moves the price by a weight of ' + M.growth_weight + '. ' +
      '<b>Third, maturity:</b> a protocol that has run longer with no token has more unissued value to recognise, on a ramp from ' + M.maturity_floor + ' to ' + (M.maturity_floor + M.maturity_range).toFixed(2) + ' over three years. ' +
      'Traded protocols are never ranked: they are the evidence the multiples are read from, listed under Live tokens.</p>' +
      '<div class="formula">implied value = TVL × category multiple × (1 + clamped 7d change × ' + M.growth_weight + ') × maturity</div>' +
      '<h3>What the market pays per $1 of TVL, by category</h3>' +
      '<p class="note">Read from the traded protocols in this snapshot. The band is each category&rsquo;s own 25th–75th percentile spread, shrunk the same way; a board row&rsquo;s value band is its TVL priced at those two ends.</p>' +
      '<table class="cats"><thead><tr><th>Category</th><th>Traded peers</th><th>Multiple used</th><th>p25</th><th>p75</th></tr></thead><tbody>' +
      DATA.categories.map(function (c) {
        return '<tr><td>' + esc(c.category) + '</td><td>' + c.live_n + '</td><td>' + mult(c.multiple) + '</td><td>' + mult(c.multiple_low) + '</td><td>' + mult(c.multiple_high) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="sandbox"><h3>Try the model</h3><p class="note">Change the two judgement calls — how hard growth should move a price, and how much a long unissued run is worth — and the board re-ranks under your constants. The category multiples stay as measured: they are evidence, not taste.</p>' +
      '<div class="row">' +
      '<label>Growth weight<input id="sb-gw" type="number" step="0.05" min="0" max="1" value="' + M.growth_weight + '"></label>' +
      '<label>Maturity floor<input id="sb-mf" type="number" step="0.05" min="0" max="1" value="' + M.maturity_floor + '"></label>' +
      '<label>Maturity range<input id="sb-mr" type="number" step="0.05" min="0" max="1" value="' + M.maturity_range + '"></label>' +
      '<button id="sb-run">Re-rank the board</button><button id="sb-reset" class="ghost">Model&rsquo;s own</button></div>' +
      '<div class="out" id="sb-out"></div></div></section>';
    main.innerHTML = html;
    main.setAttribute('aria-busy', 'false');
    function run() {
      var gw = parseFloat(document.getElementById('sb-gw').value) || 0;
      var mf = parseFloat(document.getElementById('sb-mf').value) || 0;
      var mr = parseFloat(document.getElementById('sb-mr').value) || 0;
      var rows = sandboxRows(gw, mf, mr);
      document.getElementById('sb-out').innerHTML = 'Top 8 under your constants: ' + rows.map(function (r, i) {
        return '<b>#' + (i + 1) + '</b> ' + esc(r.name) + ' ' + money(r.val) + (r.rank !== i + 1 ? ' <span class="flat">(board #' + r.rank + ')</span>' : '');
      }).join(' · ');
    }
    document.getElementById('sb-run').addEventListener('click', run);
    document.getElementById('sb-reset').addEventListener('click', function () { modelView(); });
    run();
  }

  /* ---------- live view ---------- */
  function liveView() {
    var html = '<section class="view"><h2>Live tokens: the evidence, not the board</h2>' +
      '<p class="note">These protocols already trade, so the radar does not rank them and does not price them: the market has done it. ' +
      'They are here because they are what the model reads — each category&rsquo;s multiple is the median of lines like these — and because a reader should be able to check the radar&rsquo;s prices against the market&rsquo;s own. ' +
      'The full traded set in the snapshot is ' + marketLine().live_n + ' protocols with a recorded market cap; the ' + DATA.live_size + ' largest are shown.</p>' +
      '<table class="board"><thead><tr><th class="name">Protocol</th><th>TVL</th><th>7d</th><th>Market cap</th><th>Market&rsquo;s ×</th></tr></thead><tbody>' +
      DATA.live.map(function (r) {
        return '<tr><td class="name"><span class="pname">' + esc(r.name) + '</span><span class="pcat">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.slice(0, 3).join(', ')) + '</span></td>' +
          '<td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + pct(r.change_7d) + '</td>' +
          '<td class="num">' + money(r.mcap_usd) + '</td><td class="num">' + (r.multiple == null ? '—' : mult(r.multiple)) + '</td></tr>';
      }).join('') + '</tbody></table></section>';
    main.innerHTML = html;
    main.setAttribute('aria-busy', 'false');
  }

  function render() {
    document.body.className = state.view;
    renderTabs();
    if (state.view === 'detail') detailView();
    else if (state.view === 'model') modelView();
    else if (state.view === 'live') liveView();
    else boardView();
    window.scrollTo(0, 0);
  }
  render();
})();
