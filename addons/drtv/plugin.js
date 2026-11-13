// DRTV for PlayTheater: everything in DRTV's A-Å, DR's live channels, and streams.
// It uses DRTV's public web API (the same addresses dr.dk/drtv and yt-dlp use).

var CATALOG = 'https://production-cdn.dr-massive.com/api';
var ACCOUNT = 'https://production.dr-massive.com/api';
var TOKEN = 'https://isl.dr-massive.com/api/authorization/anonymous-sso?device=phone_android&lang=da&supportFallbackToken=true';
var COMMON = 'device=web_browser&lang=da&sub=Anonymous&segments=drtv%2Coptedout&geoLocation=dk&isDeviceAbroad=false';
var AZ_LIST = '348';        // DRTV's A-Å: every title, by first letter
var CHANNEL_LIST = '195869'; // DR's TV guide list: channels with live streams
var LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'Æ', 'Ø', 'Å', '0-9'];
var PAGE = 60;
// DR's kinds of subtitles.
var SUBTITLES = {
  DanishLanguageSubtitles: 'Dansk',
  ForeignLanguageSubtitles: 'Dansk, når der tales andre sprog',
  CombinedLanguageSubtitles: 'Dansk, al tale'
};

function getJSON(url, token) {
  var headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  for (var attempt = 1; ; attempt++) {
    var r = http.get(url, { headers: headers });
    if (r.status === 404) return null;
    if ((r.status >= 500 || r.status === 429) && attempt < 3) continue;
    if (!r.ok) throw new Error('DRTV answered ' + r.status);
    return r.json();
  }
}

function withCommon(path) {
  return CATALOG + path + (path.indexOf('device=') >= 0 ? '' : (path.indexOf('?') >= 0 ? '&' : '?') + COMMON);
}

// DR's picture addresses take a size; ask for a sensible one.
function resize(url, w, h) {
  if (!url) return undefined;
  return url.replace(/Width=\d+/, 'Width=' + w).replace(/Height=\d+/, 'Height=' + h)
    .replace("Format='png'", "Format='jpg'").replace(/Quality=\d+/, 'Quality=75');
}

function int(v) {
  var n = parseInt(v, 10);
  return isNaN(n) ? undefined : n;
}

function toTitle(item) {
  if (!item || !item.id || (item.type !== 'show' && item.type !== 'program')) return null;
  var cats = (item.categories || []).map(function (c) { return String(c).toLowerCase(); });
  var display = (item.customFields && item.customFields.DisplayCategory) || '';
  var genres = display.split(',').map(function (g) { return g.trim(); }).filter(Boolean);
  var film = cats.some(function (c) { return ['film', 'spillefilm', 'julefilm', 'familiefilm'].indexOf(c) >= 0; }) ||
    genres.some(function (g) { return g.toLowerCase() === 'film'; });
  var images = item.images || {};
  return {
    id: item.id,
    kind: item.type === 'show' ? 'series' : 'movie',
    group: item.type === 'show' ? 'series' : film ? 'film' : 'programs',
    title: String(item.title || item.id).trim(),
    year: int(item.releaseYear),
    overview: item.description || item.shortDescription || '',
    genres: genres,
    runtime: item.duration ? Math.round(item.duration / 60) : undefined,
    poster: resize(images.poster, 400, 600),
    backdrop: resize(images.wallpaper, 1280, 720),
    thumb: resize(images.wallpaper || images.tile, 480, 270),
    playable: item.type === 'program'
  };
}

// Every title in DRTV's A-Å, kept for six hours.
function everything() {
  var hit = cache.get('az');
  if (hit) return hit;
  var byId = {};
  var add = function (json) {
    (json && json.items || []).forEach(function (it) { var t = toTitle(it); if (t && !byId[t.id]) byId[t.id] = t; });
  };
  var url = function (letter, page) {
    return CATALOG + '/lists/' + AZ_LIST + '?page=' + page + '&page_size=100&param=' + encodeURIComponent('TitleGroupKey:' + letter) + '&' + COMMON;
  };
  // First pages of every letter, a few at a time; then the pages after.
  var more = [];
  for (var i = 0; i < LETTERS.length; i += 15) {
    var batch = LETTERS.slice(i, i + 15);
    http.all(batch.map(function (l) { return { url: url(l, 1) }; })).forEach(function (r, j) {
      if (!r.ok) return;
      var json = r.json();
      add(json);
      var total = (json.paging && json.paging.total) || 1;
      for (var p = 2; p <= total; p++) more.push(url(batch[j], p));
    });
  }
  for (var k = 0; k < more.length; k += 15) {
    http.all(more.slice(k, k + 15).map(function (u) { return { url: u }; })).forEach(function (r) { if (r.ok) add(r.json()); });
  }
  var list = Object.keys(byId).map(function (id) { return byId[id]; });
  if (!list.length) throw new Error("DRTV didn't send its list of titles");
  list.sort(function (a, b) { return a.title.localeCompare(b.title, 'da'); });
  cache.set('az', list, 6 * 3600);
  return list;
}

