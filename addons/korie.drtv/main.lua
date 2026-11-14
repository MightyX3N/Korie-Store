-- DRTV for Korie.
-- Uses DRTV's own public web API, the one dr.dk/drtv itself uses: the front
-- page and its rows, search, series with their seasons, films, and DR's live
-- channels. DR only streams to Denmark, and some titles are DRM-protected
-- (those can't be played here; the add-on says so).

local A = {}

local CDN = "https://production-cdn.dr-massive.com/api"
local API = "https://production.dr-massive.com/api"
local TOKEN = "https://isl.dr-massive.com/api/authorization/anonymous-sso?device=phone_android&lang=da&supportFallbackToken=true"
local Q = "device=web_browser&lang=da&sub=Anonymous&segments=drtv%2Coptedout&geoLocation=dk&isDeviceAbroad=false"
local LIVE_LIST = "195869"   -- DR's TV guide list: its channels, with their streams

-- the anonymous tokens DRTV hands out, kept while Korie runs
local tok = { account = nil, profile = nil, til = 0 }

local function enc(s)
  return (tostring(s):gsub("[^%w%-%._~]", function(c) return string.format("%%%02X", c:byte()) end))
end

-- DR's picture addresses take a size; ask for what Korie shows
local function img(url, w, h)
  if type(url) ~= "string" or url == "" then return "" end
  url = url:gsub("Width=%d+", "Width=" .. w):gsub("Height=%d+", "Height=" .. h)
  url = url:gsub("Format='png'", "Format='jpg'"):gsub("Quality=%d+", "Quality=75")
  return url
end

local function int(v) return type(v) == "number" and math.floor(v) or tonumber(v) and math.floor(tonumber(v)) or 0 end

local function genres(i)
  local out = {}
  local c = i.customFields and i.customFields.DisplayCategory
  if type(c) == "string" then
    for g in c:gmatch("[^,]+") do out[#out + 1] = (g:gsub("^%s+", ""):gsub("%s+$", "")) end
  end
  return out
end

local function minutes(i) return i.duration and math.floor(int(i.duration) / 60 + 0.5) or 0 end

-- one DRTV item as a Korie item (nil for things Korie can't show, like links)
local function map(i)
  if type(i) ~= "table" or not i.id then return nil end
  local t = i.type
  local p = i.images or {}
  local v = {
    title = i.title or "", overview = i.description or i.shortDescription or "",
    year = i.releaseYear and tostring(int(i.releaseYear)) or "",
    poster = img(p.poster, 400, 600), backdrop = img(p.wallpaper, 1280, 720),
    thumb = img(p.wallpaper or p.tile, 480, 270), genres = genres(i),
  }
  if t == "show" then
    v.id, v.kind = tostring(i.id), "series"
  elseif t == "season" then
    -- a season on the front page opens its series
    v.id, v.kind = tostring(i.showId or i.id), "series"
  elseif t == "program" then
    v.id, v.kind, v.runtime = tostring(i.id), "film", minutes(i)
    v.subtitle = (v.year ~= "" and v.year .. " · " or "") .. v.runtime .. " min"
  elseif t == "episode" then
    v.id, v.kind, v.runtime = tostring(i.id), "episode", minutes(i)
    v.series = i.showId and tostring(i.showId) or nil
    v.subtitle = v.runtime .. " min"
  else
    return nil
  end
  return v
end

local function map_list(items, limit)
  local out = {}
  for _, i in ipairs(items or {}) do
    local v = map(i)
    if v then out[#out + 1] = v end
    if limit and #out >= limit then break end
  end
  return out
end

local function channels(list)
  local out = {}
  for _, c in ipairs((list and list.items) or {}) do
    local url = c.customFields and c.customFields.hlsURL
    if type(url) == "string" and url:sub(1, 8) == "https://" then
      local p = c.images or {}
      out[#out + 1] = { id = "live-" .. tostring(c.id), kind = "live", title = c.title or "", subtitle = "Direkte",
        thumb = img(p.wallpaper or p.tile or p.square or p.logo, 480, 270), poster = img(p.square or p.logo, 400, 400),
        data = { url = url } }
    end
  end
  return out
end

-- What DRTV offers, for Korie's Home, Films, Series and Live TV -----------------

local function page_url(path)
  return CDN .. "/page?path=" .. enc(path) .. "&list_page_size=16&max_list_prefetch=12&" .. Q
end

-- "Film | Danske film" -> "Danske film"; DR's internal list names out
local function tidy_title(t)
  t = t:gsub("^[^|]*|%s*", "")
  if t:find("^DRTV Hero") or t:find("Hero ") then t = "Udvalgt" end
  return t
end

-- a link to another DRTV page (a category) as a Korie item that opens it
local function page_item(i)
  local path = i.path
  if type(path) ~= "string" or path == "" or path:find("^/kanal/") then return nil end
  local p = i.images or {}
  return { id = "page:" .. path, kind = "page", title = i.title or "",
           thumb = img(p.tile or p.wallpaper or p.square, 480, 270), data = { path = path } }
end

-- one DRTV page as rows: content rows, and rows of links to other pages
local function page_rows(page, skip_links)
  local rows = {}
  for _, e in ipairs((page and page.entries) or {}) do
    local l = e.list
    local title = (l and l.title) or e.title
    if l and title and l.items and #l.items > 0 then
      local items, links = {}, {}
      for _, i in ipairs(l.items) do
        if i.type == "link" then
          local v = page_item(i)
          if v then links[#links + 1] = v end
        else
          local v = map(i)
          if v then items[#items + 1] = v end
        end
      end
      if #items > 0 then
        rows[#rows + 1] = { id = tostring(l.id), title = tidy_title(title), items = items }
      elseif #links > 0 and not skip_links and not title:find("text links") and not title:find("Top text") then
        local t = tidy_title(title)
        local low = title:lower()
        if t:find("A %- Å") or t:find("A%-Å") or low:find("tekstlink") or low:find("text link") then t = "Genrer" end
        rows[#rows + 1] = { id = tostring(l.id), title = t, items = links, kind = "pages" }
      end
    end
  end
  return rows
end

local function find_list(page, title)
  for _, e in ipairs((page and page.entries) or {}) do
    if e.list and e.list.title == title then return e.list end
  end
end

function A.browse(ctx)
  return { fetch = { page_url("/"), page_url("/kategorier/film"), page_url("/kategorier/fiktionsserier"),
                     CDN .. "/lists/" .. LIVE_LIST .. "?page=1&page_size=100&" .. Q },
           as = "json", cache = 1800, next = "browse_got" }
end

function A.browse_got(ans)
  local front, films, series, live = ans[1], ans[2], ans[3], ans[4]
  local out = { home = {}, films = page_rows(films), series = page_rows(series), live = channels(live) }
  -- Home: the first two rows of DRTV's own front page
  for _, r in ipairs(page_rows(front, true)) do
    if #out.home < 2 then
      r.title = "DRTV: " .. r.title
      out.home[#out.home + 1] = r
    end
  end
  -- every DRTV category (documentaries, news, children's...) under Series
  local cats = find_list(front, "Kategorier")
  if cats then
    local items = {}
    for _, i in ipairs(cats.items or {}) do
      local v = page_item(i)
      if v and not v.data.path:find("/film$") and not v.data.path:find("/fiktionsserier$") then items[#items + 1] = v end
    end
    for _, extra in ipairs({ { "/ramasjang", "Ramasjang" }, { "/minisjang", "Minisjang" }, { "/ultra", "Ultra" }, { "/gensyn", "Gensyn" } }) do
      items[#items + 1] = { id = "page:" .. extra[1], kind = "page", title = extra[2], data = { path = extra[1] } }
    end
    table.insert(out.series, 1, { id = "categories", title = "Kategorier", items = items, kind = "pages" })
  end
  return out
end

-- a category page (Dokumentar, Ramasjang ...) as rows
function A.page(item, ctx)
  local path = item.data and item.data.path
  if not path then return { rows = {} } end
  return { fetch = page_url(path), as = "json", cache = 1800, next = "page_got" }
end

function A.page_got(page)
  return { rows = page_rows(page), title = page and page.title and page.title:gsub("%s+%-.*$", "") or nil }
end

-- Tokens: anonymous, the same every visitor to dr.dk/drtv gets ---------------------

local function need_token(ctx, next_name, state)
  if tok.account and (ctx.now or 0) < tok.til then return nil end
  state = state or {}
  state.now = ctx.now or 0
  state.after = next_name
  return { fetch = { url = TOKEN, method = "POST",
           body = { deviceId = "korie-" .. tostring(ctx.now or 0), scopes = { "Catalog" }, optout = true } },
           as = "json", next = "token_got", state = state }
end

function A.token_got(ans, state)
  for _, t in ipairs(ans or {}) do
    if t.type == "UserAccount" then tok.account = t.value end
    if t.type == "UserProfile" then tok.profile = t.value end
  end
  if not tok.account then return { error = "DR didn't hand out a token" } end
  tok.til = (state.now or 0) + 6 * 3600
  return A[state.after](nil, state)
end

-- Search --------------------------------------------------------------------------

function A.search(q, ctx)
  return need_token(ctx, "search_go", { q = q }) or A.search_go(nil, { q = q })
end

function A.search_go(_, state)
  return { fetch = { url = API .. "/search?item_detail_expand=all&list_page_size=24&group=true&term=" .. enc(state.q),
           headers = { ["X-Authorization"] = "Bearer " .. (tok.profile or tok.account) } },
           as = "json", next = "search_got" }
end

function A.search_got(ans)
  local items = {}
  for _, k in ipairs({ "series", "movies", "tv", "playable" }) do
    for _, v in ipairs(map_list(ans and ans[k] and ans[k].items)) do items[#items + 1] = v end
  end
  return { items = items }
end

-- A series: its seasons and their episodes -----------------------------------------

function A.open(item, ctx)
  return { fetch = CDN .. "/items/" .. enc(item.id) .. "?expand=all&" .. Q, as = "json", cache = 600, next = "open_show" }
end

function A.open_show(show)
  if type(show) ~= "table" then return { error = "DR doesn't know this series any more" } end
  local s = map(show) or { title = show.title or "" }
  local seasons = {}
  for _, x in ipairs((show.seasons and show.seasons.items) or {}) do seasons[#seasons + 1] = tostring(x.id) end
  local state = { show = s, order = seasons }
  if #seasons == 0 then
    -- a "show" without seasons: its episodes hang off the show itself
    state.order = { tostring(show.id) }
    return A.open_seasons({ show }, state)
  end
  local urls = {}
  for i, id in ipairs(seasons) do urls[i] = CDN .. "/items/" .. enc(id) .. "?expand=all&" .. Q end
  return { fetch = urls, as = "json", cache = 600, next = "open_seasons", state = state }
end

local function episode(e, index, show_title)
  local title = e.episodeName
  if type(title) ~= "string" or title == "" then title = e.contextualTitle end
  if type(title) ~= "string" or title == "" then title = e.title or "" end
  -- "Series: Episode" -> "Episode"; the series page already says which series
  if show_title and show_title ~= "" and title:sub(1, #show_title + 2) == show_title .. ": " then
    title = title:sub(#show_title + 3)
  end
  return { id = tostring(e.id), n = int(e.episodeNumber) > 0 and int(e.episodeNumber) or index,
           title = title,
           overview = e.description or e.shortDescription or "", runtime = minutes(e),
           still = img((e.images or {}).wallpaper or (e.images or {}).tile, 480, 270) }
end

function A.open_seasons(list, state)
  state.seasons = state.seasons or {}
  local more = {}
  for i, x in ipairs(list or {}) do
    if type(x) == "table" then
      local n = int(x.seasonNumber)
      if n <= 0 then n = i end
      local eps = {}
      for k, e in ipairs((x.episodes and x.episodes.items) or {}) do eps[#eps + 1] = episode(e, k, state.show.title) end
      local season = { n = n, title = x.title or "", episodes = eps }
      state.seasons[#state.seasons + 1] = season
      local nxt = x.episodes and x.episodes.paging and x.episodes.paging.next
      if type(nxt) == "string" and nxt ~= "" then
        more[#more + 1] = { url = CDN .. nxt .. (nxt:find("device=") and "" or "&" .. Q), season = #state.seasons }
      end
    end
  end
  return A.more_episodes(nil, { s = state, more = more })
end

-- seasons with many episodes come in pages
function A.more_episodes(ans, st)
  if ans then
    for i, page in ipairs(ans) do
      local season = st.s.seasons[st.more[i].season]
      local nxt = page and page.paging and page.paging.next
      for _, e in ipairs((page and page.items) or {}) do season.episodes[#season.episodes + 1] = episode(e, #season.episodes + 1, st.s.show.title) end
      if type(nxt) == "string" and nxt ~= "" then st.more[i].url = CDN .. nxt .. (nxt:find("device=") and "" or "&" .. Q)
      else st.more[i].url = nil end
    end
    local keep = {}
    for _, m in ipairs(st.more) do if m.url then keep[#keep + 1] = m end end
    st.more = keep
  end
  if #st.more > 0 then
    local urls = {}
    for i, m in ipairs(st.more) do urls[i] = m.url end
    return { fetch = urls, as = "json", next = "more_episodes", state = st }
  end
  local s = st.s
  table.sort(s.seasons, function(a, b) return a.n < b.n end)
  -- two seasons with the same number would mix up
  local used = {}
  for _, x in ipairs(s.seasons) do
    while used[x.n] do x.n = x.n + 1 end
    used[x.n] = true
  end
  local out = s.show
  out.seasons = s.seasons
  return out
end

-- Playing --------------------------------------------------------------------------

local SUB_NAMES = {
  ForeignLanguageSubtitles = { "Dansk (udenlandsk tale)", true },
  CombinedLanguageSubtitles = { "Dansk (al tale)", false },
  DanishLanguageSubtitles = { "Dansk", false },
}

function A.play(item, ctx)
  if item.kind == "live" then
    local url = item.data and item.data.url
    if not url then return { error = "no stream for this channel" } end
    return { url = url, live = true }
  end
  return need_token(ctx, "play_go", { id = item.id }) or A.play_go(nil, { id = item.id })
end

function A.play_go(_, state)
  return { fetch = { url = API .. "/account/items/" .. enc(state.id) .. "/videos?delivery=stream&device=web_browser&ff=idp%2Cldp%2Crpt&lang=da&resolution=HD-1080&sub=Anonymous",
           headers = { Authorization = "Bearer " .. tok.account } },
           as = "json", next = "play_got" }
end

function A.play_got(streams)
  if type(streams) ~= "table" or #streams == 0 then
    return { error = "DR has no stream for this right now (it may have expired, or only be shown in Denmark)" }
  end
  local chosen
  for _, s in ipairs(streams) do
    if s.accessService == "StandardVideo" and s.url then chosen = s break end
  end
  if not chosen then
    for _, s in ipairs(streams) do if s.url then chosen = s break end end
  end
  if not chosen then return { error = "DR gave no address to play" } end
  if chosen.drm and chosen.drm ~= "None" then
    return { error = "DR protects this one with DRM, which Korie can't play" }
  end
  local subs = {}
  for _, s in ipairs(chosen.subtitles or {}) do
    if s.link then
      local name = SUB_NAMES[s.language] or { "Dansk", false }
      subs[#subs + 1] = { url = s.link, title = name[1], language = "da", default = name[2] }
    end
  end
  return { url = chosen.url, subtitles = subs }
end

return A
