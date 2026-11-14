-- Stremio add-ons in Korie.
-- Each Stremio add-on is a web address with a manifest.json; it answers
-- /catalog, /meta, /stream and /subtitles requests (the Stremio add-on protocol:
-- https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md).
-- Films go under Films, series and channels under Series, TV under Live TV.

local A = {}

local CATALOGS_PER_TYPE = 6   -- rows per kind of thing, per add-on

local function trim(s) return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", "")) end

local function enc(s)
  return (tostring(s):gsub("[^%w%-%._~]", function(c) return string.format("%%%02X", c:byte()) end))
end

-- the add-on addresses from the settings, as base addresses
local function bases(ctx)
  local list = (ctx and ctx.settings and ctx.settings.addons) or {}
  if type(list) == "string" then
    local t = {}
    for line in list:gmatch("[^\r\n]+") do t[#t + 1] = line end
    list = t
  end
  local out = {}
  for _, u in ipairs(list) do
    u = trim(u):gsub("^stremio://", "https://")
    u = u:gsub("/manifest%.json.*$", ""):gsub("/+$", "")
    if u ~= "" then out[#out + 1] = u end
  end
  return out
end

local function manifest_urls(b)
  local urls = {}
  for i, base in ipairs(b) do urls[i] = { url = base .. "/manifest.json", as = "json" } end
  return urls
end

-- does an add-on answer `resource` for this type and id?
local function serves(m, resource, kind, id)
  for _, r in ipairs(m.resources or {}) do
    local name, types, prefixes = r, m.types or {}, m.idPrefixes
    if type(r) == "table" then
      name, types, prefixes = r.name, r.types or m.types or {}, r.idPrefixes or m.idPrefixes
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

local function year_of(m)
  local y = tostring(m.releaseInfo or m.year or ""):match("%d%d%d%d")
  return y or ""
end

local function minutes(m)
  local n = tonumber(tostring(m.runtime or ""):match("%d+"))
  return n or 0
end

local function genres(m)
  local out = {}
  for _, g in ipairs(m.genres or m.genre or {}) do out[#out + 1] = tostring(g) end
  return out
end

-- one Stremio "meta preview" as a Korie item
local function item(m, base)
  if type(m) ~= "table" or not m.id then return nil end
  local kind = ({ movie = "film", series = "series", channel = "series", tv = "live" })[m.type] or "film"
  local v = {
    id = m.type .. "~" .. tostring(m.id), kind = kind, title = m.name or "", year = year_of(m),
    overview = m.description or "", poster = m.poster or "", backdrop = m.background or "",
    thumb = m.background or m.poster or "", genres = genres(m), runtime = minutes(m),
    data = { base = base, type = m.type, id = tostring(m.id) },
  }
  if m.imdbRating and tonumber(m.imdbRating) then v.rating = tonumber(m.imdbRating) end
  if kind == "live" then v.subtitle = m.genres and m.genres[1] or "Live" end
  if kind == "film" and v.year ~= "" then v.subtitle = v.year end
  return v
end

-- Rows for Films, Series and Live TV --------------------------------------------------

function A.browse(ctx)
  local b = bases(ctx)
  if #b == 0 then return { films = {}, series = {}, live = {}, home = {} } end
  return { fetch = manifest_urls(b), cache = 3600, next = "browse_manifests", state = { bases = b } }
end

function A.browse_manifests(manifests, state)
  local jobs, info = {}, {}
  local per = {}
  for i, m in ipairs(manifests or {}) do
    if type(m) == "table" then
      local base = state.bases[i]
      for _, c in ipairs(m.catalogs or {}) do
        local required = false
        for _, e in ipairs(c.extra or {}) do if e.isRequired then required = true end end
        for _, e in ipairs(c.extraRequired or {}) do required = true end
        local key = base .. "|" .. tostring(c.type)
        per[key] = per[key] or 0
        if not required and per[key] < CATALOGS_PER_TYPE then
          per[key] = per[key] + 1
          jobs[#jobs + 1] = { url = base .. "/catalog/" .. enc(c.type) .. "/" .. enc(c.id) .. ".json", as = "json" }
          info[#info + 1] = { base = base, type = c.type, title = c.name or c.id, addon = m.name or m.id }
        end
      end
    end
  end
  if #jobs == 0 then return { films = {}, series = {}, live = {}, home = {} } end
  return { fetch = jobs, cache = 1800, next = "browse_catalogs", state = { info = info, many = #state.bases > 1 } }
end

function A.browse_catalogs(answers, state)
  local out = { films = {}, series = {}, live = {}, home = {} }
  for i, a in ipairs(answers or {}) do
    local inf = state.info[i]
    local items = {}
    for _, m in ipairs((type(a) == "table" and a.metas) or {}) do
      local v = item(m, inf.base)
      if v then items[#items + 1] = v end
    end
    if #items > 0 then
      local title = inf.title
      if state.many then title = title .. " · " .. tostring(inf.addon) end
      local row = { id = inf.base .. "|" .. inf.type .. "|" .. i, title = title, items = items }
      if inf.type == "movie" then out.films[#out.films + 1] = row
      elseif inf.type == "tv" then
        for _, v in ipairs(items) do out.live[#out.live + 1] = v end
      else out.series[#out.series + 1] = row end
    end
  end
  -- Home: the first films row and the first series row
  if out.films[1] then out.home[#out.home + 1] = { id = "h-films", title = out.films[1].title .. " films", items = out.films[1].items } end
  if out.series[1] then out.home[#out.home + 1] = { id = "h-series", title = out.series[1].title .. " series", items = out.series[1].items } end
  return out
end

-- Search ------------------------------------------------------------------------------

function A.search(q, ctx)
  local b = bases(ctx)
  if #b == 0 then return { items = {} } end
  return { fetch = manifest_urls(b), cache = 3600, next = "search_manifests", state = { bases = b, q = q } }
end

function A.search_manifests(manifests, state)
  local jobs, info = {}, {}
  for i, m in ipairs(manifests or {}) do
    if type(m) == "table" then
      for _, c in ipairs(m.catalogs or {}) do
        local can = false
        for _, e in ipairs(c.extra or {}) do if e.name == "search" then can = true end end
        for _, e in ipairs(c.extraSupported or {}) do if e == "search" then can = true end end
        if can then
          jobs[#jobs + 1] = { url = state.bases[i] .. "/catalog/" .. enc(c.type) .. "/" .. enc(c.id) .. "/search=" .. enc(state.q) .. ".json", as = "json" }
          info[#info + 1] = state.bases[i]
        end
      end
    end
  end
  if #jobs == 0 then return { items = {} } end
  return { fetch = jobs, next = "search_got", state = { info = info } }
end

function A.search_got(answers, state)
  local items, seen = {}, {}
  for i, a in ipairs(answers or {}) do
    for _, m in ipairs((type(a) == "table" and a.metas) or {}) do
      local v = item(m, state.info[i])
      if v and not seen[v.id] then
        seen[v.id] = true
        items[#items + 1] = v
      end
    end
  end
  return { items = items }
end

-- A series or channel: its seasons and episodes ----------------------------------------

function A.open(it, ctx)
  local d = it.data or {}
  return { fetch = { url = d.base .. "/meta/" .. enc(d.type) .. "/" .. enc(d.id) .. ".json", as = "json" },
           cache = 3600, next = "open_got", state = d }
end

function A.open_got(ans, d)
  local m = ans and ans.meta
  if type(m) ~= "table" then return { error = "the add-on knows nothing more about this" } end
  local show = item(m, d.base) or {}
  local seasons, by = {}, {}
  local videos = m.videos or {}
  if d.type == "channel" then
    -- a channel's videos, newest first, as one season
    table.sort(videos, function(a, b) return tostring(a.released or "") > tostring(b.released or "") end)
  end
  for i, v in ipairs(videos) do
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
      data = { base = d.base, type = d.type, id = tostring(v.id) },
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

-- Playing: ask every add-on that has streams (and subtitles) for this ----------------

function A.play(it, ctx)
  local d = it.data or {}
  if not d.type then return { error = "the add-on didn't say what this is" } end
  local b = bases(ctx)
  return { fetch = manifest_urls(b), cache = 3600, next = "play_manifests",
           state = { bases = b, type = d.type, id = d.id, live = d.type == "tv" } }
end

function A.play_manifests(manifests, st)
  local jobs, kinds = {}, {}
  for i, m in ipairs(manifests or {}) do
    if type(m) == "table" then
      local base = st.bases[i]
      if serves(m, "stream", st.type, st.id) then
        jobs[#jobs + 1] = { url = base .. "/stream/" .. enc(st.type) .. "/" .. enc(st.id) .. ".json", as = "json" }
        kinds[#kinds + 1] = "stream"
      end
      if serves(m, "subtitles", st.type, st.id) then
        jobs[#jobs + 1] = { url = base .. "/subtitles/" .. enc(st.type) .. "/" .. enc(st.id) .. ".json", as = "json" }
        kinds[#kinds + 1] = "subtitles"
      end
    end
  end
  if #jobs == 0 then
    return { error = "none of your Stremio add-ons has streams for this — add one that does in the add-on's settings" }
  end
  st.kinds = kinds
  return { fetch = jobs, next = "play_got", state = st }
end

function A.play_got(answers, st)
  local url, torrents_only = nil, false
  local subs = {}
  for i, a in ipairs(answers or {}) do
    if type(a) == "table" then
      if st.kinds[i] == "stream" then
        for _, s in ipairs(a.streams or {}) do
          if not url and type(s.url) == "string" and s.url:match("^https?://") then
            url = s.url
          elseif s.infoHash then
            torrents_only = true
          end
        end
      else
        for _, s in ipairs(a.subtitles or {}) do
          if type(s.url) == "string" then
            subs[#subs + 1] = { url = s.url, title = s.lang or "", language = s.lang or "" }
          end
        end
      end
    end
  end
  if not url then
    if torrents_only then
      return { error = "your Stremio add-ons only offer torrents for this, which Korie can't play" }
    end
    return { error = "no stream for this right now" }
  end
  return { url = url, subtitles = subs, live = st.live }
end

return A
