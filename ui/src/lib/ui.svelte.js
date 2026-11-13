// Which page is showing, and what's selected on the home screen (for the big title).
export const ui = $state({
  page: 'home', // home, recents, apps, store, search, settings
  quick: false, // quick settings open
  menu: null, // { app, x, y } options for an app
  moving: null, // app key being moved on the home row
  focus: null, // { kind: 'app', app } or { kind: 'item', item, app }
  settingsSection: 'look',
  lastQuery: '',
});

export function go(page) {
  ui.page = page;
  ui.quick = false;
  ui.menu = null;
  ui.moving = null;
}