function channels() {
  var hit = cache.get('channels');
  if (hit) return hit;
  var json = getJSON(CATALOG + '/lists/' + CHANNEL_LIST + '?page=1&page_size=100&' + COMMON);
  var list = [];
  (json && json.items || []).forEach(function (c) {
    var hls = c.customFields && c.customFields.hlsURL;
    if (!c.id || !hls || hls.indexOf('https://') !== 0) return;
    var images = c.images || {};
    list.push({
      id: 'live:' + c.id, kind: 'movie', title: String(c.title || c.id).trim(), playable: true, badges: ['Live'],
      poster: resize(images.logo || images.square, 400, 400), thumb: resize(images.logo || images.square, 480, 270),
      overview: 'DR live', hls: hls
    });
  });
  if (list.length) cache.set('channels', list, 6 * 3600);
  return list;
}

function strip(t) {
  var o = {};
  for (var k in t) if (k !== 'group' && k !== 'hls') o[k] = t[k];
  return o;
}

function item(id) {
  return getJSON(CATALOG + '/items/' + encodeURIComponent(id) + '?expand=all&' + COMMON);
}

// Every page of a paged list inside an item (seasons of a show, episodes of a season).
function allPages(list) {
  var out = [];
  for (var guard = 0; list && guard < 100; guard++) {
    out = out.concat(list.items || []);
    var next = list.paging && list.paging.next;
    if (!next) break;
    list = getJSON(withCommon(next));
  }
  return out;
}

function token() {
  var hit = cache.get('token');
  if (hit) return hit;
  var device = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  });
  var r = http.post(TOKEN, { deviceId: device, scopes: ['Catalog'], optout: true });
  if (!r.ok) throw new Error('DRTV gave no access (' + r.status + ')');
  var t = (r.json() || []).filter(function (x) { return x.type === 'UserAccount'; })[0];
  if (!t || !t.value) throw new Error('DRTV gave no access');
  var left = t.expirationDate ? (Date.parse(t.expirationDate) - Date.now()) / 1000 - 300 : 3300;
  cache.set('token', t.value, Math.max(60, Math.floor(left)));
  return t.value;
}

