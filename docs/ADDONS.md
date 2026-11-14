# Writing Korie add-ons

An add-on is a folder named after its id with an `addon.json` and Lua code. It runs inside the
Korie plugin for Jellyfin, sandboxed on [MoonSharp](https://www.moonsharp.org/) (Lua 5.2):
the basic functions, `string`, `table`, `math` and `bit32` only; no files, no `os`, no loading
code, no `utf8` library. Each call has a time limit (3 s). Errors stop the add-on's call, never
Jellyfin.

Each add-on you turn on is a Jellyfin channel: Live TV, Films and Series folders with the
add-on's rows, series that open into seasons and episodes, and categories ("pages") with rows of
their own.

## addon.json

```json
{
  "id": "example.channel", "name": "Example", "type": "content", "version": "1.0.0",
  "author": "You", "description": "What it adds, in plain words.", "main": "main.lua",
  "access": "sandbox", "permissions": ["internet"], "hosts": ["api.example.com", "*.example-cdn.com"],
  "hosts_from_settings": false, "games": false,
  "settings": [{ "key": "server", "label": "Server", "type": "text", "help": "Like 192.168.1.20:8080" }]
}
```

- `permissions: ["internet"]`: an admin is asked before the add-on may fetch anything.
- `hosts`: the only places it may fetch from (https).
- `hosts_from_settings`: it may also fetch from the addresses an admin typed into its
  settings (http too, for servers at home). Passwords never count as addresses.
- `settings`: `text`, `password` (never sent back to the browser) or `list` (several values).
- An `icon.png` in the folder is the channel's picture.

## Functions

`main.lua` returns a table of functions. Every function gets `ctx` with `now` (seconds
since 1970), `language` and `settings`.

```lua
local A = {}
function A.browse(ctx)       -- rows for the channel (kept on the server, asked again every 30 min)
  return { home = { row }, films = { row }, series = { row }, live = { item, ... } }
end                          -- a row is { id = "...", title = "...", items = { item, ... } }
function A.page(item, ctx)   -- an item of kind "page" (a category): its own rows
  return { title = "...", rows = { row } }
end
function A.search(q, ctx) return { items = { item } } end
function A.open(item, ctx)   -- a series: its seasons and episodes
  return { seasons = { { n = 1, title = "", episodes = { { id = "...", n = 1, title = "...", overview = "", still = "https://...", data = {} } } } } }
end
function A.play(item, ctx)   -- asked when something is played
  return { url = "https://...", live = false, headers = { Referer = "..." },
           subtitles = { { url = "https://....vtt", title = "Dansk", language = "da", default = true } } }
  -- or { error = "why it can't be played" }
end
return A
```

An item is `{ id, kind = "film" | "series" | "episode" | "live" | "page" | "game", title,
subtitle, year, runtime, overview, poster, backdrop, thumb, genres, rating, director, cast, data }`.
`data` comes back unchanged when the item is opened or played. Everything an add-on returns is
checked: wrong shapes are left out and noted in the add-on's log (Dashboard → Korie).
Games open web pages, which Jellyfin can't play: they aren't shown in the channel.

Jellyfin plays the address `play` gives; it converts the stream when a device can't play it as
it is, so an add-on only says where the stream is.

## Fetching

Instead of an answer, a function may ask Korie to fetch and call it back:

```lua
return { fetch = "https://api.example.com/x", as = "json", next = "got_x", state = { page = 1 },
         method = "GET", headers = { Authorization = "..." }, body = nil, cache = 600 }
```

`fetch` may be a list (of addresses, or of tables with `url`, `as`, `method`, `headers`,
`body`); they're fetched together and `next` gets a list of answers, `false` for one that
failed. A table `body` is sent as JSON.

## Publishing

Put the add-on in `addons/<id>/` in this repository (or your own repository with the same
layout), then run `python3 tools/build_index.py`, which writes `index.json` with every file's
sha256. Anyone can add your repository under Dashboard → Korie → Repositories.
