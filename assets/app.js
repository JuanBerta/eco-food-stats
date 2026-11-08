(() => {
  "use strict";

  const NUTRIENTS = ["carbs", "fat", "protein", "vitamins"];

  // Every sortable column. `range` columns also get a min/max filter.
  const COLUMNS = [
    { key: "name", label: "Food", text: true },
    { key: "category", label: "Category", text: true },
    { key: "calories", label: "Calories", range: true },
    { key: "carbs", label: "Carbs", range: true, dot: "carbs" },
    { key: "fat", label: "Fat", range: true, dot: "fat" },
    { key: "protein", label: "Protein", range: true, dot: "protein" },
    { key: "vitamins", label: "Vitamins", range: true, dot: "vitamins" },
    { key: "nutrientTotal", label: "Nutrients", range: true, title: "Carbs + fat + protein + vitamins" },
    { key: "mix", label: "Mix", sortable: false, title: "Share of each nutrient" },
    { key: "density", label: "Density", range: true, title: "Nutrients per 1,000 calories", digits: 1 },
    { key: "balance", label: "Balance", range: true, title: "Weakest nutrient ÷ strongest nutrient (100 = even)", suffix: "%" },
    { key: "weight", label: "Weight", range: true, title: "Weight in kg", unit: "kg", scale: 0.001, digits: 2 },
    { key: "shelfLifeHours", label: "Shelf life", range: true, title: "Base shelf life in days", unit: "days", scale: 1 / 24, digits: 0 },
    { key: "skillSort", label: "Crafted with", text: true, title: "Lowest skill level among its recipes" },
  ];
  const RANGE_COLS = COLUMNS.filter(c => c.range);

  const $ = sel => document.querySelector(sel);
  const els = {
    q: $("#q"), category: $("#category"), table: $("#table"), skill: $("#skill"),
    maxLevel: $("#maxLevel"), dominant: $("#dominant"), edible: $("#edible"),
    unobtainable: $("#unobtainable"), ranges: $("#ranges"), toggleRanges: $("#toggleRanges"),
    reset: $("#reset"), head: $("#head"), body: $("#body"), count: $("#count"),
    meta: $("#meta"), detail: $("#detail"), detailBody: $("#detail-body"),
    chips: [...document.querySelectorAll(".chip")],
  };

  const state = {
    q: "", category: "", table: "", skill: "", maxLevel: "", source: "",
    dominant: "", edible: false, unobtainable: false,
    sort: "name", dir: "asc", min: {}, max: {}, food: "",
  };

  let foods = [];
  let byId = new Map();
  let byName = new Map();
  let recipes = [];
  let tags = {};

  // ---------- helpers ----------
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const display = (col, v) => {
    if (v == null) return "—";
    const scaled = v * (col.scale || 1);
    const d = col.digits ?? 0;
    const n = Number.isInteger(scaled) && !col.digits ? scaled : Number(scaled.toFixed(d));
    return n.toLocaleString(undefined, { maximumFractionDigits: d }) + (col.suffix || "");
  };
  // Range inputs are typed in display units (kg, days); convert back to raw values.
  const toRaw = (col, v) => v / (col.scale || 1);

  const fmtNum = v => Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });

  function mixBar(f, cls = "mix") {
    const total = f.nutrientTotal || 0;
    if (!total) return `<div class="${cls}" title="No nutrients"></div>`;
    const segs = NUTRIENTS.map(n => f[n] ? `<i class="seg ${n}" style="width:${(f[n] / total * 100).toFixed(1)}%"></i>` : "").join("");
    const title = NUTRIENTS.map(n => `${n[0].toUpperCase() + n.slice(1)} ${fmtNum(f[n])}`).join(" · ");
    return `<div class="${cls}" title="${title}">${segs}</div>`;
  }

  function dominantOf(f) {
    let best = null, bestV = 0;
    for (const n of NUTRIENTS) if (f[n] > bestV) { best = n; bestV = f[n]; }
    return best;
  }

  // ---------- data ----------
  async function load() {
    const res = await fetch("data/foods.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`Could not load data/foods.json (${res.status})`);
    const data = await res.json();
    recipes = data.recipes;
    tags = data.tags || {};
    foods = data.foods.map(f => {
      const made = recipes.filter(r => r.outputs.some(o => o.id === f.id));
      const levels = made.filter(r => r.skill).map(r => r.level);
      const easiest = made.slice().sort((a, b) => (a.level - b.level))[0];
      return {
        ...f,
        made,
        tables: new Set(made.flatMap(r => r.tables)),
        skills: new Set(made.map(r => r.skill).filter(Boolean)),
        minLevel: levels.length ? Math.min(...levels) : 0,
        skillLabel: easiest ? (easiest.skill ? `${easiest.skill} ${easiest.level}` : "No skill") : "",
        skillSort: easiest ? `${easiest.skill || ""} ${String(easiest.level).padStart(2, "0")}` : "~",
        dominant: dominantOf(f),
        haystack: [f.name, f.description, f.category, ...(f.tags || [])].join(" ").toLowerCase(),
      };
    });
    byId = new Map(foods.map(f => [f.id, f]));
    byName = new Map(foods.map(f => [f.name, f]));

    const visible = foods.filter(f => f.obtainable);
    els.meta.textContent = `${visible.length} foods · ${recipes.length} recipes · data from ${data.generated}`;
    fillSelect(els.category, [...new Set(foods.map(f => f.category).filter(Boolean))]);
    fillSelect(els.table, [...new Set(foods.flatMap(f => [...f.tables]))]);
    fillSelect(els.skill, [...new Set(foods.flatMap(f => [...f.skills]))]);
  }

  function fillSelect(sel, values) {
    values.sort((a, b) => a.localeCompare(b));
    for (const v of values) sel.add(new Option(v, v));
  }

  // ---------- URL state ----------
  function readUrl() {
    const p = new URLSearchParams(location.search);
    for (const k of ["q", "category", "table", "skill", "maxLevel", "source", "dominant", "food"]) {
      if (p.has(k)) state[k] = p.get(k);
    }
    state.edible = p.get("edible") === "1";
    state.unobtainable = p.get("all") === "1";
    if (p.has("sort")) state.sort = p.get("sort");
    if (p.has("dir")) state.dir = p.get("dir") === "desc" ? "desc" : "asc";
    for (const c of RANGE_COLS) {
      if (p.has("min_" + c.key)) state.min[c.key] = p.get("min_" + c.key);
      if (p.has("max_" + c.key)) state.max[c.key] = p.get("max_" + c.key);
    }
  }

  function writeUrl() {
    const p = new URLSearchParams();
    for (const k of ["q", "category", "table", "skill", "maxLevel", "source", "dominant", "food"]) {
      if (state[k]) p.set(k, state[k]);
    }
    if (state.edible) p.set("edible", "1");
    if (state.unobtainable) p.set("all", "1");
    if (state.sort !== "name" || state.dir !== "asc") { p.set("sort", state.sort); p.set("dir", state.dir); }
    for (const c of RANGE_COLS) {
      if (state.min[c.key] !== undefined && state.min[c.key] !== "") p.set("min_" + c.key, state.min[c.key]);
      if (state.max[c.key] !== undefined && state.max[c.key] !== "") p.set("max_" + c.key, state.max[c.key]);
    }
    const qs = p.toString();
    history.replaceState(null, "", qs ? "?" + qs : location.pathname);
  }

  function syncControls() {
    els.q.value = state.q;
    els.category.value = state.category;
    els.table.value = state.table;
    els.skill.value = state.skill;
    els.maxLevel.value = state.maxLevel;
    els.dominant.value = state.dominant;
    els.edible.checked = state.edible;
    els.unobtainable.checked = state.unobtainable;
    els.chips.forEach(c => c.setAttribute("aria-pressed", String(c.dataset.source === state.source)));
    for (const input of els.ranges.querySelectorAll("input")) {
      const bag = input.dataset.bound === "min" ? state.min : state.max;
      input.value = bag[input.dataset.key] ?? "";
    }
  }

  // ---------- filters ----------
  function buildRanges() {
    els.ranges.innerHTML = RANGE_COLS.map(c => {
      const vals = foods.filter(f => f.obtainable).map(f => f[c.key]).filter(v => v != null);
      const lo = display(c, Math.min(...vals)), hi = display(c, Math.max(...vals));
      const unit = c.unit ? ` (${c.unit})` : "";
      return `<div class="range">
        <span>${esc(c.label)}${unit} <span class="hint">· ${lo}–${hi}</span></span>
        <div class="pair">
          <input type="number" step="any" inputmode="decimal" placeholder="min" aria-label="Minimum ${esc(c.label)}" data-key="${c.key}" data-bound="min">
          <span>–</span>
          <input type="number" step="any" inputmode="decimal" placeholder="max" aria-label="Maximum ${esc(c.label)}" data-key="${c.key}" data-bound="max">
        </div>
      </div>`;
    }).join("");
  }

  function activeRangeCount() {
    return RANGE_COLS.filter(c => (state.min[c.key] ?? "") !== "" || (state.max[c.key] ?? "") !== "").length;
  }

  function filtered() {
    const q = state.q.trim().toLowerCase();
    const maxLevel = state.maxLevel === "" ? null : Number(state.maxLevel);
    const recipeFilter = state.table || state.skill || maxLevel !== null;

    return foods.filter(f => {
      if (!state.unobtainable && !f.obtainable) return false;
      if (q && !f.haystack.includes(q)) return false;
      if (state.category && f.category !== state.category) return false;
      if (state.source === "craftable" && !f.craftable) return false;
      if (state.source === "raw" && f.craftable) return false;
      if (state.dominant && f.dominant !== state.dominant) return false;
      if (state.edible && f.calories < 50) return false;
      if (recipeFilter) {
        // at least one recipe must satisfy table + skill + level together
        const ok = f.made.some(r =>
          (!state.table || r.tables.includes(state.table)) &&
          (!state.skill || r.skill === state.skill) &&
          (maxLevel === null || r.level <= maxLevel));
        if (!ok) return false;
      }
      for (const c of RANGE_COLS) {
        const v = f[c.key] ?? 0;
        const lo = state.min[c.key], hi = state.max[c.key];
        if (lo !== undefined && lo !== "" && v < toRaw(c, Number(lo)) - 1e-9) return false;
        if (hi !== undefined && hi !== "" && v > toRaw(c, Number(hi)) + 1e-9) return false;
      }
      return true;
    });
  }

  function sorted(list) {
    const col = COLUMNS.find(c => c.key === state.sort) || COLUMNS[0];
    const mul = state.dir === "desc" ? -1 : 1;
    return list.slice().sort((a, b) => {
      let r;
      if (col.text) r = String(a[col.key] || "~").localeCompare(String(b[col.key] || "~"));
      else r = (a[col.key] ?? -Infinity) - (b[col.key] ?? -Infinity);
      return r * mul || a.name.localeCompare(b.name);
    });
  }

  // ---------- render ----------
  function renderHead() {
    els.head.innerHTML = COLUMNS.map(c => {
      const sortable = c.sortable !== false;
      const sort = state.sort === c.key ? (state.dir === "asc" ? "ascending" : "descending") : "none";
      const dot = c.dot ? `<i class="dot seg ${c.dot}"></i>` : "";
      return `<th scope="col" class="${c.text ? "text" : ""}" data-key="${c.key}"
        ${sortable ? `tabindex="0" aria-sort="${sort}"` : 'style="cursor:default"'}
        ${c.title ? `title="${esc(c.title)}"` : ""}>${dot}${esc(c.label)}</th>`;
    }).join("");
  }

  function render() {
    const list = sorted(filtered());
    const total = foods.filter(f => state.unobtainable || f.obtainable).length;
    const ranges = activeRangeCount();
    els.toggleRanges.textContent = `Stat ranges${ranges ? ` (${ranges})` : ""} ${els.ranges.hidden ? "▾" : "▴"}`;
    els.count.textContent = `Showing ${list.length} of ${total} foods`;
    renderHead();

    if (!list.length) {
      els.body.innerHTML = `<tr><td class="empty" colspan="${COLUMNS.length}">No foods match these filters.</td></tr>`;
      return;
    }
    els.body.innerHTML = list.map(f => {
      const cells = COLUMNS.map(c => {
        const sortedCls = state.sort === c.key ? " sorted" : "";
        switch (c.key) {
          case "name":
            return `<td class="text name${sortedCls}">${esc(f.name)}${f.obtainable ? "" : ' <span class="tag-pill">unused</span>'}</td>`;
          case "category":
            return `<td class="text${sortedCls}">${f.category ? `<span class="tag-pill">${esc(f.category)}</span>` : ""}</td>`;
          case "mix":
            return `<td>${mixBar(f)}</td>`;
          case "skillSort":
            return `<td class="text${sortedCls}">${f.craftable ? esc(f.skillLabel) : '<span class="tag-pill">raw</span>'}</td>`;
          default: {
            const v = f[c.key];
            return `<td class="${!v ? "zero" : ""}${sortedCls}">${display(c, v)}</td>`;
          }
        }
      }).join("");
      return `<tr tabindex="0" data-id="${esc(f.id)}">${cells}</tr>`;
    }).join("");
  }

  // ---------- detail dialog ----------
  const foodLink = (id, name) => id && byId.has(id)
    ? `<a class="food-link" data-id="${esc(id)}" href="?food=${encodeURIComponent(id)}">${esc(name)}</a>`
    : esc(name);

  function ingredientHtml(i) {
    const amt = `<b>${fmtNum(i.amount)}×</b>`;
    const fixed = i.static ? ' <span class="small">(fixed)</span>' : "";
    if (i.tag) {
      const members = tags[i.tag] || [];
      const list = members.map(n => foodLink(byName.get(n)?.id, n)).join(", ");
      return `<li>${amt} any <b>${esc(i.tag)}</b>${fixed}${list ? `<div class="small">${list}</div>` : ""}</li>`;
    }
    return `<li>${amt} ${foodLink(i.id, i.name)}${fixed}</li>`;
  }

  function recipeHtml(r, highlightId) {
    const outs = r.outputs.map(o => `${fmtNum(o.amount)}× ${o.id === highlightId ? `<b>${esc(o.name)}</b>` : foodLink(o.id, o.name)}`).join(", ");
    const bits = [
      r.skill ? `${esc(r.skill)} lvl ${r.level}` : "No skill required",
      r.tables.length ? esc(r.tables.join(", ")) : null,
      r.labor != null ? `${fmtNum(r.labor)} labor` : null,
      r.minutes != null ? `${fmtNum(r.minutes)} min` : null,
    ].filter(Boolean).join(" · ");
    return `<div class="recipe">
      <div class="recipe-top"><b>${esc(r.name)}</b><span class="small">${bits}</span></div>
      <ul>${r.ingredients.map(ingredientHtml).join("")}</ul>
      <div class="small" style="margin-top:6px">Makes ${outs}</div>
    </div>`;
  }

  function openDetail(id, push = true) {
    const f = byId.get(id);
    if (!f) return;
    state.food = id;
    if (push) writeUrl();

    const usedIn = recipes.filter(r =>
      !r.outputs.some(o => o.id === f.id) &&
      r.ingredients.some(i => i.id === f.id || (i.tag && (tags[i.tag] || []).includes(f.name))));
    const usedNames = [...new Map(usedIn.flatMap(r => r.outputs.slice(0, 1)).map(o => [o.name, o])).values()];

    const facts = [
      ["Weight", f.weight != null ? `${fmtNum(f.weight / 1000)} kg` : "—"],
      ["Shelf life", f.shelfLifeHours ? `${fmtNum(f.shelfLifeHours / 24)} days` : "—"],
      ["Density", `${fmtNum(f.density)} / 1000 cal`],
      ["Balance", `${f.balance}%`],
    ];

    els.detailBody.innerHTML = `
      <div class="d-head">
        <h2 id="d-name">${esc(f.name)}</h2>
        <p>${esc(f.description) || "<em>No description.</em>"}</p>
        <p class="d-sub">${[f.category, ...(f.tags || [])].filter(Boolean).map(t => `<span class="tag-pill">${esc(t)}</span>`).join(" ")}
          ${f.obtainable ? "" : '<span class="tag-pill">not obtainable in normal play</span>'}</p>
      </div>
      <div class="stats">
        ${NUTRIENTS.map(n => `<div class="stat ${n}"><b>${fmtNum(f[n])}</b><span>${n}</span></div>`).join("")}
      </div>
      ${mixBar(f, "bigmix")}
      <ul class="facts">
        <li><b>${fmtNum(f.calories)}</b> calories</li>
        <li><b>${fmtNum(f.nutrientTotal)}</b> total nutrients</li>
        ${facts.map(([k, v]) => `<li>${k}: <b>${v}</b></li>`).join("")}
      </ul>
      <h3>How to get it</h3>
      ${f.made.length ? f.made.map(r => recipeHtml(r, f.id)).join("")
        : `<p class="small">${f.obtainable ? "No crafting recipe — harvested, gathered, hunted or bought." : "No crafting recipe and no Ecopedia page — this item isn't obtainable in normal play."}</p>`}
      <h3>Used in</h3>
      ${usedNames.length
        ? `<div class="used-in">${usedNames.map(o => o.id && byId.has(o.id)
            ? `<a data-id="${esc(o.id)}" href="?food=${encodeURIComponent(o.id)}">${esc(o.name)}</a>`
            : `<a aria-disabled="true">${esc(o.name)}</a>`).join("")}</div>`
        : '<p class="small">Not used as an ingredient in any recipe.</p>'}
      <p class="small" style="margin-top:18px">Source: <code>${esc(f.source)}</code></p>`;

    if (!els.detail.open) els.detail.showModal();
    els.detail.scrollTop = 0;
  }

  // ---------- events ----------
  function bind() {
    const update = () => { writeUrl(); render(); };

    els.q.addEventListener("input", () => { state.q = els.q.value; update(); });
    for (const [el, key] of [[els.category, "category"], [els.table, "table"], [els.skill, "skill"], [els.dominant, "dominant"]]) {
      el.addEventListener("change", () => { state[key] = el.value; update(); });
    }
    els.maxLevel.addEventListener("input", () => { state.maxLevel = els.maxLevel.value; update(); });
    els.edible.addEventListener("change", () => { state.edible = els.edible.checked; update(); });
    els.unobtainable.addEventListener("change", () => { state.unobtainable = els.unobtainable.checked; update(); });
    els.chips.forEach(c => c.addEventListener("click", () => {
      state.source = c.dataset.source;
      els.chips.forEach(x => x.setAttribute("aria-pressed", String(x === c)));
      update();
    }));

    els.ranges.addEventListener("input", e => {
      const t = e.target;
      if (!t.dataset.key) return;
      (t.dataset.bound === "min" ? state.min : state.max)[t.dataset.key] = t.value;
      update();
    });
    els.toggleRanges.addEventListener("click", () => {
      els.ranges.hidden = !els.ranges.hidden;
      els.toggleRanges.setAttribute("aria-expanded", String(!els.ranges.hidden));
      render();
    });
    els.reset.addEventListener("click", () => {
      Object.assign(state, {
        q: "", category: "", table: "", skill: "", maxLevel: "", source: "", dominant: "",
        edible: false, unobtainable: false, sort: "name", dir: "asc", min: {}, max: {}, food: "",
      });
      syncControls();
      update();
    });

    const sortBy = th => {
      const key = th?.dataset.key;
      const col = COLUMNS.find(c => c.key === key);
      if (!col || col.sortable === false) return;
      if (state.sort === key) state.dir = state.dir === "asc" ? "desc" : "asc";
      else { state.sort = key; state.dir = col.text ? "asc" : "desc"; } // numbers: biggest first
      update();
    };
    els.head.addEventListener("click", e => sortBy(e.target.closest("th")));
    els.head.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sortBy(e.target.closest("th")); }
    });

    els.body.addEventListener("click", e => {
      const tr = e.target.closest("tr[data-id]");
      if (tr) openDetail(tr.dataset.id);
    });
    els.body.addEventListener("keydown", e => {
      const tr = e.target.closest("tr[data-id]");
      if (tr && e.key === "Enter") openDetail(tr.dataset.id);
    });

    els.detailBody.addEventListener("click", e => {
      const a = e.target.closest("a[data-id]");
      if (a) { e.preventDefault(); openDetail(a.dataset.id); }
    });
    els.detail.addEventListener("close", () => { state.food = ""; writeUrl(); });
  }

  // ---------- boot ----------
  load().then(() => {
    readUrl();
    buildRanges();
    if (activeRangeCount()) { els.ranges.hidden = false; els.toggleRanges.setAttribute("aria-expanded", "true"); }
    syncControls();
    bind();
    render();
    if (state.food) openDetail(state.food, false);
  }).catch(err => {
    els.meta.textContent = "";
    els.count.textContent = "";
    els.body.innerHTML = `<tr><td class="empty">${esc(err.message)}. If you opened index.html directly from disk, run a local server instead (see README).</td></tr>`;
    console.error(err);
  });
})();
