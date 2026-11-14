-- RomM in Korie: games from a RomM server (https://github.com/rommapp/romm),
-- under Games. Playing opens RomM's own player (/rom/<id>/ejs) in a web view.

local A = {}

local ROW = 24          -- games per row
local PLATFORM_ROWS = 16

local function trim(s) return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", "")) end

local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local function base64(s)
  local out = {}
  for i = 1, #s, 3 do
    local a, b, c = s:byte(i, i + 2)
    local n = (a << 16) | ((b or 0) << 8) | (c or 0)
    out[#out + 1] = B64:sub((n >> 18) + 1, (n >> 18) + 1) .. B64:sub(((n >> 12) & 63) + 1, ((n >> 12) & 63) + 1)
      .. (b and B64:sub(((n >> 6) & 63) + 1, ((n >> 6) & 63) + 1) or "=")
      .. (c and B64:sub((n & 63) + 1, (n & 63) + 1) or "=")
  end
  return table.concat(out)
end

-- numbers come from JSON as floats: 11, not 11.0
local function idstr(x)
  local n = tonumber(x)
  if n and n == math.floor(n) then return string.format("%d", n) end
  return tostring(x)
end

local function enc(s)
  return (tostring(s):gsub("[^%w%-%._~]", function(c) return string.format("%%%02X", c:byte()) end))
end

-- the server from the settings, as "http://host:port"
local function server(ctx)
  local s = trim(ctx and ctx.settings and ctx.settings.server)
  if s == "" then return nil end
  if not s:match("^https?://") then s = "http://" .. s end
  return (s:gsub("/+$", ""))
end

local function headers(ctx)
  local h = { Accept = "application/json" }
  local st = (ctx and ctx.settings) or {}
  local user, pass = trim(st.username), tostring(st.password or "")
  if user ~= "" then h.Authorization = "Basic " .. base64(user .. ":" .. pass) end
  return h
end

local function query(t)
  local p = {}
  for k, v in pairs(t) do p[#p + 1] = k .. "=" .. enc(v) end
  table.sort(p)
  return table.concat(p, "&")
end

-- light answers: RomM leaves out its big indexes
local function roms_url(base, extra)
  local q = { with_char_index = "false", with_filter_values = "false", with_rom_id_index = "false", with_total = "false" }
  for k, v in pairs(extra) do q[k] = v end
  return base .. "/api/roms?" .. query(q)
end

-- RomM answers a list, or (newer servers) a page {items = ...}
local function list_of(a)
  if type(a) ~= "table" then return {} end
  if type(a.items) == "table" then return a.items end
  return a
end

local function abs(base, p)
  if type(p) ~= "string" or p == "" then return "" end
  if p:match("^https?://") then return p end
  if p:sub(1, 1) ~= "/" then p = "/" .. p end
  return base .. p
end

local function year_of(r)
  local m = r.metadatum or {}
  local t = tonumber(m.first_release_date or r.first_release_date)
  if not t or t <= 0 then return "" end
  if t > 1e11 then t = t / 1000 end   -- milliseconds
  return tostring(1970 + math.floor(t / 31556952))
end

local function genres(r)
  local out = {}
  for _, g in ipairs((r.metadatum and r.metadatum.genres) or r.genres or {}) do
    out[#out + 1] = type(g) == "table" and tostring(g.name or "") or tostring(g)
  end
  return out
end

local function game(r, base)
  if type(r) ~= "table" or r.id == nil then return nil end
  local cover = abs(base, r.path_cover_large or r.path_cover_small)
  if cover == "" then cover = r.url_cover or "" end
  local shots = r.merged_screenshots or r.url_screenshots or {}
  local shot = abs(base, shots[1])
  local name = r.name
  if not name or name == "" then name = r.fs_name_no_ext or r.fs_name or ("Game " .. idstr(r.id)) end
  return {
    id = "rom-" .. idstr(r.id), kind = "game", title = name, year = year_of(r),
    subtitle = r.platform_display_name or r.platform_name or "", overview = r.summary or "",
    poster = cover, thumb = shot ~= "" and shot or cover, backdrop = shot,
    genres = genres(r), data = { id = idstr(r.id) },
  }
end

local function items(answer, base)
  local out = {}
  for _, r in ipairs(list_of(answer)) do
    local g = game(r, base)
    if g then out[#out + 1] = g end
  end
  return out
end

-- Games ---------------------------------------------------------------------------------

function A.browse(ctx)
  local base = server(ctx)
  if not base then return { games = {}, home = {} } end
  return { fetch = base .. "/api/platforms", as = "json", headers = headers(ctx), next = "browse_platforms",
           state = { base = base, h = headers(ctx) } }
end

function A.browse_platforms(platforms, st)
  local base = st.base
  local plats = {}
  for _, p in ipairs(list_of(platforms)) do
    if type(p) == "table" and (tonumber(p.rom_count) or 1) > 0 then plats[#plats + 1] = p end
  end
  table.sort(plats, function(a, b) return (tonumber(a.rom_count) or 0) > (tonumber(b.rom_count) or 0) end)
  local jobs = {
    { url = roms_url(base, { order_by = "last_played", order_dir = "desc", last_played = "true", limit = tostring(ROW) }), as = "json", headers = st.h },
    { url = roms_url(base, { order_by = "id", order_dir = "desc", limit = tostring(ROW) }), as = "json", headers = st.h },
  }
  local names = {}
  for i = 1, math.min(#plats, PLATFORM_ROWS) do
    local p = plats[i]
    jobs[#jobs + 1] = { url = roms_url(base, { platform_ids = idstr(p.id), platform_id = idstr(p.id), order_by = "name", order_dir = "asc", limit = tostring(ROW) }),
                        as = "json", headers = st.h }
    names[#names + 1] = { id = idstr(p.id), name = p.display_name or p.custom_name or p.name or p.slug }
  end
  return { fetch = jobs, next = "browse_roms", state = { base = base, names = names } }
end

function A.browse_roms(answers, st)
  local rows = {}
  local played = items(answers[1], st.base)
  if #played > 0 then rows[#rows + 1] = { id = "played", title = "Continue playing", items = played } end
  local new = items(answers[2], st.base)
  if #new > 0 then rows[#rows + 1] = { id = "new", title = "New games", items = new } end
  for i, p in ipairs(st.names) do
    local its = items(answers[i + 2], st.base)
    if #its > 0 then rows[#rows + 1] = { id = "p" .. tostring(p.id), title = tostring(p.name), items = its } end
  end
  local home = {}
  if #played > 0 then home[1] = { id = "h-played", title = "Games: continue playing", items = played } end
  return { games = rows, home = home }
end

-- Search --------------------------------------------------------------------------------

function A.search(q, ctx)
  local base = server(ctx)
  if not base then return { items = {} } end
  return { fetch = roms_url(base, { search_term = q, limit = "30" }), as = "json", headers = headers(ctx),
           next = "search_got", state = { base = base } }
end

function A.search_got(answer, st)
  return { items = items(answer, st.base) }
end

-- Playing: RomM's own player, in a web view ----------------------------------------------

function A.play(it, ctx)
  local base = server(ctx)
  if not base then return { error = "type your RomM server in the add-on's settings first" } end
  local id = it.data and it.data.id
  if not id then return { error = "RomM didn't say which game this is" } end
  return { web = base .. "/rom/" .. enc(id) .. "/ejs" }
end

return A
