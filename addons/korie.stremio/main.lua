-- Stremio for Korie, version 2.
--
-- Each person signs in with their own Stremio account (Korie's admin → Add-ons → Stremio). Their
-- Stremio add-ons put films and series in their Films and Series (each catalogue a row), Search asks
-- them, and streams come from them. What they watch in Korie goes into their Stremio's Continue
-- Watching, and Stremio's Continue Watching shows on their Home in Korie.
--
-- Talks to Stremio's own API (api.strem.io: login, addonCollectionGet, datastoreGet/Put, the same
-- calls Stremio's apps make) and to each add-on with the Stremio add-on protocol
-- (https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md).

local A = {}

local API = "https://api.strem.io/api/"
local CATALOGS_PER_TYPE = 6   -- rows per kind of thing, per add-on

local function enc(s)
  return (tostring(s):gsub("[^%w%-%._~]", function(c) return string.format("%%%02X", c:byte()) end))
end

local function api(method, body)
  return { url = API .. method, method = "POST", as = "json", body = body }
end

-- seconds since 1970 as Stremio's time ("2026-11-18T10:00:00.000Z")
local function iso(t)
  local days = math.floor(t / 86400)
  local s = t - days * 86400
  -- civil date from days (the other way round from days since 1970)
  local z = days + 719468
  local era = math.floor(z / 146097)
  local doe = z - era * 146097
  local yoe = math.floor((doe - math.floor(doe / 1460) + math.floor(doe / 36524) - math.floor(doe / 146096)) / 365)
  local y = yoe + era * 400
  local doy = doe - (365 * yoe + math.floor(yoe / 4) - math.floor(yoe / 100))
  local mp = math.floor((5 * doy + 2) / 153)
  local d = doy - math.floor((153 * mp + 2) / 5) + 1
  local m = mp < 10 and mp + 3 or mp - 9
  if m <= 2 then y = y + 1 end
  return string.format("%04d-%02d-%02dT%02d:%02d:%02d.000Z", y, m, d, math.floor(s / 3600), math.floor(s % 3600 / 60), s % 60)
end

-- an add-on from the account's collection, kept small: where it is and what it answers
local function addon_of(a)
  if type(a) ~= "table" or type(a.transportUrl) ~= "string" then return nil end
  local base = a.transportUrl:gsub("^stremio://", "https://"):gsub("/manifest%.json.*$", ""):gsub("/+$", "")
  if not base:match("^https?://") then return nil end
  local m = a.manifest or {}
  local catalogs = {}
  for _, c in ipairs(m.catalogs or {}) do
    if type(c) == "table" and c.type and c.id then
      local required, search = false, false
      for _, e in ipairs(c.extra or {}) do
        if e.isRequired then required = true end
        if e.name == "search" then search = true end
      end
      for _, e in ipairs(c.extraRequired or {}) do required = true end
      for _, e in ipairs(c.extraSupported or {}) do if e == "search" then search = true end end
      catalogs[#catalogs + 1] = { type = c.type, id = c.id, name = c.name or c.id, required = required, search = search }
    end
  end
  return { base = base, url = a.transportUrl, name = m.name or m.id or base, resources = m.resources or {}, types = m.types or {},
           prefixes = m.idPrefixes, catalogs = catalogs, protected = type(a.flags) == "table" and a.flags.protected == true }
end

local function host_of(url) return url:match("^https?://([^/:]+)") end

-- what's kept for a person's account: the sign-in key and their add-ons (and their hosts, which
-- Korie lets the add-on fetch from)
local function collection(key, email, addons_list)
  local addons, hosts, seen = {}, {}, {}
  for _, a in ipairs(addons_list or {}) do
    local x = addon_of(a)
    if x then
      addons[#addons + 1] = x
      local h = host_of(x.base)
      if h and not seen[h] then seen[h] = true; hosts[#hosts + 1] = h:lower() end
    end
  end
  return { key = key, email = email, addons = addons, hosts = hosts }
end

local function serves(m, resource, kind, id)
  for _, r in ipairs(m.resources or {}) do
    local name, types, prefixes = r, m.types or {}, m.prefixes
    if type(r) == "table" then
      name, types, prefixes = r.name, r.types or m.types or {}, r.idPrefixes or m.prefixes
    end
    if name == resource then
      local type_ok = #types == 0
      for _, t in ipairs(types) do if t == kind then type_ok = true end end
      local id_ok = not prefixes or #prefixes == 0 or id == nil
      for _, p in ipairs(prefixes or {}) do
        if tostring(id):sub(1, #p) == p then id_ok = true end
      end
      if type_ok and id_ok then return true end
    end
  end
  return false
end

local function year_of(m) return tostring(m.releaseInfo or m.year or ""):match("%d%d%d%d") or "" end
local function minutes(m) return tonumber(tostring(m.runtime or ""):match("%d+")) or 0 end
local function genres(m)
  local out = {}
  for _, g in ipairs(m.genres or m.genre or {}) do out[#out + 1] = tostring(g) end
  return out
end

-- one Stremio "meta preview" as a Korie item
local function item(m)
  if type(m) ~= "table" or not m.id then return nil end
  local kind = ({ movie = "film", series = "series", channel = "series", tv = "live" })[m.type] or "film"
  local v = {
    id = tostring(m.type) .. "~" .. tostring(m.id), kind = kind, title = m.name or "", year = year_of(m),
    overview = m.description or "", poster = m.poster or "", backdrop = m.background or "",
    thumb = m.background or m.poster or "", genres = genres(m), runtime = minutes(m),
    data = { type = m.type, id = tostring(m.id), name = m.name, poster = m.poster },
  }
  if m.imdbRating and tonumber(m.imdbRating) then v.rating = tonumber(m.imdbRating) end
  if kind == "live" then v.subtitle = m.genres and m.genres[1] or "Live" end
  if kind == "film" and v.year ~= "" then v.subtitle = v.year end
  return v
end

local row_id, house_data
local function signed_in(ctx) return type(ctx.account) == "table" and type(ctx.account.key) == "string" end

-- the add-ons added in Korie for everyone (no Stremio account needed)
local function house_addons(ctx) return (type(ctx.house) == "table" and type(ctx.house.addons) == "table") and ctx.house.addons or {} end

-- what a person uses: their own Stremio account's add-ons (if they signed in) and the house's
local function merged(own, house)
  local out, seen = {}, {}
  for _, l in ipairs({ own or {}, house or {} }) do
    for _, a in ipairs(l) do
      if type(a) == "table" and a.base and not seen[a.base] then seen[a.base] = true; out[#out + 1] = a end
    end
  end
  return out
end
local function all_addons(ctx) return merged(signed_in(ctx) and ctx.account.addons or {}, house_addons(ctx)) end
local NONE = "No Stremio add-ons yet: add some in Korie's admin (Add-ons → Stremio)"

-- a catalogue's row: the same id whatever else changes, so an admin's "don't show this" sticks
row_id = function(a, cat) return "cat|" .. a.base .. "|" .. cat.type .. "|" .. cat.id end

-- the catalogues that become rows (the ones that need nothing typed, a few per kind per add-on)
local function shown_catalogs(addons)
  local out, per = {}, {}
  for _, a in ipairs(addons or {}) do
    for _, cat in ipairs(a.catalogs or {}) do
      local k = a.base .. "|" .. cat.type
      per[k] = per[k] or 0
      if not cat.required and per[k] < CATALOGS_PER_TYPE then
        per[k] = per[k] + 1
        out[#out + 1] = { a = a, cat = cat }
      end
    end
  end
  return out
end

-- Signing in -------------------------------------------------------------------------------------

function A.login(fields, ctx)
  return { fetch = { url = API .. "login", method = "POST", as = "full",
           body = { type = "Login", email = fields.email, password = fields.password, facebook = false } },
           next = "login_got", state = { email = fields.email } }
end

function A.login_got(ans, st)
  local r = ans and ans.json
  if type(r) == "table" and r.error then
    local msg = type(r.error) == "table" and r.error.message or tostring(r.error)
    return { error = "Stremio said: " .. msg }
  end
  local res = type(r) == "table" and r.result
  if type(res) ~= "table" or not res.authKey then return { error = "Stremio didn't sign in (" .. tostring(ans and ans.status) .. ")" } end
  st.key = res.authKey
  st.email = (res.user and res.user.email) or st.email
  return { fetch = api("addonCollectionGet", { type = "AddonCollectionGet", authKey = st.key, update = true }), next = "login_addons", state = st }
end

function A.login_addons(ans, st)
  local list = ans and ans.result and ans.result.addons
  local c = collection(st.key, st.email, list)
  return { account = { name = st.email, data = c } }
end

-- What their add-ons offer: their catalogues as rows, Stremio's Continue Watching on Home ----------

function A.browse(ctx)
  if not signed_in(ctx) then
    -- no Stremio account: the house's add-ons only
    return A.browse_catalogs_for(house_addons(ctx), {}, nil)
  end
  local key = ctx.account.key
  -- their add-ons as they are now (changed in Stremio, Korie follows), and their library
  return { fetch = { api("addonCollectionGet", { type = "AddonCollectionGet", authKey = key, update = true }),
                     api("datastoreGet", { authKey = key, collection = "libraryItem", ids = { __array = true }, all = true }) },
           next = "browse_collection", state = { key = key, email = ctx.account.email, house = house_addons(ctx) } }
end

-- every add-on's catalogues as rows (cw: Continue Watching; save: the account to keep)
function A.browse_catalogs_for(list, cw, save)
  local jobs, info = {}, {}
  for _, x in ipairs(shown_catalogs(list)) do
    jobs[#jobs + 1] = { url = x.a.base .. "/catalog/" .. enc(x.cat.type) .. "/" .. enc(x.cat.id) .. ".json", as = "json" }
    info[#info + 1] = { type = x.cat.type, title = x.cat.name, addon = x.a.name, id = row_id(x.a, x.cat) }
  end
  local state = { info = info, many = #list > 1, cw = cw }
  if #jobs == 0 then
    local out = A.browse_catalogs({}, state)
    out.save_account = save
    return out
  end
  return { fetch = jobs, cache = 1800, next = "browse_catalogs", state = state, save_account = save }
end

function A.browse_collection(ans, st)
  local list = type(ans[1]) == "table" and type(ans[1].result) == "table" and ans[1].result.addons
  if type(list) ~= "table" then
    local e = type(ans[1]) == "table" and ans[1].error
    local msg = type(e) == "table" and e.message or e
    if msg then return { error = "Stremio said: " .. tostring(msg) .. ". Sign in to Stremio again in Korie's admin." } end
    return { error = "Stremio didn't answer, so this shows what it had last time." }
  end
  local c = collection(st.key, st.email, list)
  -- Continue Watching from their Stremio library, newest first
  local cont = {}
  local lib = ans[2] and ans[2].result
  for _, li in ipairs(type(lib) == "table" and lib or {}) do
    local s = type(li) == "table" and li.state or nil
    if s and li.type ~= "other" and (not li.removed or li.temp) and (tonumber(s.timeOffset) or 0) > 0 then
      cont[#cont + 1] = li
    end
  end
  table.sort(cont, function(a, b) return tostring(a.state.lastWatched or a._mtime or "") > tostring(b.state.lastWatched or b._mtime or "") end)
  local cw = {}
  for _, li in ipairs(cont) do
    local v = item({ id = li._id, type = li.type, name = li.name, poster = li.poster })
    if v then cw[#cw + 1] = v end
    if #cw >= 20 then break end
  end
  return A.browse_catalogs_for(merged(c.addons, st.house), cw, c)
end

function A.browse_catalogs(answers, st)
  local out = { films = {}, series = {}, live = {}, home = {} }
  for i, a in ipairs(answers or {}) do
    local inf = st.info[i]
    local items = {}
    for _, m in ipairs((type(a) == "table" and a.metas) or {}) do
      local v = item(m)
      if v then items[#items + 1] = v end
    end
    if #items > 0 then
      local title = inf.title
      if st.many then title = title .. " · " .. tostring(inf.addon) end
      local row = { id = inf.id, title = title, items = items }
      if inf.type == "movie" then out.films[#out.films + 1] = row
      elseif inf.type == "tv" then
        for _, v in ipairs(items) do out.live[#out.live + 1] = v end
      else out.series[#out.series + 1] = row end
    end
  end
  if #st.cw > 0 then out.home[#out.home + 1] = { id = "continue", title = "Continue Watching", items = st.cw } end
  if out.films[1] then out.home[#out.home + 1] = { id = "h-films", title = out.films[1].title, items = out.films[1].items } end
  if out.series[1] then out.home[#out.home + 1] = { id = "h-series", title = out.series[1].title, items = out.series[1].items } end
  return out
end

-- For the admin page: the person's Stremio add-ons, and which of their catalogues can be rows ------

local function offers(a)
  local what, seen = {}, {}
  local names = { catalog = "Films and series", meta = "Details", stream = "Streams", subtitles = "Subtitles" }
  for _, r in ipairs(a.resources or {}) do
    local n = names[type(r) == "table" and r.name or r]
    if n and not seen[n] then seen[n] = true; what[#what + 1] = n end
  end
  if #a.catalogs > 0 and not seen["Films and series"] then table.insert(what, 1, "Films and series") end
  return table.concat(what, ", ")
end

local function manifest_url(s)
  s = tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", ""):gsub("^stremio://", "https://")
  if not s:match("^https://") then return nil end
  if not s:match("/manifest%.json$") then s = s:gsub("/+$", "") .. "/manifest.json" end
  return s
end

-- what's kept for the house: its add-ons and their hosts (which Korie then lets the add-on fetch from)
house_data = function(list)
  local hosts, seen = {}, {}
  for _, a in ipairs(list) do
    local h = host_of(a.base)
    if h and not seen[h] then seen[h] = true; hosts[#hosts + 1] = h:lower() end
  end
  if #list == 0 then list = { __array = true } end
  if #hosts == 0 then hosts = { __array = true } end
  return { addons = list, hosts = hosts }
end

local HELP = "The add-on's address (its manifest.json, or a stremio:// link), from the add-on's own page or stremio-addons.net."

local function rows_of(list)
  local rows = {}
  local kinds = { movie = "films", series = "series", tv = "live" }
  for _, x in ipairs(shown_catalogs(list)) do
    local title = x.cat.name
    if #list > 1 then title = title .. " · " .. x.a.name end
    rows[#rows + 1] = { id = row_id(x.a, x.cat), title = title .. " (" .. (kinds[x.cat.type] or x.cat.type) .. ")", section = kinds[x.cat.type] or "series" }
  end
  return rows
end

function A.about(ctx)
  if not signed_in(ctx) then
    -- the house's add-ons: everyone has them, with a Stremio account or not
    local items = {}
    for _, a in ipairs(house_addons(ctx)) do
      items[#items + 1] = { title = a.name, subtitle = offers(a), remove = { call = "remove_house_addon", value = a.url or a.base, label = "Remove" } }
    end
    return {
      sections = { { title = "Stremio add-ons for everyone", items = items,
        text = "Everyone in Korie gets these, without a Stremio account. Someone who signs in to Stremio below gets their own Stremio add-ons too, and their Continue Watching follows them.",
        add = { call = "add_house_addon", label = "Add a Stremio add-on", placeholder = "https://.../manifest.json", help = HELP } } },
      rows = rows_of(house_addons(ctx)),
    }
  end
  local who = (ctx.person and ctx.person.name) or "Their"
  local items = {}
  for _, a in ipairs(ctx.account.addons or {}) do
    local it = { title = a.name, subtitle = offers(a) }
    -- Stremio's own (Cinemeta, Local Files ...) can't be taken out, in Stremio either
    if not a.protected and a.url then it.remove = { call = "remove_addon", value = a.url, label = "Remove" } end
    items[#items + 1] = it
  end
  return {
    sections = { { title = who .. "'s Stremio add-ons", items = items,
      text = "From " .. who .. "'s Stremio account (" .. tostring(ctx.account.email or "") .. "), on top of the add-ons for everyone. Adding or removing one here does it in their Stremio too, and changes made in Stremio show up here.",
      add = { call = "add_addon", label = "Add a Stremio add-on to their account", placeholder = "https://.../manifest.json", help = HELP } } },
    rows = rows_of(all_addons(ctx)),
  }
end

-- The house's add-ons: kept by Korie (for everyone), not in any Stremio account

function A.add_house_addon(value, ctx)
  local url = manifest_url(value)
  if not url then return { error = "That isn't an add-on's address: it starts with https:// or stremio:// and ends in manifest.json" } end
  return { fetch = { url = url, as = "full" }, next = "house_got", state = { url = url, list = house_addons(ctx) } }
end

function A.house_got(ans, st)
  local m = ans and ans.json
  if not (ans and ans.ok and type(m) == "table" and m.id and m.resources) then
    return { error = "There's no Stremio add-on at that address (" .. tostring(ans and ans.status or "no answer") .. ")" }
  end
  local x = addon_of({ transportUrl = st.url, manifest = m })
  if not x then return { error = "That add-on's address can't be used" } end
  local list = {}
  for _, a in ipairs(st.list) do
    if a.base == x.base then return { error = x.name .. " is already one of the add-ons for everyone" } end
    list[#list + 1] = a
  end
  list[#list + 1] = x
  return { ok = true, save_account = house_data(list) }
end

function A.remove_house_addon(value, ctx)
  local list, found = {}, false
  for _, a in ipairs(house_addons(ctx)) do
    if a.url == value or a.base == value then found = true else list[#list + 1] = a end
  end
  if not found then return { error = "It isn't one of the add-ons for everyone any more" } end
  return { ok = true, save_account = house_data(list) }
end

-- Adding and removing add-ons: in their Stremio account itself (addonCollectionSet, as Stremio's
-- apps do), so Stremio and Korie stay the same. The collection is read fresh and sent back whole.

local function refused(ans)
  local e = type(ans) == "table" and ans.error
  local msg = type(e) == "table" and e.message or (type(e) == "string" and e)
  if msg then return { error = "Stremio said: " .. msg .. ". Sign in to Stremio again here." } end
  return { error = "Stremio didn't answer: try again" }
end

function A.add_addon(value, ctx)
  if not signed_in(ctx) then return { error = "Sign in to Stremio first" } end
  local url = manifest_url(value)
  if not url then return { error = "That isn't an add-on's address: it starts with https:// or stremio:// and ends in manifest.json" } end
  return { fetch = { { url = url, as = "full" },
                     api("addonCollectionGet", { type = "AddonCollectionGet", authKey = ctx.account.key, update = true }) },
           next = "add_got", state = { url = url, key = ctx.account.key, email = ctx.account.email } }
end

function A.add_got(ans, st)
  local m = ans[1] and ans[1].json
  if not (ans[1] and ans[1].ok and type(m) == "table" and m.id and m.resources) then
    return { error = "There's no Stremio add-on at that address (" .. tostring(ans[1] and ans[1].status or "no answer") .. ")" }
  end
  local list = type(ans[2]) == "table" and type(ans[2].result) == "table" and ans[2].result.addons
  if type(list) ~= "table" then return refused(ans[2]) end
  for _, a in ipairs(list) do
    if a.transportUrl == st.url or (type(a.manifest) == "table" and a.manifest.id == m.id) then
      return { error = (m.name or "That add-on") .. " is already one of their add-ons" }
    end
  end
  list[#list + 1] = { transportUrl = st.url, manifest = m, flags = { official = false, protected = false } }
  st.list = list
  return { fetch = api("addonCollectionSet", { type = "AddonCollectionSet", authKey = st.key, addons = list }), next = "collection_set", state = st }
end

function A.remove_addon(value, ctx)
  if not signed_in(ctx) then return { error = "Sign in to Stremio first" } end
  return { fetch = api("addonCollectionGet", { type = "AddonCollectionGet", authKey = ctx.account.key, update = true }),
           next = "remove_got", state = { url = value, key = ctx.account.key, email = ctx.account.email } }
end

function A.remove_got(ans, st)
  local list = type(ans) == "table" and type(ans.result) == "table" and ans.result.addons
  if type(list) ~= "table" then return refused(ans) end
  local keep, found = {}, false
  for _, a in ipairs(list) do
    if a.transportUrl == st.url then
      if type(a.flags) == "table" and a.flags.protected then return { error = "Stremio doesn't let that one be removed" } end
      found = true
    else
      keep[#keep + 1] = a
    end
  end
  if not found then return { error = "It isn't one of their add-ons any more" } end
  st.list = keep
  return { fetch = api("addonCollectionSet", { type = "AddonCollectionSet", authKey = st.key, addons = keep }), next = "collection_set", state = st }
end

function A.collection_set(ans, st)
  if not (type(ans) == "table" and ans.result) then
    local e = type(ans) == "table" and ans.error
    return { error = "Stremio didn't keep it" .. (type(e) == "table" and e.message and (": " .. e.message) or "") }
  end
  return { ok = true, save_account = collection(st.key, st.email, st.list) }
end

-- Search: every catalogue of theirs that can search ------------------------------------------------

function A.search(q, ctx)
  local jobs = {}
  for _, a in ipairs(all_addons(ctx)) do
    for _, c in ipairs(a.catalogs or {}) do
      if c.search then jobs[#jobs + 1] = { url = a.base .. "/catalog/" .. enc(c.type) .. "/" .. enc(c.id) .. "/search=" .. enc(q) .. ".json", as = "json" } end
    end
  end
  if #jobs == 0 then return { items = {} } end
  return { fetch = jobs, next = "search_got" }
end

function A.search_got(answers)
  local items, seen = {}, {}
  for _, a in ipairs(answers or {}) do
    for _, m in ipairs((type(a) == "table" and a.metas) or {}) do
      local v = item(m)
      if v and not seen[v.id] then
        seen[v.id] = true
        items[#items + 1] = v
      end
    end
  end
  return { items = items }
end

-- A series or channel: its seasons and episodes (from the first add-on that has its meta) ----------

function A.open(it, ctx)
  local d = it.data or {}
  local jobs = {}
  for _, a in ipairs(all_addons(ctx)) do
    if serves(a, "meta", d.type, d.id) then jobs[#jobs + 1] = { url = a.base .. "/meta/" .. enc(d.type) .. "/" .. enc(d.id) .. ".json", as = "json" } end
  end
  if #jobs == 0 then return { error = #all_addons(ctx) == 0 and NONE or "none of the Stremio add-ons knows more about this" } end
  return { fetch = jobs, cache = 3600, next = "open_got", state = d }
end

function A.open_got(answers, d)
  local m
  for _, a in ipairs(answers or {}) do
    if type(a) == "table" and type(a.meta) == "table" then m = a.meta break end
  end
  if not m then return { error = "your Stremio add-ons know nothing more about this" } end
  local show = item(m) or {}
  local seasons, by = {}, {}
  local videos = m.videos or {}
  if d.type == "channel" then
    table.sort(videos, function(a, b) return tostring(a.released or "") > tostring(b.released or "") end)
  end
  for _, v in ipairs(videos) do
    local sn = tonumber(v.season) or 1
    if d.type == "channel" then sn = 1 end
    if not by[sn] then
      by[sn] = { n = sn, title = sn == 0 and "Extras" or "", episodes = {} }
      seasons[#seasons + 1] = by[sn]
    end
    local s = by[sn]
    s.episodes[#s.episodes + 1] = {
      id = d.type .. "~" .. tostring(v.id), n = tonumber(v.episode) or (#s.episodes + 1),
      title = v.title or v.name or ("Episode " .. tostring(v.episode or #s.episodes + 1)),
      overview = v.overview or v.description or "", still = v.thumbnail or "",
      data = { type = d.type, id = tostring(v.id), series = d.id, name = m.name, poster = m.poster },
    }
  end
  table.sort(seasons, function(a, b)
    if a.n == 0 then return false end
    if b.n == 0 then return true end
    return a.n < b.n
  end)
  show.seasons = seasons
  return show
end

-- Playing: every add-on of theirs with streams (and subtitles) for it is asked ----------------------

function A.play(it, ctx)
  local d = it.data or {}
  if not d.type then return { error = "the add-on didn't say what this is" } end
  local jobs, kinds = {}, {}
  if #all_addons(ctx) == 0 then return { error = NONE } end
  for _, a in ipairs(all_addons(ctx)) do
    if serves(a, "stream", d.type, d.id) then
      jobs[#jobs + 1] = { url = a.base .. "/stream/" .. enc(d.type) .. "/" .. enc(d.id) .. ".json", as = "json" }
      kinds[#kinds + 1] = "stream"
    end
    if serves(a, "subtitles", d.type, d.id) then
      jobs[#jobs + 1] = { url = a.base .. "/subtitles/" .. enc(d.type) .. "/" .. enc(d.id) .. ".json", as = "json" }
      kinds[#kinds + 1] = "subtitles"
    end
  end
  if #jobs == 0 then return { error = "none of the Stremio add-ons has streams for this: add one that does in Korie's admin (Add-ons → Stremio)" } end
  return { fetch = jobs, next = "play_got", state = { kinds = kinds, live = d.type == "tv" } }
end

function A.play_got(answers, st)
  local url, torrents_only, headers = nil, false, nil
  local subs = {}
  for i, a in ipairs(answers or {}) do
    if type(a) == "table" then
      if st.kinds[i] == "stream" then
        for _, s in ipairs(a.streams or {}) do
          if not url and type(s.url) == "string" and s.url:match("^https?://") then
            url = s.url
            local bh = s.behaviorHints and s.behaviorHints.proxyHeaders and s.behaviorHints.proxyHeaders.request
            if type(bh) == "table" then headers = bh end
          elseif s.infoHash then
            torrents_only = true
          end
        end
      else
        for _, s in ipairs(a.subtitles or {}) do
          if type(s.url) == "string" then subs[#subs + 1] = { url = s.url, title = s.lang or "", language = s.lang or "" } end
        end
      end
    end
  end
  if not url then
    if torrents_only then return { error = "your Stremio add-ons only offer torrents for this, which Korie can't play" } end
    return { error = "no stream for this right now" }
  end
  return { url = url, subtitles = subs, live = st.live, headers = headers }
end

-- What they watch in Korie goes into their Stremio's Continue Watching ---------------------------
-- The library item is read first and only its watching state changed, as Stremio's apps do.

function A.progress(it, p, ctx)
  if not signed_in(ctx) then return { ok = true } end
  local d = it.data or {}
  local lib_id = d.series or d.id
  if not lib_id or not d.type or d.type == "tv" then return { ok = true } end
  return { fetch = api("datastoreGet", { authKey = ctx.account.key, collection = "libraryItem", ids = { lib_id }, all = false }),
           next = "progress_got", state = { key = ctx.account.key, id = lib_id, d = d, p = p, now = ctx.now or 0 } }
end

function A.progress_got(ans, st)
  local now = iso(st.now)
  local li = ans and ans.result and ans.result[1]
  if type(li) ~= "table" then
    -- not in their library yet: in Continue Watching only (temp), as Stremio does
    li = { _id = st.id, name = st.d.name or "", type = st.d.type, poster = st.d.poster or "", posterShape = "poster",
           removed = true, temp = true, _ctime = now,
           state = { lastWatched = now, timeWatched = 0, timeOffset = 0, overallTimeWatched = 0, timesWatched = 0, flaggedWatched = 0, duration = 0, noNotif = false },
           behaviorHints = { defaultVideoId = nil, featuredVideoId = nil, hasScheduledVideos = false } }
  end
  local s = li.state or {}
  local pos = math.floor((st.p.position or 0) * 1000)
  local dur = math.floor((st.p.duration or 0) * 1000)
  s.lastWatched = now
  s.video_id = st.d.series and st.d.id or s.video_id
  if st.p.watched then
    -- watched to the end: out of Continue Watching, counted as watched
    s.timeOffset = 0
    s.timesWatched = (tonumber(s.timesWatched) or 0) + 1
    s.flaggedWatched = 1
  else
    s.timeWatched = math.max(tonumber(s.timeWatched) or 0, pos)
    s.timeOffset = math.max(1, pos)
  end
  if dur > 0 then s.duration = dur end
  li.state = s
  li._mtime = now
  return { fetch = api("datastorePut", { authKey = st.key, collection = "libraryItem", changes = { li } }), next = "progress_done" }
end

function A.progress_done(ans)
  if not (ans and ans.result) then return { error = "Stremio didn't keep it" } end
  return { ok = true }
end

return A
