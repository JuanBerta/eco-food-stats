#!/usr/bin/env python3
"""Extract Eco food data from the server's AutoGen C# sources into data/foods.json.

Usage:
    python tools/extract_foods.py "<Eco Server folder>" [output.json]

The server folder is the one that contains Mods/__core__/AutoGen, e.g.
    D:\\SteamLibrary\\steamapps\\common\\Eco\\Eco_Data\\Server

Only the vanilla files in Mods/__core__/AutoGen are read, so server mods and
UserCode overrides do not leak into the published data.
"""
import datetime
import glob
import json
import os
import re
import sys

CLASS_RE = re.compile(r'public\s+(?:partial\s+)?class\s+(\w+)\s*(?::\s*([\w<>, .]+))?')


def read(path):
    with open(path, encoding="utf-8-sig", errors="replace") as fh:
        return fh.read()


def split_classes(src):
    """Return (name, base, attribute_text, body_text) for each class in a file."""
    matches = list(CLASS_RE.finditer(src))
    out = []
    for i, m in enumerate(matches):
        start = matches[i - 1].end() if i else 0
        pre = src[start:m.start()]
        cut = max(pre.rfind("\n    }"), pre.rfind("\n}"))
        attrs = pre[cut:] if cut >= 0 else pre
        end = matches[i + 1].start() if i + 1 < len(matches) else len(src)
        out.append((m.group(1), (m.group(2) or "").strip(), attrs, src[m.end():end]))
    return out


def attr(attrs, name):
    m = re.search(r"\[" + name + r'\(\s*"((?:[^"\\]|\\.)*)"', attrs)
    return m.group(1) if m else None


