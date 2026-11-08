# Eco Food Stats

A fast, searchable reference for every food in **Eco Global Survival**: calories, carbs, fat, protein, vitamins, weight, shelf life, and the recipes that make and use each food.

It's a plain static site (HTML + CSS + JavaScript, no build step), so it runs on GitHub Pages for free.

## Features

- **Sort by any stat** — click a column header (numbers sort highest first; click again to flip).
- **Min/max filters for every stat** — open *Stat ranges* to filter by calories, carbs, fat, protein, vitamins, total nutrients, density, balance, weight and shelf life.
- **Recipe filters** — crafting table, skill, and "max skill level" (e.g. *Baking, level ≤ 2* shows only what you can bake now).
- **Richest in** — show foods whose strongest nutrient is carbs, fat, protein or vitamins.
- **Craftable vs. raw** — split cooked dishes from harvested/gathered produce.
- **Food details** — click any row for its nutrient breakdown, every recipe that makes it (table, skill, labor, time, ingredients) and everything it's used in. Ingredients link to each other.
- **Shareable links** — every filter, sort and open food is stored in the URL.
- Light and dark mode, works on phones.

### Derived stats

| Stat | Meaning |
| --- | --- |
| Nutrients | carbs + fat + protein + vitamins |
| Density | nutrients per 1,000 calories |
| Balance | weakest nutrient ÷ strongest nutrient × 100 (100 = perfectly even) |

Skill-point gain in Eco depends on your whole stomach (nutrient average, balance, variety, tastiness, cravings), not on a single food, so the site shows the stats that drive it rather than a per-food "skill points" number. Tastiness is randomized per player and isn't included.

## Updating the data after an Eco patch

The data comes straight from the C# files that ship with the Eco server (`Mods/__core__/AutoGen`). After a game update, regenerate it:

```powershell
python tools/extract_foods.py "D:\SteamLibrary\steamapps\common\Eco\Eco_Data\Server"
```

That rewrites `data/foods.json`. Commit and push it, and the site updates.

- Point it at the folder that contains `Mods\__core__\AutoGen` — either `Eco\Eco_Data\Server` inside the game, or a standalone *Eco Server* install.
- Only the vanilla `__core__` files are read, so mods and `UserCode` overrides installed on your server don't leak into the data.
- Items with no Ecopedia page and no recipe (developer/unused items such as *Ecoylent*) are marked `obtainable: false` and hidden unless you tick *Show unused/dev items*.
- Python 3.8+ with no extra packages.

## Running locally

Browsers block `fetch()` on `file://` pages, so serve the folder instead of double-clicking `index.html`:

```powershell
python -m http.server 8000
```

Then open <http://localhost:8000>.

## Publishing on GitHub Pages

1. Create a new, empty repository on GitHub (e.g. `eco-food-stats`, no README). This folder is already a git repo with a first commit on `main`, so just connect it and push:

   ```powershell
   git remote add origin https://github.com/<your-user>/eco-food-stats.git
   git push -u origin main
   ```

2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. After a minute the site is live at `https://<your-user>.github.io/eco-food-stats/`.

## Project layout

```
index.html              page markup
assets/style.css        styles
assets/app.js           filtering, sorting, detail view
data/foods.json         generated food + recipe data
tools/extract_foods.py  generator (reads the Eco server files)
```

## Data format

`data/foods.json` has three keys:

- `foods` — one entry per food: `id`, `name`, `description`, `category`, `calories`, `carbs`, `fat`, `protein`, `vitamins`, `weight` (grams), `shelfLifeHours`, `tags`, `nutrientTotal`, `density`, `balance`, `craftable`, `obtainable`, `source`.
- `recipes` — every recipe that makes, uses, or takes a tag containing a food: `skill`, `level`, `tables`, `labor`, `minutes`, `ingredients` (item or tag, amount, `static` = not reduced by upgrades), `outputs`.
- `tags` — the items that satisfy each ingredient tag (e.g. `Greens`).

## Credits

Eco is developed by Strange Loop Games. This is an unofficial fan project; all game data belongs to its owners.
