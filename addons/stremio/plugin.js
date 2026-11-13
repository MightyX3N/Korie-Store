// Stremio addons in PlayTheater. Each addon is a web address with a manifest.json; it
// answers /catalog, /meta, /stream and /subtitles requests (the Stremio addon protocol:
// https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md).
//
// Ids here are "<addon id>~<type>~<Stremio id>", so details and streams can be asked
// of the right addons.

function addonURLs() {
  return String(settings.addons || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean)
    .map(function (u) { return u.replace(/^stremio:\/\//, 'https://'); });
}

function baseOf(url) {
  return url.replace(/\/manifest\.json(\?.*)?$/, '').replace(/\/+$/, '');
}

// The addons' manifests, read at most every hour.
function addons() {
  var urls = addonURLs();
  var key = 'manifests:' + urls.join('|');
  var hit = cache.get(key);
  if (hit) return hit;
  var out = [];
  for (var i = 0; i < urls.length; i += 8) {
    var batch = urls.slice(i, i + 8);
    http.all(batch.map(function (u) { return { url: /manifest\.json/.test(u) ? u : baseOf(u) + '/manifest.json', timeout: 15000 }; }))
      .forEach(function (r, j) {
        if (!r.ok) { log('addon', batch[j], 'answered', r.error || r.status); return; }
        try {
          var m = r.json();
          if (!m.id) return;
          out.push({ key: m.id, name: m.name || m.id, base: baseOf(batch[j]), types: m.types || [], idPrefixes: m.idPrefixes || null,
            resources: m.resources || [], catalogs: m.catalogs || [] });
        } catch (e) { log('addon', batch[j], 'has no usable manifest'); }
      });
  }
  cache.set(key, out, 3600);
  return out;
}

// Whether an addon answers a resource (catalog, meta, stream, subtitles) for a type and id.
function serves(a, resource, type, id) {
  var found = false;
  (a.resources || []).forEach(function (r) {
    if (typeof r === 'string') {
      if (r === resource && (a.types.indexOf(type) >= 0 || !a.types.length) && prefixOk(a.idPrefixes, id)) found = true;
    } else if (r && r.name === resource) {
      var types = r.types || a.types;
      if ((types.indexOf(type) >= 0 || !types.length) && prefixOk(r.idPrefixes || a.idPrefixes, id)) found = true;
    }
  });
  return found;
}

function prefixOk(prefixes, id) {
  if (!prefixes || !prefixes.length || id === undefined) return true;
  return prefixes.some(function (p) { return String(id).indexOf(p) === 0; });
}

function kindOf(type) {
  return type === 'movie' ? 'movie' : type === 'series' ? 'series' : 'movie';
}

function enc(s) { return encodeURIComponent(s); }

// Addons name subtitle languages with three-letter codes (ISO 639-2).
var LANGS = { dan: ['da', 'Dansk'], eng: ['en', 'English'], swe: ['sv', 'Svenska'], nor: ['no', 'Norsk'], nob: ['nb', 'Norsk'], fin: ['fi', 'Suomi'],
  ger: ['de', 'Deutsch'], deu: ['de', 'Deutsch'], fre: ['fr', 'Français'], fra: ['fr', 'Français'], spa: ['es', 'Español'], ita: ['it', 'Italiano'],
  dut: ['nl', 'Nederlands'], nld: ['nl', 'Nederlands'], por: ['pt', 'Português'], pob: ['pt-BR', 'Português (Brasil)'], pol: ['pl', 'Polski'],
  rus: ['ru', 'Русский'], ukr: ['uk', 'Українська'], tur: ['tr', 'Türkçe'], gre: ['el', 'Ελληνικά'], ell: ['el', 'Ελληνικά'], ara: ['ar', 'العربية'],
  heb: ['he', 'עברית'], hin: ['hi', 'हिन्दी'], jpn: ['ja', '日本語'], kor: ['ko', '한국어'], chi: ['zh', '中文'], zho: ['zh', '中文'], ice: ['is', 'Íslenska'], isl: ['is', 'Íslenska'] };

function sub(url, lang) {
  var l = LANGS[String(lang || '').toLowerCase()];
  return { language: l ? l[0] : (lang || ''), label: l ? l[1] : (lang || 'Subtitles'), url: url };
}

function yearOf(m) {
  var y = parseInt(String(m.releaseInfo || m.year || m.released || '').slice(0, 4), 10);
  return isNaN(y) ? undefined : y;
}

function entry(a, m) {
  var type = m.type || 'movie';
  var e = {
    id: a.key + '~' + type + '~' + m.id,
    kind: kindOf(type),
    title: m.name || m.id,
    year: yearOf(m),
    overview: m.description || '',
    genres: m.genres || m.genre || [],
    rating: m.imdbRating ? parseFloat(m.imdbRating) : undefined,
    poster: m.poster,
    backdrop: m.background,
    thumb: m.background || m.poster,
    playable: type !== 'series'
  };
  if (m.runtime) { var mins = parseInt(m.runtime, 10); if (!isNaN(mins)) e.runtime = mins; }
  if (type !== 'movie' && type !== 'series') e.badges = [type.charAt(0).toUpperCase() + type.slice(1)];
  return e;
}

function split(id) {
  var a = id.indexOf('~'), b = id.indexOf('~', a + 1);
  if (a < 0 || b < 0) throw notFound();
  return { key: id.slice(0, a), type: id.slice(a + 1, b), id: id.slice(b + 1) };
}

function catalogList() {
  var out = [];
  addons().forEach(function (a) {
    if (!a.resources.some(function (r) { return r === 'catalog' || (r && r.name === 'catalog'); })) return;
    a.catalogs.forEach(function (c) {
      var extra = c.extra || (c.extraRequired || []).map(function (n) { return { name: n, isRequired: true }; });
      var required = extra.filter(function (x) { return x.isRequired; }).map(function (x) { return x.name; });
      var searchOnly = required.length === 1 && required[0] === 'search';
      var canSearch = extra.some(function (x) { return x.name === 'search'; }) || (c.extraSupported || []).indexOf('search') >= 0;
      var canSkip = extra.some(function (x) { return x.name === 'skip'; }) || (c.extraSupported || []).indexOf('skip') >= 0;
      if (required.length && !searchOnly) return; // needs a genre or such picked first
      out.push({ addon: a, type: c.type, id: c.id, name: c.name || c.id, searchOnly: searchOnly, canSearch: canSearch, canSkip: canSkip });
    });
  });
  return out;
}

function catalogURL(c, extra) {
  return c.addon.base + '/catalog/' + enc(c.type) + '/' + enc(c.id) + (extra ? '/' + extra : '') + '.json';
}

register({
  configure: function (s) {
    if (!addonURLs().length) throw new Error('Add at least one addon address.');
  },

  catalogs: function () {
    var out = catalogList().filter(function (c) { return !c.searchOnly; }).map(function (c, i) {
      var kind = c.type === 'movie' ? 'movie' : c.type === 'series' ? 'series' : 'mixed';
      var typeName = c.type === 'movie' ? 'Films' : c.type === 'series' ? 'Series' : c.type;
      return { id: String(i), name: c.name + (c.name.toLowerCase().indexOf(typeName.toLowerCase()) >= 0 ? '' : ' · ' + typeName) + ' (' + c.addon.name + ')', kind: kind };
    });
    if (catalogList().some(function (c) { return c.canSearch; })) out.push({ id: 'search', name: 'Stremio', kind: 'mixed', search: true });
    return out;
  },

  browse: function (catalog, q, offset) {
    var all = catalogList();
    if (catalog === 'search') {
      var targets = all.filter(function (c) { return c.canSearch; });
      if (!q || offset > 0) return [];
      var seen = {}, out = [];
      for (var i = 0; i < targets.length; i += 8) {
        var batch = targets.slice(i, i + 8);
        http.all(batch.map(function (c) { return { url: catalogURL(c, 'search=' + enc(q)), timeout: 20000 }; })).forEach(function (r, j) {
          if (!r.ok) return;
          ((r.json() || {}).metas || []).forEach(function (m) {
            var e = entry(batch[j].addon, m);
            var k = (m.type || '') + m.id;
            if (!seen[k]) { seen[k] = true; out.push(e); }
          });
        });
      }
      return out;
    }
    var shown = all.filter(function (c) { return !c.searchOnly; });
    var c = shown[parseInt(catalog, 10)];
    if (!c) throw notFound();
    if (offset > 0 && !c.canSkip) return [];
    var r = http.get(catalogURL(c, offset > 0 ? 'skip=' + offset : ''), { timeout: 30000 });
    if (!r.ok) throw new Error(c.addon.name + ' answered ' + r.status);
    return ((r.json() || {}).metas || []).map(function (m) { return entry(c.addon, m); });
  },

  item: function (id) {
    var p = split(id);
    var list = addons();
    // The addon the item came from first, then any other that has details for it.
    var tries = list.filter(function (a) { return a.key === p.key && serves(a, 'meta', p.type, p.id); })
      .concat(list.filter(function (a) { return a.key !== p.key && serves(a, 'meta', p.type, p.id); }));
    for (var i = 0; i < tries.length; i++) {
      var a = tries[i];
      var r = http.get(a.base + '/meta/' + enc(p.type) + '/' + enc(p.id) + '.json', { timeout: 20000 });
      if (!r.ok) continue;
      var m = (r.json() || {}).meta;
      if (!m) continue;
      var e = entry(a, m);
      e.id = id;
      if (m.videos && m.videos.length && p.type !== 'movie') {
        e.playable = false;
        e.episodes = m.videos.map(function (v, n) {
          return {
            id: p.key + '~' + p.type + '~' + v.id, kind: 'episode', playable: true,
            title: v.title || v.name || ('Episode ' + (v.episode || n + 1)),
            seriesTitle: e.title,
            season: v.season || 0, episode: v.episode || v.number || n + 1,
            overview: v.overview || v.description || '', thumb: v.thumbnail
          };
        });
      } else if (p.type !== 'series') {
        e.playable = true;
      }
      return e;
    }
    throw notFound();
  },

  streams: function (id) {
    var p = split(id);
    var list = addons();
    var withStreams = list.filter(function (a) { return serves(a, 'stream', p.type, p.id); });
    var withSubs = list.filter(function (a) { return serves(a, 'subtitles', p.type, p.id); });
    var reqs = withStreams.map(function (a) { return { url: a.base + '/stream/' + enc(p.type) + '/' + enc(p.id) + '.json', timeout: 25000 }; })
      .concat(withSubs.map(function (a) { return { url: a.base + '/subtitles/' + enc(p.type) + '/' + enc(p.id) + '.json', timeout: 15000 }; }));
    var answers = [];
    for (var i = 0; i < reqs.length; i += 16) answers = answers.concat(http.all(reqs.slice(i, i + 16)));

    var subs = [];
    answers.slice(withStreams.length).forEach(function (r) {
      if (!r.ok) return;
      ((r.json() || {}).subtitles || []).forEach(function (s) { if (s.url) subs.push(sub(s.url, s.lang)); });
    });

    var out = [];
    answers.slice(0, withStreams.length).forEach(function (r, i) {
      if (!r.ok) return;
      var a = withStreams[i];
      ((r.json() || {}).streams || []).forEach(function (s) {
        if (!s.url || !/^https?:\/\//.test(s.url)) return; // torrents and external links can't play here
        var hints = s.behaviorHints || {};
        var headers = (hints.proxyHeaders && hints.proxyHeaders.request) || undefined;
        var own = (s.subtitles || []).filter(function (x) { return x.url; }).map(function (x) { return sub(x.url, x.lang); });
        out.push({
          name: String(s.name || a.name).split('\n')[0],
          detail: String(s.title || s.description || hints.filename || '').replace(/\n+/g, ' · '),
          url: s.url, headers: headers, subtitles: own.concat(subs)
        });
      });
    });
    return out;
  }
});
