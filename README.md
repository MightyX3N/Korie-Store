# Korie Store

Add-ons for [Korie](https://github.com/MightyX3N/Korie), the media centre. Korie reads
this repository's `index.json` and installs from Store in its menu:

    https://raw.githubusercontent.com/MightyX3N/korie-store/main/index.json

## What's here

| Add-on | What it adds |
| --- | --- |
| [DRTV](addons/korie.drtv) | DR's streaming service: films under Films, series and categories under Series, DR's channels under Live TV. |
| [Stremio](addons/korie.stremio) | Stremio add-ons (Cinemeta and any you add in its settings): films, series, channels and TV. |
| [RomM](addons/korie.romm) | Games from your RomM server under Games, played in RomM's own player. |

Each add-on is a folder named after its id with an `addon.json` and its Lua code. Add-ons run
in Korie's sandbox: they can only fetch from the hosts they list (and, with
`hosts_from_settings`, the addresses an admin types into their settings), and an admin is
asked before one may use the internet. How add-ons are written is in Korie's
[docs/ADDONS.md](https://github.com/MightyX3N/Korie/blob/main/docs/ADDONS.md).

## Adding or changing an add-on

Change its folder (raise `version` in `addon.json` so Korie offers the update), then write the
index and commit both:

    python3 tools/build_index.py

`index.json` lists every file with its sha256; Korie refuses a file that doesn't match. A check
on GitHub fails when the index is out of date.

This repository used to be PlayTheater and PlayBigScreen; their earlier releases are still
under Releases.
