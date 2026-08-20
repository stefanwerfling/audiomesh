# Vendored lib-jitsi-meet

This directory holds the **official** `lib-jitsi-meet` browser bundle, vendored so
AudioMesh can run a headless Jitsi bot in Node. It is **not our code** — it is
Jitsi's Apache-2.0 library (see `lib-jitsi-meet.min.js.LICENSE.txt`) — but we own
*which build we ship* and can update it independently.

## Why vendored (not npm)

The npm `lib-jitsi-meet` is frozen at the deprecated 1.0.6 (2022) and crashes on
load under Node/jsdom. npm itself says "not distributed via npm, use the source".
Every Jitsi deployment serves its exact, already-built bundle at
`<server>/libs/lib-jitsi-meet.min.js` — so we vendor that, guaranteeing the client
matches the server's bridge version.

## Update it

```
npm run update:jitsi-lib -w @audiomesh/backend -- https://<your-jitsi>
# default source is meet.jit.si if no URL is given
```

That refreshes `lib-jitsi-meet.min.js` (+ LICENSE) and records provenance in
`version.json` (source, bytes, sha256, timestamp). Commit the result.

## How it's loaded

`src/Platform/Adapters/Jitsi/JitsiRuntime.ts` installs a minimal browser
environment (jsdom + `@roamhq/wrtc` + `ws`, a `navigator.mediaDevices` stub, and a
few DOM globals), then `require()`s this CommonJS bundle and returns `JitsiMeetJS`.
`package.json` here pins `"type": "commonjs"` so the bundle loads as CJS inside the
ESM backend. That thin shim is the only part we maintain.