def number(pattern, text, default=None):
    m = re.search(pattern, text)
    return float(m.group(1)) if m else default


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    server = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.path.dirname(__file__), "..", "data", "foods.json")
    autogen = os.path.join(server, "Mods", "__core__", "AutoGen")
    files = glob.glob(os.path.join(autogen, "**", "*.cs"), recursive=True)
    if not files:
        sys.exit(f"No .cs files found under {autogen}")

    names, tags, foods, families = {}, {}, {}, []

    for path in files:
        src = read(path)
        for cls, base, attrs, body in split_classes(src):
            display = attr(attrs, "LocDisplayName")
            if display:
                names[cls] = display
            for t in re.findall(r'\[Tag\("([^"]+)"', attrs):
                tags.setdefault(t, set()).add(cls)

            if base.startswith("FoodItem"):
                nut = {}
                m = re.search(r"Nutrients\(\)\s*\{([^}]*)\}", body)
                if m:
                    for k, v in re.findall(r"(\w+)\s*=\s*([\d.]+)", m.group(1)):
                        nut[k.lower()] = float(v)
                eco = re.search(r'\[Ecopedia\("([^"]+)",\s*"([^"]+)"', attrs)
                foods[cls] = {
                    "id": cls[:-4] if cls.endswith("Item") else cls,
                    "name": display or cls,
                    "description": attr(attrs, "LocDescription") or "",
                    "category": eco.group(2) if eco else "",
                    "calories": number(r"Calories\s*=>\s*([\d.]+)", body, 0),
                    "carbs": nut.get("carbs", 0),
                    "fat": nut.get("fat", 0),
                    "protein": nut.get("protein", 0),
                    "vitamins": nut.get("vitamins", 0),
                    "weight": number(r"\[Weight\((\d+)\)", attrs),
                    "shelfLifeHours": number(
                        r"BaseShelfLife\s*=>\s*\(float\)TimeUtil\.HoursToSeconds\(([\d.]+)\)", body),
                    "tags": re.findall(r'\[Tag\("([^"]+)"', attrs),
                    "source": os.path.relpath(path, autogen).replace("\\", "/"),
                }

            if base.startswith("RecipeFamily"):
                skill = re.search(r"\[RequiresSkill\(typeof\((\w+)\),\s*(\d+)\)", attrs)
                tables = re.findall(r"AddRecipe\(tableType:\s*typeof\((\w+)\)", body)
                labor = number(r"CreateLaborInCaloriesValue\(([\d.]+)", body)
                minutes = number(r"CreateCraftTimeValue\([^;]*?start:\s*([\d.]+)", body)
                xp = number(r"ExperienceOnCraft\s*=\s*([\d.]+)", body)
                for block in re.split(r"\.Init\(", body)[1:]:
                    rname = re.search(r'displayName:\s*Localizer\.DoStr\("([^"]+)"\)', block)
                    ing_part, _, out_part = block.partition("items:")
                    ings = []
                    for m in re.finditer(
                            r'new IngredientElement\((typeof\((\w+)\)|"([^"]+)"),\s*([\d.]+)\s*,?\s*([^)]*\)?)',
                            ing_part):
                        rest = m.group(5)
                        ings.append({
                            "item": m.group(2), "tag": m.group(3),
                            "amount": float(m.group(4)),
                            # static ingredients are not reduced by skill/upgrades
                            "static": "true" in rest or "typeof" not in rest,
                        })
                    outs = [{"item": c, "amount": float(n) if n else 1.0}
                            for c, n in re.findall(r"new CraftingElement<(\w+)>\(\s*([\d.]+)?", out_part)]
                    families.append({
                        "family": cls,
                        "name": rname.group(1) if rname else cls,
                        "skill": skill.group(1) if skill else None,
                        "level": int(skill.group(2)) if skill else 0,
                        "tables": tables, "labor": labor, "minutes": minutes, "xp": xp,
                        "ingredients": ings, "outputs": outs,
                    })

    def label(cls):
        if not cls:
            return None
        if cls.endswith("Object") and cls not in names and cls[:-6] + "Item" in names:
            return names[cls[:-6] + "Item"]
        return names.get(cls) or re.sub(r"(Item|Object|Skill)$", "", cls)

    def food_id(cls):
        return foods[cls]["id"] if cls in foods else None

    food_classes = set(foods)
    recipes = []
    for r in families:
        touches_food = (
            any(o["item"] in food_classes for o in r["outputs"])
            or any(i["item"] in food_classes for i in r["ingredients"])
            or any(i["tag"] and tags.get(i["tag"], set()) & food_classes for i in r["ingredients"]))
        if not touches_food:
            continue
        recipes.append({
            "id": r["family"] + ":" + r["name"],
            "name": r["name"],
            "skill": label(r["skill"]), "level": r["level"],
            "tables": [label(t) for t in r["tables"]],
            "labor": r["labor"], "minutes": r["minutes"], "xp": r["xp"],
            "ingredients": [{"id": food_id(i["item"]), "name": label(i["item"]),
                             "tag": i["tag"], "amount": i["amount"], "static": i["static"]}
                            for i in r["ingredients"]],
            "outputs": [{"id": food_id(o["item"]), "name": label(o["item"]), "amount": o["amount"]}
                        for o in r["outputs"]],
        })

    produced = {o["id"] for r in recipes for o in r["outputs"] if o["id"]}
    food_list = []
    for f in sorted(foods.values(), key=lambda x: x["name"].lower()):
        nv = [f["carbs"], f["fat"], f["protein"], f["vitamins"]]
        total = sum(nv)
        f["nutrientTotal"] = total
        f["density"] = round(total / f["calories"] * 1000, 2) if f["calories"] else 0
        # balance: weakest nutrient / strongest nutrient (100 = perfectly even)
        f["balance"] = round(min(nv) / max(nv) * 100) if max(nv) else 0
        f["craftable"] = f["id"] in produced
        # neither an Ecopedia page nor a recipe -> unused / developer item
        f["obtainable"] = bool(f["category"]) or f["craftable"]
        food_list.append(f)

    used_tags = {i["tag"] for r in recipes for i in r["ingredients"] if i["tag"]}
    data = {
        "generated": datetime.date.today().isoformat(),
        "foods": food_list,
        "recipes": recipes,
        "tags": {t: sorted(label(c) for c in tags.get(t, ())) for t in sorted(used_tags)},
    }
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(food_list)} foods, {len(recipes)} recipes -> {out_path}")


if __name__ == "__main__":
    main()
