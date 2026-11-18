-- DRTV for Korie, version 2.
--
-- DR's streaming service through the same web API dr.dk/drtv uses (and the Kodi add-on
-- plugin.video.drnu): the front page, films, series and every category, search, DR's live
-- channels, and the streams themselves. DR only streams to Denmark.
--
-- Without a login everything works as on dr.dk/drtv for a visitor. With the house's DR login
-- (Korie's admin → Add-ons → DRTV), each person in Korie uses one of the account's DR profiles:
-- their own Continue watching and My list from DR show on their Home, and a child profile only
-- gets what DR shows children.

local A = {}

local CDN = "https://production-cdn.dr-massive.com/api"
local API = "https://production.dr-massive.com/api"
local ANON = "https://isl.dr-massive.com/api/authorization/anonymous-sso?device=web_browser&lang=da&supportFallbackToken=true"
local LOGIN = "https://login.dr.dk"
local CLIENT_ID = "283ba39a2cf31d3b81e922b8"
local CALLBACK = "https://www.dr.dk/drtv/callback"
local Q = "device=web_browser&lang=da&sub=Anonymous&segments=drtv%2Coptedout&geoLocation=dk&isDeviceAbroad=false"
local LIVE_LIST = "195869"   -- DR's TV guide list: its channels, with their streams

-- small things ------------------------------------------------------------------------------

local function enc(s)
  return (tostring(s):gsub("[^%w%-%._~]", function(c) return string.format("%%%02X", c:byte()) end))
end

local function int(v) return type(v) == "number" and math.floor(v) or tonumber(v) and math.floor(tonumber(v)) or 0 end

-- DR's picture addresses take a size: ask for what Korie shows
local function img(url, w, h)
  if type(url) ~= "string" or url == "" then return "" end
  url = url:gsub("Width=%d+", "Width=" .. w):gsub("Height=%d+", "Height=" .. h)
  url = url:gsub("Format='png'", "Format='jpg'"):gsub("Quality=%d+", "Quality=75")
  return url
end

-- an ISO time ("2026-11-18T10:00:00.000Z") as seconds since 1970 (good enough for "is it old?")
local function iso_time(s)
  if type(s) ~= "string" then return 0 end
  local y, mo, d, h, mi, se = s:match("^(%d+)-(%d+)-(%d+)T(%d+):(%d+):(%d+)")
  if not y then return 0 end
  y, mo, d = tonumber(y), tonumber(mo), tonumber(d)
  -- days since 1970 (civil from days, the other way round)
  if mo <= 2 then y = y - 1 end
  local era = math.floor(y / 400)
  local yoe = y - era * 400
  local mp = (mo + 9) % 12
  local doy = math.floor((153 * mp + 2) / 5) + d - 1
  local doe = yoe * 365 + math.floor(yoe / 4) - math.floor(yoe / 100) + doy
  local days = era * 146097 + doe - 719468
  return days * 86400 + tonumber(h) * 3600 + tonumber(mi) * 60 + tonumber(se)
end

local function on(ctx, key)
  local v = ctx and ctx.settings and ctx.settings[key]
  return v ~= false
end

-- DRTV items as Korie items ------------------------------------------------------------------

local function genres(i)
  local out = {}
  local c = i.customFields and i.customFields.DisplayCategory
  if type(c) == "string" then
    for g in c:gmatch("[^,]+") do out[#out + 1] = (g:gsub("^%s+", ""):gsub("%s+$", "")) end
  end
  return out
end

local function minutes(i) return i.duration and math.floor(int(i.duration) / 60 + 0.5) or 0 end

-- DR's age marks: "AgeRating" 7 / 11 / 15 when DR gives one
local function age_of(i)
  local cf = i.customFields or {}
  local a = tonumber(cf.AgeRating or cf.ageRating or i.ageRating)
  if a and a >= 0 and a <= 18 then return math.floor(a) end
  if i.classification and type(i.classification.code) == "string" then
    local n = tonumber(i.classification.code:match("(%d+)"))
    if n then return n end
  end
  return nil
end

local function map(i)
  if type(i) ~= "table" or not i.id then return nil end
  local t = i.type
  local p = i.images or {}
  local v = {
    title = i.title or "", overview = i.description or i.shortDescription or "",
    year = i.releaseYear and tostring(int(i.releaseYear)) or "",
    poster = img(p.poster, 400, 600), backdrop = img(p.wallpaper, 1280, 720),
    thumb = img(p.wallpaper or p.tile, 480, 270), genres = genres(i), age = age_of(i),
  }
  if t == "show" then
    v.id, v.kind = tostring(i.id), "series"
  elseif t == "season" then
    -- a season on a row opens its series
    v.id, v.kind = tostring(i.showId or i.id), "series"
  elseif t == "program" then
    v.id, v.kind, v.runtime = tostring(i.id), "film", minutes(i)
    v.subtitle = (v.year ~= "" and v.year .. " · " or "") .. v.runtime .. " min"
  elseif t == "episode" then
    v.id, v.kind, v.runtime = tostring(i.id), "episode", minutes(i)
    v.series = i.showId and tostring(i.showId) or nil
    v.subtitle = (i.showTitle and i.showTitle ~= "" and i.showTitle .. " · " or "") .. v.runtime .. " min"
  else
    return nil
  end
  return v
end

local function map_list(items)
  local out = {}
  for _, i in ipairs(items or {}) do
    local v = map(i)
    if v then out[#out + 1] = v end
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
        data = { url = url, channel = tostring(c.id) } }
    end
  end
  return out
end

-- pages and rows -----------------------------------------------------------------------------

local function page_url(path)
  return CDN .. "/page?path=" .. enc(path) .. "&list_page_size=24&max_list_prefetch=14&" .. Q
end

-- "Film | Danske film" -> "Danske film"; DR's internal list names out
local function tidy_title(t)
  t = t:gsub("^[^|]*|%s*", "")
  if t:find("^DRTV Hero") or t:find("Hero ") then t = "Udvalgt" end
  return t
end

local function page_item(i)
  local path = i.path
  if type(path) ~= "string" or path == "" or path:find("^/kanal/") then return nil end
  local p = i.images or {}
  return { id = "page:" .. path, kind = "page", title = i.title or "",
           thumb = img(p.tile or p.wallpaper or p.square, 480, 270), data = { path = path } }
end

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
        rows[#rows + 1] = { id = tostring(l.id), title = t, items = links }
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

-- What DRTV offers, for Home, Films, Series and Live TV -----------------------------------------

function A.browse(ctx)
  local urls = { page_url("/"), page_url("/kategorier/film"), page_url("/kategorier/fiktionsserier"),
                 CDN .. "/lists/" .. LIVE_LIST .. "?page=1&page_size=100&" .. Q }
  return { fetch = urls, as = "json", cache = 1800, next = "browse_got",
           state = { films = on(ctx, "films"), series = on(ctx, "series"), cats = on(ctx, "categories") } }
end

function A.browse_got(ans, st)
  local front, films, series, live = ans[1], ans[2], ans[3], ans[4]
  if not front and not films and not series and not live then
    return { error = "DR didn't answer (its API may be down for a moment)" }
  end
  local out = { home = {}, films = {}, series = {}, live = channels(live) }
  if st.films then out.films = page_rows(films) end
  if st.series then out.series = page_rows(series) end
  -- Home: the first two rows of DRTV's own front page
  for _, r in ipairs(page_rows(front, true)) do
    if #out.home < 2 then
      out.home[#out.home + 1] = r
    end
  end
  -- every DRTV category (Dokumentar, Nyheder, Ramasjang ...) under Series
  if st.cats then
    local cats = find_list(front, "Kategorier")
    local items = {}
    for _, i in ipairs((cats and cats.items) or {}) do
      local v = page_item(i)
      if v and not v.data.path:find("/film$") and not v.data.path:find("/fiktionsserier$") then items[#items + 1] = v end
    end
    for _, extra in ipairs({ { "/ramasjang", "Ramasjang" }, { "/minisjang", "Minisjang" }, { "/ultra", "Ultra" }, { "/gensyn", "Gensyn" } }) do
      items[#items + 1] = { id = "page:" .. extra[1], kind = "page", title = extra[2], data = { path = extra[1] } }
    end
    table.insert(out.series, 1, { id = "categories", title = "Kategorier", items = items })
  end
  return out
end

function A.page(item, ctx)
  local path = item.data and item.data.path
  if not path then return { rows = {} } end
  return { fetch = page_url(path), as = "json", cache = 1800, next = "page_got" }
end

function A.page_got(page)
  if not page then return { error = "DR didn't answer" } end
  return { rows = page_rows(page), title = page.title and page.title:gsub("%s+%-.*$", "") or nil }
end

-- Tokens ----------------------------------------------------------------------------------------
-- Anonymous ones (what every visitor to dr.dk/drtv gets), kept while Korie runs; or, with the
-- house's DR login, the account's own, refreshed when they're old, and one per DR profile.

local anon = { account = nil, profile = nil, til = 0 }

local function token_list(ans)
  -- DR answers with a list of { type = "UserAccount" | "UserProfile", value, expirationDate }
  local out = {}
  for _, t in ipairs(type(ans) == "table" and ans or {}) do
    if type(t) == "table" then
      local v = t.value or t.Token
      if t.type == "UserAccount" then out.account, out.account_til = v, iso_time(t.expirationDate or t.Expires) end
      if t.type == "UserProfile" then out.profile, out.profile_til = v, iso_time(t.expirationDate or t.Expires) end
    end
  end
  return out
end

-- Calls after(state) once there's a token: state.token is the one to use (the person's DR profile,
-- the account's, or an anonymous one), state.account says whether it's a signed-in one.
local function with_token(ctx, after, state)
  state = state or {}
  state.after, state.now = after, ctx.now or 0
  local acc = ctx.account
  if type(acc) == "table" and acc.account then
    state.account = true
    state.account_token = acc.account
    -- a token about to run out: get fresh ones with DR's refresh token
    if (acc.account_til or 0) < state.now + 3600 then
      if not acc.refresh then return { error = "The DR login has run out: sign in again in Korie's admin (Add-ons → DRTV)." } end
      state.profile_id = ctx.profile and ctx.profile.id or nil
      return { fetch = { url = LOGIN .. "/oidc/token", method = "POST", as = "full",
               form = { client_id = CLIENT_ID, refresh_token = acc.refresh, grant_type = "refresh_token" } },
               next = "refresh_got", state = state }
    end
    local pid = ctx.profile and ctx.profile.id
    if pid then
      local pt = (acc.profiles or {})[pid]
      if type(pt) == "table" and (pt.til or 0) > state.now + 600 then
        state.token = pt.token
        return A[after](nil, state)
      end
      -- a token for this DR profile
      state.profile_id = pid
      return { fetch = { url = API .. "/authorization/profile", method = "POST", as = "full",
               headers = { Authorization = "Bearer " .. acc.account },
               body = { profileId = pid, scopes = { "Catalog" } } },
               next = "profile_got", state = state }
    end
    state.token = acc.profile or acc.account
    return A[after](nil, state)
  end
  if anon.account and state.now < anon.til then
    state.token = anon.profile or anon.account
    state.account_token = anon.account
    return A[after](nil, state)
  end
  return { fetch = { url = ANON, method = "POST",
           body = { deviceId = korie.uuid(), scopes = { "Catalog" }, optout = true } },
           as = "json", next = "anon_got", state = state }
end

function A.anon_got(ans, state)
  local t = token_list(ans)
  if not t.account then return { error = "DR didn't hand out a token" } end
  anon.account, anon.profile = t.account, t.profile
  anon.til = state.now + 6 * 3600
  state.token = anon.profile or anon.account
  state.account_token = anon.account
  return A[state.after](nil, state)
end

function A.refresh_got(ans, state)
  local tok = ans and ans.json
  if not (ans and ans.ok and type(tok) == "table" and tok.access_token) then
    return { error = "DR wouldn't renew the login: sign in again in Korie's admin (Add-ons → DRTV)." }
  end
  state.oidc = tok
  return { fetch = { url = API .. "/authorization/exchange", method = "POST", as = "full",
           body = { accessToken = tok.access_token, identityToken = tok.id_token, scopes = { "Catalog" }, device = "web_browser", optout = false } },
           next = "refresh_exchanged", state = state }
end

function A.refresh_exchanged(ans, state)
  local t = token_list(ans and ans.json)
  if not t.account then return { error = "DR wouldn't renew the login: sign in again in Korie's admin (Add-ons → DRTV)." } end
  local fresh = { account = t.account, account_til = t.account_til, profile = t.profile, profiles = {},
                  refresh = state.oidc.refresh_token or nil }
  state.token = t.profile or t.account
  state.account_token = t.account
  -- the answer carries the fresh tokens back to Korie (save_account), whatever comes after
  local res = A[state.after](nil, state)
  if type(res) == "table" then res.save_account = fresh end
  return res
end

function A.profile_got(ans, state)
  local t = token_list(ans and ans.json)
  local tok = t.profile or t.account
  if not tok and ans and type(ans.json) == "table" then tok = ans.json.value or ans.json.token end
  if not tok then
    -- no token for that profile: the account's own still works
    state.token = nil
  else
    state.token = tok
  end
  local res
  if not state.token then
    return { error = "DR wouldn't hand out a token for this DR profile. Pick it again in Korie's admin (Add-ons → DRTV)." }
  end
  res = A[state.after](nil, state)
  if type(res) == "table" then
    local til = t.profile_til or t.account_til or (state.now + 3600)
    res.save_account = { profiles = { [state.profile_id] = { token = state.token, til = til } } }
  end
  return res
end

-- Signing in: DR's own login page, the way dr.dk/drtv signs in (OIDC with PKCE) ------------------

local TRANSACTION_FRAGMENT = "fragment useTransactionTransactionFragment on Transaction { ... on AuthenticatedAuthenticationTransaction { id email registration href __typename } ... on UnauthenticatedAuthenticationTransaction { id email __typename } ... on UnverifiedAuthenticationTransaction { id email name __typename } ... on UnrecognizedAuthenticationTransaction { id __typename } ... on UnidentifiedAuthenticationTransaction { id __typename } __typename }"

local function graphql(name, query, variables)
  return { url = LOGIN .. "/graphql", method = "POST", as = "full", cookies = "login",
           body = { operationName = name, variables = variables, query = query } }
end

function A.login(fields, ctx)
  local verifier = korie.random(64)
  local state = { email = fields.email, password = fields.password, verifier = verifier }
  local q = "client_id=" .. CLIENT_ID .. "&code_challenge=" .. korie.sha256_b64url(verifier) .. "&code_challenge_method=S256"
    .. "&redirect_uri=" .. enc(CALLBACK) .. "&state=" .. enc('{"code_verifier":"' .. verifier .. '","logonRedirectPath":"/","optout":false}')
    .. "&response_type=code&scope=" .. enc("openid roles tracking profile email offline_access")
  return { fetch = { url = LOGIN .. "/oidc/authorize?" .. q, as = "full", cookies = "login" }, next = "login_page", state = state }
end

function A.login_page(ans, st)
  if not ans or ans.status ~= 200 then return { error = "DR's login page didn't open (" .. tostring(ans and ans.status) .. ")" } end
  -- the transaction is the last part of the login page's path (Kodi's add-on reads it the same way)
  local path = ans.url:match("^https?://[^/]+([^?#]*)") or ""
  st.trans = path:match("([^/]+)/*$")
  if not st.trans then return { error = "DR's login page wasn't what Korie expected" } end
  return { fetch = graphql("useTransactionTransactionQuery",
             "query useTransactionTransactionQuery($id: ID!) { transaction(id: $id) { ... on Node { id __typename } ...useTransactionTransactionFragment __typename } } " .. TRANSACTION_FRAGMENT,
             { id = st.trans }), next = "login_identify", state = st }
end

function A.login_identify(_, st)
  return { fetch = graphql("useTransactionIdentificationMutation",
             "mutation useTransactionIdentificationMutation($input: IdentificationInput!) { identify(input: $input) { ... on Node { id __typename } ... on Error { code message __typename } ...useTransactionTransactionFragment __typename } } " .. TRANSACTION_FRAGMENT,
             { input = { transaction = st.trans, email = st.email } }), next = "login_password", state = st }
end

function A.login_password(ans, st)
  local idf = ans and ans.json and ans.json.data and ans.json.data.identify
  if type(idf) == "table" and idf.message then return { error = "DR: " .. idf.message } end
  return { fetch = graphql("useTransactionAuthenticationMutation",
             "mutation useTransactionAuthenticationMutation($input: AuthenticationInput!) { authenticate(input: $input) { ... on Node { id __typename } ... on Error { code message __typename } ...useTransactionTransactionFragment __typename } } " .. TRANSACTION_FRAGMENT,
             { input = { transaction = st.trans, password = st.password } }), next = "login_authenticated", state = st }
end

function A.login_authenticated(ans, st)
  local au = ans and ans.json and ans.json.data and ans.json.data.authenticate
  if type(au) ~= "table" or not au.href then
    local why = type(au) == "table" and (au.message or au.code) or nil
    return { error = why and ("DR said: " .. why) or "DR didn't accept the e-mail or password" }
  end
  st.password = nil
  -- DR sends the browser back to dr.dk with a code: Korie stops there and takes the code
  return { fetch = { url = au.href, as = "full", cookies = "login" }, next = "login_code", state = st }
end

function A.login_code(ans, st)
  local code = ans and ans.url and ans.url:match("[?&]code=([^&#]+)")
  if not code then return { error = "DR didn't send the login back (" .. tostring(ans and ans.status) .. ")" } end
  return { fetch = { url = LOGIN .. "/oidc/token", method = "POST", as = "full",
           form = { client_id = CLIENT_ID, redirect_uri = CALLBACK, code_verifier = st.verifier, code = code, grant_type = "authorization_code" } },
           next = "login_tokens", state = st }
end

function A.login_tokens(ans, st)
  local tok = ans and ans.json
  if not (ans and ans.ok and type(tok) == "table" and tok.access_token) then return { error = "DR didn't hand out a login" } end
  st.oidc = tok
  return { fetch = { url = API .. "/authorization/exchange", method = "POST", as = "full",
           body = { accessToken = tok.access_token, identityToken = tok.id_token, scopes = { "Catalog" }, device = "web_browser", optout = false } },
           next = "login_exchanged", state = st }
end

function A.login_exchanged(ans, st)
  local t = token_list(ans and ans.json)
  if not t.account then return { error = "DR didn't swap the login for DRTV's own" } end
  st.t = t
  return { fetch = { url = API .. "/account?ff=idp%2Cldp%2Crpt&lang=da", as = "full", headers = { ["X-Authorization"] = "Bearer " .. t.account } },
           next = "login_done", state = st }
end

function A.login_done(ans, st)
  local acc = ans and ans.json or {}
  local profiles = {}
  for _, p in ipairs(acc.profiles or {}) do
    if type(p) == "table" and p.id then
      local kid = p.segments and table.concat(p.segments, ","):find("kids") ~= nil or p.isKid == true or p.kids == true
      profiles[#profiles + 1] = { id = tostring(p.id), name = p.name or tostring(p.id), kid = kid }
    end
  end
  return {
    account = { name = acc.email or st.email, data = {
      account = st.t.account, account_til = st.t.account_til, profile = st.t.profile, profiles = {},
      refresh = st.oidc.refresh_token } },
    profiles = profiles,
  }
end

-- A person's own rows: their DR profile's Continue watching and My list --------------------------

function A.mine(ctx)
  if type(ctx.account) ~= "table" then return { rows = {} } end
  return with_token(ctx, "mine_go", {})
end

function A.mine_go(_, st)
  local h = { ["X-Authorization"] = "Bearer " .. st.token }
  return { fetch = {
             { url = API .. "/account/profile/continue-watching/list?page_size=24&" .. Q, headers = h },
             { url = API .. "/account/profile/bookmarks/list?page_size=24&" .. Q, headers = h } },
           as = "json", next = "mine_got" }
end

function A.mine_got(ans)
  local rows = {}
  local cont = map_list(ans[1] and ans[1].items)
  if #cont > 0 then rows[#rows + 1] = { id = "continue", title = "Fortsæt med at se", items = cont } end
  local mylist = map_list(ans[2] and ans[2].items)
  if #mylist > 0 then rows[#rows + 1] = { id = "mylist", title = "Min liste", items = mylist } end
  return { rows = rows }
end

-- Search ----------------------------------------------------------------------------------------

function A.search(q, ctx)
  return with_token(ctx, "search_go", { q = q })
end

function A.search_go(_, st)
  return { fetch = { url = API .. "/search?item_detail_expand=all&list_page_size=24&group=true&term=" .. enc(st.q) .. "&" .. Q,
           headers = { ["X-Authorization"] = "Bearer " .. st.token } },
           as = "json", next = "search_got" }
end

function A.search_got(ans)
  local items = {}
  for _, k in ipairs({ "series", "movies", "tv", "playable" }) do
    for _, v in ipairs(map_list(ans and ans[k] and ans[k].items)) do items[#items + 1] = v end
  end
  return { items = items }
end

-- A series: its seasons and their episodes -----------------------------------------------------

function A.open(item, ctx)
  return { fetch = CDN .. "/items/" .. enc(item.id) .. "?expand=all&" .. Q, as = "json", cache = 600, next = "open_show" }
end

function A.open_show(show)
  if type(show) ~= "table" then return { error = "DR doesn't know this series any more" } end
  local s = map(show) or { title = show.title or "" }
  local seasons = {}
  for _, x in ipairs((show.seasons and show.seasons.items) or {}) do seasons[#seasons + 1] = tostring(x.id) end
  local state = { show = s }
  if #seasons == 0 then
    -- a "show" without seasons: its episodes hang off the show itself
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
  if show_title and show_title ~= "" and title:sub(1, #show_title + 2) == show_title .. ": " then
    title = title:sub(#show_title + 3)
  end
  return { id = tostring(e.id), n = int(e.episodeNumber) > 0 and int(e.episodeNumber) or index, title = title,
           overview = e.description or e.shortDescription or "", runtime = minutes(e), age = age_of(e),
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
      state.seasons[#state.seasons + 1] = { n = n, title = x.title or "", episodes = eps }
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
      st.more[i].url = (type(nxt) == "string" and nxt ~= "") and (CDN .. nxt .. (nxt:find("device=") and "" or "&" .. Q)) or nil
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
  local used = {}
  for _, x in ipairs(s.seasons) do
    while used[x.n] do x.n = x.n + 1 end
    used[x.n] = true
  end
  local out = s.show
  out.seasons = s.seasons
  return out
end

-- Playing -----------------------------------------------------------------------------------------

local SUB_NAMES = {
  ForeignLanguageSubtitles = { "Dansk (udenlandsk tale)", true },
  CombinedLanguageSubtitles = { "Dansk (al tale)", false },
  DanishLanguageSubtitles = { "Dansk", false },
}

function A.play(item, ctx)
  if item.kind == "live" then
    local url = item.data and item.data.url
    if not url then return { error = "DR gave no stream for this channel" } end
    return { url = url, live = true }
  end
  local hd = not (ctx.settings and ctx.settings.quality == "save")
  return with_token(ctx, "play_go", { id = item.id, hd = hd })
end

function A.play_go(_, st)
  local q = "delivery=stream&device=web_browser&ff=idp%2Cldp%2Crpt&lang=da&resolution=" .. (st.hd and "HD-1080" or "HD-720")
    .. "&sub=" .. (st.account and "Registered" or "Anonymous")
  -- streams are asked for with the account's token (as dr.dk and Kodi's add-on do)
  return { fetch = { url = API .. "/account/items/" .. enc(st.id) .. "/videos?" .. q, as = "full",
           headers = { Authorization = "Bearer " .. (st.account_token or st.token) } },
           next = "play_got" }
end

function A.play_got(ans)
  if not ans or ans.status == 403 then
    return { error = "DR refused (403): DR only streams to Denmark. Check that the server's internet connection is in Denmark (no VPN)." }
  end
  local streams = ans.json
  if ans.status ~= 200 or type(streams) ~= "table" or #streams == 0 then
    return { error = "DR has no stream for this right now (it may have expired)" }
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