register({
  catalogs: function () {
    return [
      { id: 'film', name: 'Film på DRTV', kind: 'movie' },
      { id: 'series', name: 'Serier på DRTV', kind: 'series' },
      { id: 'programs', name: 'Programmer på DRTV', kind: 'mixed' },
      { id: 'search', name: 'DRTV', kind: 'mixed', search: true }
    ];
  },

  browse: function (catalog, q, offset) {
    var list = everything();
    if (catalog === 'search') {
      var needle = String(q || '').toLowerCase().trim();
      if (!needle) return [];
      list = list.filter(function (t) { return t.title.toLowerCase().indexOf(needle) >= 0; });
      list.sort(function (a, b) {
        return (a.title.toLowerCase().indexOf(needle) === 0 ? 0 : 1) - (b.title.toLowerCase().indexOf(needle) === 0 ? 0 : 1);
      });
      return list.slice(offset, offset + PAGE).map(strip);
    }
    return list.filter(function (t) { return t.group === catalog; }).slice(offset, offset + PAGE).map(strip);
  },

  item: function (id) {
    if (id.indexOf('live:') === 0) {
      var ch = channels().filter(function (c) { return c.id === id; })[0];
      if (!ch) throw notFound();
      return strip(ch);
    }
    var json = item(id);
    if (!json) throw notFound();
    if (json.type === 'episode') {
      var ep = toEpisode(json, 0, 0);
      return ep;
    }
    var t = toTitle(json);
    if (!t) throw notFound();
    t = strip(t);
    if (json.type !== 'show') return t;

    // A series: its seasons, then their episodes.
    var seasons = allPages(json.seasons).filter(function (s) { return s && s.id; });
    var loaded = [];
    for (var i = 0; i < seasons.length; i += 8) {
      http.all(seasons.slice(i, i + 8).map(function (s) {
        return { url: CATALOG + '/items/' + encodeURIComponent(s.id) + '?expand=all&' + COMMON };
      })).forEach(function (r) { loaded.push(r.ok ? r.json() : null); });
    }
    var used = {};
    t.episodes = [];
    loaded.forEach(function (season, si) {
      if (!season || season.type !== 'season') return;
      var n = int(season.seasonNumber) || si + 1;
      while (used[n]) n++;
      used[n] = true;
      var seen = {};
      allPages(season.episodes).forEach(function (e, ei) {
        var ep = toEpisode(e, n, ei + 1);
        if (!ep) return;
        while (seen[ep.episode]) ep.episode++;
        seen[ep.episode] = true;
        ep.seriesTitle = t.title;
        // DR often starts an episode's name with the series' name.
        var prefix = t.title.toLowerCase();
        if (ep.title.toLowerCase().indexOf(prefix) === 0) {
          var rest = ep.title.slice(t.title.length).replace(/^\s*[:\-–|]\s*/, '');
          if (rest) ep.title = rest;
        }
        t.episodes.push(ep);
      });
    });
    return t;
  },

  // DR's channels in Live TV, with DR's TV guide.
  liveChannels: function () {
    return channels().map(function (c) { return { id: c.id, name: c.title, logo: c.poster }; });
  },

  guide: function (from, to) {
    var list = channels();
    if (!list.length) return {};
    var ids = list.map(function (c) { return c.id.slice(5); }).join('%2C');
    // DR's schedule comes a day at a time.
    var days = [];
    for (var t = from - 86400000; t <= to; t += 86400000) days.push(new Date(t).toISOString().slice(0, 10));
    var out = {};
    var seen = {};
    for (var i = 0; i < days.length; i += 8) {
      http.all(days.slice(i, i + 8).map(function (d) {
        return { url: CATALOG + '/schedules?channels=' + ids + '&date=' + d + '&hour=0&duration=24&' + COMMON };
      })).forEach(function (r) {
        if (!r.ok) return;
        (r.json() || []).forEach(function (ch) {
          var key = 'live:' + ch.channelId;
          (ch.schedules || []).forEach(function (s) {
            var start = Date.parse(s.startDate), end = Date.parse(s.endDate), it = s.item || {};
            var title = String(it.title || '').trim();
            if (!title || isNaN(start) || isNaN(end) || end <= start || end < from || start > to || seen[key + start]) return;
            seen[key + start] = true;
            var sub = String(it.episodeName || it.contextualTitle || '').trim();
            var images = it.images || {};
            (out[key] = out[key] || []).push({
              start: new Date(start).toISOString(), end: new Date(end).toISOString(), title: title,
              subtitle: sub && sub.toLowerCase() !== title.toLowerCase() ? sub : undefined,
              overview: it.description || it.shortDescription || undefined,
              image: resize(images.tile || images.wallpaper, 480, 270)
            });
          });
        });
      });
    }
    return out;
  },

  streams: function (id) {
    if (id.indexOf('live:') === 0) {
      var ch = channels().filter(function (c) { return c.id === id; })[0];
      if (!ch) throw notFound();
      return [{ name: ch.title, detail: 'Live', url: ch.hls, hls: true }];
    }
    var url = ACCOUNT + '/account/items/' + encodeURIComponent(id) +
      '/videos?delivery=stream&device=web_browser&ff=idp%2Cldp%2Crpt&lang=da&resolution=HD-1080&sub=Anonymous';
    var list = getJSON(url, token()) || [];
    var usable = list.filter(function (s) { return s && s.url; });
    // The normal version first, then sign language and audio description.
    usable.sort(function (a, b) { return (a.accessService === 'StandardVideo' ? 0 : 1) - (b.accessService === 'StandardVideo' ? 0 : 1); });
    var names = { StandardVideo: 'DRTV', SignLanguage: 'Tegnsprog', VisuallyInterpreted: 'Synstolkning', SpokenSubtitles: 'Oplæste undertekster' };
    return usable.map(function (s) {
      return {
        name: names[s.accessService] || s.accessService || 'DRTV',
        detail: 'HD',
        url: s.url,
        hls: true,
        downloadable: !s.drm || s.drm === 'None',
        subtitles: (s.subtitles || []).filter(function (x) { return x.link; }).map(function (x) {
          return { language: 'da', label: SUBTITLES[x.language] || x.language || 'Undertekster', url: x.link };
        })
      };
    });
  }
});

function toEpisode(e, season, index) {
  if (!e || !e.id) return null;
  var images = e.images || {};
  return {
    id: e.id, kind: 'episode', playable: true,
    title: String(e.episodeName || e.contextualTitle || e.title || '').trim(),
    season: season, episode: int(e.episodeNumber) || index,
    overview: e.description || e.shortDescription || '',
    runtime: e.duration ? Math.round(e.duration / 60) : undefined,
    thumb: resize(images.wallpaper || images.tile, 480, 270)
  };
}
