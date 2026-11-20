# Writing Korie add-ons

An add-on is a folder named after its id with an `addon.json` and Lua 5.4 code. It runs
on the Korie server in a sandbox: only `base`, `string`, `table`, `math` and `utf8`; no
files, no `os`, no loading code; each call has a time limit (3 s) and the add-on a memory
limit (64 MB). Errors stop the add-on's call, never Korie.

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
- `settings`: `text`, `password` (shown as dots) or `list` (several values).
- `games: true`: the add-on has games; Korie shows Games in the menu when it's on.

## Functions

`main.lua` returns a table of functions. Every function gets `ctx` with `now` (seconds
since 1970), `language` and `settings`.

```lua
local A = {}
function A.browse(ctx)       -- rows for Korie's sections (kept on the server, asked again every 30 min)
  return { home = { row }, films = { row }, series = { row }, games = { row }, live = { item, ... } }
end                          -- a row is { id = "...", title = "...", items = { item, ... } }
function A.page(item, ctx)   -- an item of kind "page" (a category): its own rows
  return { title = "...", rows = { row } }
end
function A.search(q, ctx) return { items = { item } } end
function A.open(item, ctx)   -- a series: its seasons and episodes
  return { seasons = { { n = 1, title = "", episodes = { { id = "...", n = 1, title = "...", overview = "", still = "https://...", data = {} } } } } }
end
function A.play(item, ctx)
  return { url = "https://...", live = false, subtitles = { { url = "https://....vtt", title = "Dansk", language = "da", default = true } } }
  -- or { web = "https://..." }: a web page full screen (RomM's game player)
  -- or { error = "why it can't be played" }
end
return A
```

An item is `{ id, kind = "film" | "series" | "episode" | "live" | "page" | "game", title,
subtitle, year, runtime, overview, poster, backdrop, thumb, genres, rating, director, cast, data }`.
`data` comes back unchanged when the item is opened or played. `audio = true` marks sound only (a radio station): Korie's apps play it in the
background like music, with the music bar, instead of in the full-screen player. Give `cert` (an age rating
such as `"DK 11"`, `"PG-13"` or `"15"`) or `age` (a number) when you know it: people with an
age limit then only see what's rated for them. Items without one are shown to everyone who may
use the add-on. Korie checks everything an
add-on returns: wrong shapes are left out and noted in the add-on's log (Store → the add-on).

Rows and pages are your categories. Each row of films or series ("Julefilm", "Krimi") and each
page ("Dokumentar") becomes a genre in Jellyfin's apps, a row of its own under Genres; Korie reads
your pages one after the other in the background to learn what's in them, so the films and series
only found inside a page are in Films and Series too. A row that's a taste of a bigger category
gives way to it, and an A-Z index or a row with nearly everything in it is left out. Without any
categories, an item's own `genres` are used.

Streams play through the server: it repackages or converts them with FFmpeg when a device
can't play them as they are, so an add-on only says where the stream is.

## Fetching

Instead of an answer, a function may ask Korie to fetch and call it back:

```lua
return { fetch = "https://api.example.com/x", as = "json", next = "got_x", state = { page = 1 },
         method = "GET", headers = { Authorization = "..." }, body = nil, cache = 600 }
```

`fetch` may be a list (of addresses, or of tables with `url`, `as`, `method`, `headers`,
`body`); they're fetched together and `next` gets a list of answers, `false` for one that
failed. A table `body` is sent as JSON.

## Households

An add-on with `"type": "service"` and `"permissions": ["households"]` looks after
households: the groups of people who watch from outside the home. An admin is asked before
it's turned on. Korie comes with no such add-on; what one does (a membership, a payment
service), and whether that's allowed where it's used, is up to whoever installs it.

Each function gets the household as `h`: `id`, `name`, `created`, `state`, `people` (how
many) and `data` (what this add-on keeps about it, see `save_household`). The home household
is never asked about: it always may watch.

```lua
local M = {}

-- May this household watch? Asked when a device signs in to it, when one of its people
-- signs in, and every 10 minutes while they watch. The first add-on that says no decides.
function M.access(ctx, h)
  if (h.data.paid_until or 0) > ctx.now then return { allow = true } end
  return { allow = false, message = "Your membership has run out.", url = "https://pay.example.com/?h=" .. h.id }
end

-- A household signed up (or an admin made one).
function M.registered(ctx, h)
  return { save_household = { joined = ctx.now, paid_until = ctx.now + 7 * 86400 } }
end

-- A request to /api/hook/<add-on id>/<path> (GET or POST): a payment service's page back,
-- or its notices. req has method, path, query, headers and body (text).
function M.web(ctx, req)
  if req.path == "/paid" then
    -- (check the request really comes from the payment service first)
    return { household = req.query.h, save_household = { paid_until = ctx.now + 30 * 86400 }, html = "<h1>Thanks!</h1>" }
  end
  return { status = 404, text = "Not found" }
end

return M
```

- `access` answers `{ allow = true }`, or `{ allow = false, message = "...", url = "https://..." }`:
  people see the message, and a button to the address.
- `save_household = { ... }` (from any of them; from `web` together with `household = id`)
  keeps those values in `h.data` for this add-on.
- `web` answers `html`, `json` or `text`, with `status`, or `redirect` to an address. Its
  pages are shown sandboxed: they can't reach Korie's sign-ins.
- All three may fetch, as above, from the add-on's own `hosts`.

## The Store

The Korie Store is github.com/MightyX3N/korie-store: an add-on goes in `addons/<id>/`, then
`python3 tools/build_index.py` writes `index.json` with every file's sha256.
