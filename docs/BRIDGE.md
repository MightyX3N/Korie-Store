# The launcher's calls to the device

The launcher (`ui/`) asks the device for things through one call, `call(method, args)`, which
answers with a result or an error. The Android app (`MainActivity`/`Bridge.kt`) and the
browser host (`host/server.mjs`, the start of the Linux version) answer the same calls.

- **Android**: `window.PBSNative.call(token, id, method, json)`; answers come back as
  `window.__pbs.reply(id, { result | error })`. The token is put into the launcher page only,
  so apps' frames (which also see `PBSNative`) can't use it.
- **Browser host**: `POST /bridge` with `{ method, args }`, answered `{ result | error }`.

Events from the device: `window.__pbs.event(name, data)` on Android, `GET /events`
(server-sent events) on the host: `back`, `home`, `menu`, `resume`, `apps-changed`.

| Call | Args | Result |
|---|---|---|
| `info` | | `{ platform, version, device, tv, home: { isDefault, canSet }, helper: { available, on } }` |
| `android.list` | | `[{ package, name, icon, banner?, system, versionCode, versionName }]` (`icon`, `banner`: addresses on the launcher's origin) |
| `android.launch` | `{ package }` | `{ started }` |
| `android.uninstall` | `{ package }` | `{ asked }` (Android asks the person) |
| `android.details` | `{ package }` | `{ opened }` |
| `apps.list` | | the installed launcher apps' `app.json`, each with `url` (its origin) |
| `apps.install` | `{ id, base, files: { path: sha256 } }` | the app's `app.json` |
| `apps.remove` | `{ id }` | `{ removed }` |
| `http` | `{ url, method, headers, body, as: 'text' \| 'base64', timeout? }` | `{ status, headers, url, body, error? }` |
| `net.scan` | `{ ports, path, timeout }` | `[{ url, body }]`: the addresses next to the device (its /24) that answered 200 on those ports |
| `apk.install` | `{ url, sha256, package, name }` | `{ status: 'pending-user' \| 'needs-permission' }` |
| `status` | | `{ network: { type, connected }, bluetooth?: { on } }` |
| `volume.get` / `volume.set` | `{ level?, muted? }` | `{ level, max, muted }` |
| `settings.open` | `{ page: wifi \| bluetooth \| display \| sound \| date \| home \| accessibility \| all }` | `{ opened }` |
| `player.play` | `{ url, title, subtitle, headers, start }` | `{ position, duration, ended }` when closed |
| `web.open` | `{ url }` | `{ closed }` when closed |
| `exit` | | leaves the launcher when it isn't the home app |

Launcher apps never see these calls: they talk to the launcher page with `postMessage`
(`sdk/playbigscreen.js`), and the page checks which frame and origin each message came from
before doing anything for it.
