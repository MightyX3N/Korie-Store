# Repositories

The Store shows what's in the repositories listed in Settings → Repositories. A repository is
an `index.json` on any web server (GitHub works), made from a folder by
`node tools/repoindex.mjs <folder>`:

```
repository/
  repository.json      { "name": "…", "description": "…" }
  apps/<id>/…          launcher apps (see APPS.md)
  apks.json            Android apps
  icons/…              icons for the Android apps
  index.json           written by tools/repoindex.mjs
```

`apks.json` lists Android apps by where their APK is:

```json
[
  {
    "package": "io.github.mightyx3n.playtheater",
    "name": "PlayTheater for Android",
    "subtitle": "One line",
    "description": "For the Store.",
    "author": "PlayTheater",
    "icon": "icons/playtheater.svg",
    "color": "#2c1a2f",
    "version": "0.9.0",
    "versionCode": 900,
    "url": "https://github.com/…/PlayTheater-0.9.0.apk",
    "sha256": "…",
    "size": 5754663
  }
]
```

`url` and `icon` can be relative to `index.json`. The launcher downloads the APK, checks its
sha256, and hands it to Android, which asks the person to confirm. An update shows when
`versionCode` is higher than the installed app's.

For launcher apps, `index.json` lists every file with its sha256; the launcher checks each
one and only swaps the app in when all match. An update shows when `version` is higher than
the installed one.

Linux apps will be a third list here when the Linux version comes.

`--check` fails when `index.json` is out of date (the build runs it), so run the tool after
changing anything in the folder.
