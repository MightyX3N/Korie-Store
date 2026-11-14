# Korie Store

Add-ons for [Korie](https://github.com/MightyX3N/Korie), the Jellyfin plugin. The Korie plugin
reads `index.json` here and installs add-ons from it (Dashboard → Korie → Store). Each add-on
you turn on shows in Jellyfin as a channel.

| Add-on | What it adds |
| --- | --- |
| DRTV | DR's films, series, categories and live channels (DR1, DR2, Ramasjang, TVA). DR only streams to Denmark. |
| Free Films | Silent classics in the public domain and the Blender Foundation's open movies, from the Internet Archive. |
| Stremio | Films, series and TV from Stremio add-ons you add by their manifest address. |
| RomM | Your games from a RomM server (needs Korie's own client to play: Jellyfin can't open web pages). |

## Writing an add-on

See [docs/ADDONS.md](docs/ADDONS.md). Add-ons are Lua, sandboxed inside the plugin. Put yours in
`addons/<id>/`, run `python3 tools/build_index.py`, and open a pull request, or publish your own
repository with the same layout and add its address under Dashboard → Korie → Repositories.
