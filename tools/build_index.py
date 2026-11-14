#!/usr/bin/env python3
"""Writes index.json from the add-on folders: python3 tools/build_index.py
With --check it only says whether index.json is up to date (used by CI)."""
import hashlib, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEEP = ("id", "name", "type", "version", "author", "description", "access", "permissions", "hosts", "hosts_from_settings", "games", "settings")


def entry(folder):
    path = os.path.join(ROOT, "addons", folder)
    with open(os.path.join(path, "addon.json"), encoding="utf-8") as f:
        m = json.load(f)
    if m.get("id") != folder:
        sys.exit(f"addons/{folder}: the folder must be named after the add-on's id ({m.get('id')})")
    files = []
    for base, dirs, names in os.walk(path):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        for n in sorted(names):
            if n.startswith(".") or n.endswith(".uid"):
                continue
            full = os.path.join(base, n)
            data = open(full, "rb").read()
            files.append({"name": os.path.relpath(full, path).replace(os.sep, "/"),
                          "size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    e = {k: m[k] for k in KEEP if k in m}
    e["path"] = "addons/" + folder
    e["files"] = files
    return e


def build():
    folders = sorted(d for d in os.listdir(os.path.join(ROOT, "addons")) if not d.startswith("."))
    return {"name": "Korie Store", "format": 1, "addons": [entry(f) for f in folders]}


if __name__ == "__main__":
    text = json.dumps(build(), indent=2, ensure_ascii=False) + "\n"
    out = os.path.join(ROOT, "index.json")
    if "--check" in sys.argv:
        old = open(out, encoding="utf-8").read() if os.path.exists(out) else ""
        if old != text:
            sys.exit("index.json is out of date: run python3 tools/build_index.py")
        print("index.json is up to date")
    else:
        open(out, "w", encoding="utf-8").write(text)
        print("wrote index.json")
