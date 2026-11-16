# Korie Store

Add-ons for [Korie](https://github.com/MightyX3N/Korie). Korie reads `index.json` here and
installs add-ons from it (Korie's pages → Store). What an add-on brings shows up in the Jellyfin
apps with the rest: films under Films, series and categories under Series, channels under Live TV,
and in Search.

| Add-on | What it adds |
| --- | --- |
| DRTV | DR's films, series, categories and live channels (DR1, DR2, Ramasjang, TVA). DR only streams to Denmark. |
| Free Films | Silent classics in the public domain and the Blender Foundation's open movies, from the Internet Archive. |
| Stremio | Films, series and TV from Stremio add-ons you add by their manifest address. Signing in with a Stremio account per person is coming. |
| RomM | Your games from a RomM server. Jellyfin's apps can't open games, so they only show in Korie's own pages. |

## Writing an add-on

See [docs/ADDONS.md](docs/ADDONS.md). Add-ons are Lua 5.4, sandboxed on the Korie server. Put
yours in `addons/<id>/`, run `python3 tools/build_index.py`, and open a pull request, or publish
your own repository with the same layout and point Korie at it with `KORIE_STORE=<its raw address>`.
