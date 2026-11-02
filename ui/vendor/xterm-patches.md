# Local xterm.js patch

`xterm.min.js` is the existing xterm.js 5.3.0 bundle. Two local guards have been added to `Viewport._innerRefresh()` and `Viewport.syncScrollArea()`:

```js
if (this._isDisposed) return;
```

Rapidly closing a newly rendered SSH tab exposed a queued animation frame reading the disposed renderer's dimensions. The guards also cover the initial timeout and reset's queued refresh, while retaining immediate terminal disposal and backend process cleanup. No application-level private API access or artificial disposal delay is used.

Source: [Viewport.ts](https://github.com/xtermjs/xterm.js/blob/5.3.0/src/browser/Viewport.ts) and [Lifecycle.ts](https://github.com/xtermjs/xterm.js/blob/5.3.0/src/common/Lifecycle.ts). Reassess these guards when upgrading the bundled terminal. `tools/ui_smoke.cjs` exercises SSH start, multiple sessions, disconnect, reconnect, bulk tab close, and rejects any browser script errors.
