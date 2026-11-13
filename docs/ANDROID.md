# PlayBigScreen on Android

Android 7 or newer, on TVs, TV boxes, tablets and phones.

## Making it the home screen

1. Install the APK and open PlayBigScreen once.
2. Press Home. If Android asks which app to use, choose PlayBigScreen and **Always**.
   Settings → This device → **Choose the home app** opens the same choice later.

Many TVs (Google TV, Fire TV and others) don't ask and keep their own home screen. Two ways
around it:

- A tool that turns off the TV's own launcher (with adb, or an app made for it). Android then
  asks for a new home app, and PlayBigScreen is one.
- PlayBigScreen's **Home button helper**: Settings → This device → **Turn on the Home button
  helper** opens Accessibility; turn on *PlayBigScreen Home button*. Whenever the TV's own
  home screen comes up, PlayBigScreen opens over it. It only looks at which app's window
  opened, nothing else on screen.

When PlayBigScreen isn't the home app, Back on its home screen goes back to the other one.

## Installing Android apps from the Store

The first time, Android asks to allow PlayBigScreen to install apps; the Store opens that
setting for you. After that, Android shows its own confirmation for every install and
uninstall.

## Remote and keys

Arrows move, OK opens, holding OK (or Menu) opens an app's options, Back goes back. In
launcher apps the SDK gives the same arrow-key movement. A mouse, keyboard or touch work too.
