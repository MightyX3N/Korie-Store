# Making a launcher app

A launcher app is a folder with an `app.json`, an icon and web pages. PlayBigScreen shows it
next to the Android apps, runs it in a sandboxed frame on its own origin
(`https://<id>.app.playbigscreen/` on Android), and gives it the SDK.

```
myapp/
  app.json
  icon.svg          the icon, drawn on the app's colour
  background.jpg    optional: shown behind the home screen when the app is selected
  index.html
  app.js
```

## app.json

```json
{
  "id": "myapp",
  "name": "My App",
  "version": "1.0.0",
  "subtitle": "One line under the name on the home screen",
  "description": "What it does, for the Store.",
  "author": "You",
  "category": "Watch",
  "color": "#3b2a7a",
  "icon": "icon.svg",
  "background": "background.jpg",
  "entry": "index.html",
  "mode": "fullscreen",
  "settings": true,
  "provides": ["rows", "search"],
  "service": "index.html"
}
```

- `id`: lowercase letters, digits and dashes. It's the app's origin, so it must not change.
- `mode`: `fullscreen` or `window` (a panel over the home screen).
- `settings`: the app has a settings page; its options get **Settings for My App**, which
  opens the app with `pbs.open === 'pbs:settings'`.
- `provides`: the app adds home rows and/or search results (see below). The launcher keeps a
  hidden copy of the app (`service`, or `entry`) loaded to ask it.

## The SDK

```html
<link rel="stylesheet" href="/__pbs/pbs.css">   <!-- optional: the launcher's look -->
<script src="/__pbs/sdk.js"></script>
```

`window.pbs`:

| | |
|---|---|
| `pbs.ready` | Resolves with `{ app, platform, device, tv, accent, look, mode, open }` once the launcher answered. |
| `pbs.mode` | `fullscreen`, `window` or `service` (the hidden copy). |
| `pbs.open` | What the launcher opened the app for: a home row item's or search result's `id`, `pbs:settings`, or null. |
| `pbs.http(url, { method, headers, body, as, timeout })` | A web request made by the device, so CORS doesn't apply and cookies are kept (on Android, shared with `openWeb`). `as: 'base64'` for pictures; `timeout` in milliseconds (30 s if not given). Resolves `{ status, headers, body }`; `status` 0 means no answer. |
| `pbs.scan({ port \| ports, path })` | Finds servers on the home network: asks every address next to the device on up to four ports for `path`, and resolves `[{ url, body }]` for those that answered 200. Takes a few seconds. |
| `pbs.json(url, opts)` | `http` that reads JSON and throws on an error status (`err.status`, `err.body`). |
| `pbs.storage.get(key)` / `.set(key, value)` / `.remove(key)` | The app's own saved values (any JSON). Other apps can't read them. |
| `pbs.play({ url, title, subtitle, headers, start })` | Plays in the device's own player. Resolves `{ position, duration, ended }` (seconds) when it's closed. |
| `pbs.openWeb(url)` | Opens a web page full screen, sharing the device's cookies (so a sign-in made with `pbs.http` counts). Back goes back in the page, then closes it; resolves when closed. The page's user agent ends with `PlayBigScreen/<version>`, plus ` TV` on TVs. |
| `pbs.close()`, `pbs.setTitle(text)`, `pbs.toast(text)` | |
| `pbs.onBack(fn)` | Back (the remote's Back, Escape, Backspace). Return `true` when the app used it; otherwise the app closes. |
| `pbs.provide('rows', fn)` / `pbs.provide('search', fn)` | In the service copy: answer the launcher. |
| `pbs.refreshRows()` | Ask the launcher to fetch the rows again (after signing in, say). |
| `pbs.nav` | Arrow keys move between buttons, links and fields by where they are on screen, and held keys move at a steady pace. Mark a row of cards or a menu with `data-pbs-line`: in it, the keys go one step at a time in order (nothing skipped), and coming back into it returns to where you were. Put `data-pbs-autofocus` on what should start selected and `data-pbs-scope` on an open panel to keep the keys inside it. `pbs.nav.disable()` turns it off. |

### Rows and search

```js
if (pbs.mode === 'service') {
  pbs.provide('rows', async () => [
    { id: 'continue', title: 'Continue watching', shape: 'wide',   // or 'poster', 'square'
      items: [{ id: 'abc', title: 'Dune', subtitle: '2021', image: 'https://…', backdrop: 'https://…', progress: 0.4 }] },
  ]);
  pbs.provide('search', async ({ query }) => [{ id: 'abc', title: 'Dune', image: '…' }]);
}
```

Pictures can be addresses or `data:` URLs. When an item is chosen, the app opens with
`pbs.open` set to its `id`.

## Trying it

Run the browser host (`node host/server.mjs`), serve a repository with your app (next
section) and add it in Settings → Repositories. In the browser host, `openWeb` and `play`
show the page or video over the launcher.

## Publishing

Put the folder in a repository's `apps/` and run `node tools/repoindex.mjs <repository>`,
which lists every file with its sha256 in `index.json`. See [REPOSITORIES.md](REPOSITORIES.md).
