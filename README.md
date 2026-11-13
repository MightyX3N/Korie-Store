# Korie Store

The apps, add-ons and themes in [Korie](https://github.com/MightyX3N/Korie)'s Store. Korie
reads this repository's `index.json`:

    https://raw.githubusercontent.com/MightyX3N/korie-store/main/index.json

## What's here

| Folder | What it is |
| --- | --- |
| `apps/<id>/` | Korie apps: `app.json` plus the app's files. An app can have a client part (its screens) and a server part (`server/main.js`, run on the Korie server). |
| `addons/<id>/` | Add-ons for an app: `addon.json` says which app (`for`), what kind and which versions of the app it works with. |
| `themes/<id>/` | Themes: `theme.json` with colours, font and background, and stylesheets for apps that allow them. |

Theater, Korie's films/series/music app, comes with every Korie server, so it isn't
listed here; its add-ons are (`drtv`, `stremio`), and themes can style it (`nordlys`).

## Adding something

Add its folder, then write the index and commit both:

    node tools/repoindex.mjs .

How apps, add-ons and themes are made is in Korie's docs
([apps](https://github.com/MightyX3N/Korie/blob/main/docs/APPS.md)).

This repository used to be PlayTheater. PlayTheater became Theater inside Korie; its
earlier releases are still under Releases.
