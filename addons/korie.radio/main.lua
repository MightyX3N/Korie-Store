-- Radio: internet radio stations from Radio Browser (https://www.radio-browser.info), a free and
-- open directory. As Radio Browser asks: a speaking User-Agent, its round-robin address (with
-- other servers when that fails), station uuids as ids, and a click counted for each station
-- played (/json/url/<uuid>), which keeps its list of popular stations right.

local A = {}

local SERVERS = { "https://all.api.radio-browser.info", "https://de1.api.radio-browser.info", "https://de2.api.radio-browser.info" }
local HEADERS = { ["User-Agent"] = "Korie/1.0 (media server; radio add-on)" }

local function list(v)
	local out = {}
	if type(v) == "table" then for _, x in ipairs(v) do out[#out + 1] = x end
	elseif type(v) == "string" and v ~= "" then for x in string.gmatch(v, "[^,%s]+") do out[#out + 1] = x end end
	return out
end

local function countries(ctx)
	local out, seen = {}, {}
	for _, c in ipairs(list(ctx.settings.countries)) do
		local code = string.upper(c)
		if string.match(code, "^%a%a$") and not seen[code] then seen[code] = true; out[#out + 1] = code end
	end
	if #out == 0 then out[1] = "DK" end
	return out
end

local function count(ctx)
	local n = tonumber(ctx.settings.count) or 50
	if n < 1 or n > 100 then n = 50 end
	return n
end

-- a station as an item: a live "channel" with no picture of its own but its logo
local function station(s)
	local tags = {}
	for t in string.gmatch(s.tags or "", "[^,]+") do
		if #tags < 3 then tags[#tags + 1] = t end
	end
	local logo = s.favicon or ""
	-- a logo that's a picture (many are tiny .ico site icons, which aren't worth showing)
	local path = string.lower(string.match(logo, "^[^?#]*") or "")
	if not string.match(logo, "^https?://") or not (string.match(path, "%.png$") or string.match(path, "%.jpe?g$") or string.match(path, "%.webp$")) then logo = "" end
	local about = table.concat(tags, ", ")
	if (s.bitrate or 0) > 0 then about = (about ~= "" and about .. " · " or "") .. s.bitrate .. " kbps" end
	return {
		id = s.stationuuid, kind = "live", audio = true, title = s.name or "Radio", subtitle = about,
		poster = logo, thumb = logo, genres = tags,
		overview = (s.country or "") .. ((s.language or "") ~= "" and (" · " .. s.language) or ""),
		data = { url = s.url_resolved ~= "" and s.url_resolved or s.url },
	}
end

local function stations(json)
	local out, seen = {}, {}
	for _, s in ipairs(json or {}) do
		local name = string.lower(s.name or "")
		-- (the same station is often listed more than once)
		if s.stationuuid and (s.url_resolved or s.url or "") ~= "" and name ~= "" and not seen[name] then
			seen[name] = true
			out[#out + 1] = station(s)
		end
	end
	return out
end

-- asks one server; on a failure the next one
local function ask(path, nxt, state)
	state = state or {}
	state.server = state.server or 1
	state.path = path
	state.after = nxt
	return { fetch = SERVERS[state.server] .. path, as = "full", headers = HEADERS, next = "answered", state = state, cache = 1800 }
end

-- (a fetch's answer comes back with the state only, so what the next step needs is in it)
function A.answered(res, state)
	if not res or not res.ok then
		if state.server < #SERVERS then
			state.server = state.server + 1
			return ask(state.path, state.after, state)
		end
		return A[state.after](nil, state)
	end
	return A[state.after](res.json, state)
end

-- Live TV: the most liked stations of each country, one country after another
function A.browse(ctx)
	local cs = countries(ctx)
	return ask("/json/stations/bycountrycodeexact/" .. cs[1] .. "?order=votes&reverse=true&hidebroken=true&limit=" .. (count(ctx) * 2), "got_country", { countries = cs, i = 1, n = count(ctx), live = {} })
end

function A.got_country(json, state)
	local got = stations(json)
	local n = state.n
	for i = 1, math.min(#got, n) do state.live[#state.live + 1] = got[i] end
	state.i = state.i + 1
	if state.i <= #state.countries then
		state.server = 1
		return ask("/json/stations/bycountrycodeexact/" .. state.countries[state.i] .. "?order=votes&reverse=true&hidebroken=true&limit=" .. (n * 2), "got_country", state)
	end
	return { live = state.live }
end

function A.search(q, ctx)
	return ask("/json/stations/search?name=" .. korie.urlencode(q) .. "&order=votes&reverse=true&hidebroken=true&limit=40", "got_search", {})
end

function A.got_search(json, state)
	return { items = stations(json) }
end

-- playing: the click is counted (and the station's current address given back), then it plays
function A.play(item, ctx)
	return { fetch = SERVERS[1] .. "/json/url/" .. korie.urlencode(item.id), as = "full", headers = HEADERS, next = "clicked", state = { url = item.data and item.data.url or "" } }
end

function A.clicked(res, state)
	local url = state.url
	if res and res.ok and type(res.json) == "table" and type(res.json.url) == "string" and string.match(res.json.url, "^https?://") then url = res.json.url end
	if url == "" then return { error = "This station has no address." } end
	return { url = url, live = true }
end

return A
