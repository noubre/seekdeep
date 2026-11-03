# Release builds

The Debug build is the development loop (`npm run native:dev:app`). This file is what a
Release build needs and what is still missing.

## Build and run

```bash
npm run native:app:release      # xcodegen + xcodebuild -configuration Release
open build/Build/Products/Release/SeekDeep.app
```

A Release build runs the **embedded** worklet: `app/app.bundle` is started by BareKit
inside the app process, no `node` child, no Node install required. Confirm it with
`SEEKDEEP_*` unset and the log line:

```
[seekdeep] transport: embedded worklet, args=[]
[seekdeep] worker ready, room=<64 hex>
```

## Signing: what is true today

- The app is **ad-hoc signed** (`CODE_SIGN_IDENTITY: "-"`), because no Developer ID
  identity exists on this machine (`security find-identity -v -p codesigning` → *0 valid
  identities*).
- The bare addons in `app/addons/*.framework` are prebuilt and signed by the Holepunch
  team. An ad-hoc host fails library validation against them, so
  `com.apple.security.cs.disable-library-validation` is set in the entitlements. Without it
  the Release app dies at launch with a dyld/library-validation error and no window — which
  looks like a hang, not a signing problem.
- Entitlements required regardless: `allow-jit` and `allow-unsigned-executable-memory`
  (V8 under the hardened runtime).

## Signing: what shipping needs

Two paths, decide before the first public build:

1. **Re-sign the addons** with our Developer ID, then drop
   `disable-library-validation`. Cleanest, and App Store-adjacent review tooling prefers it.
2. **Keep the exception**, sign the app with a Developer ID, notarize. Works, but the
   exception stays in the entitlement list forever and gets flagged in review of the
   entitlements.

Either way the machine that builds for release needs a Developer ID Application
certificate plus a `notarytool` keychain profile:

```bash
codesign --force --options runtime --deep --sign "Developer ID Application: <NAME>" \
  build/Release/SeekDeep.app
ditto -c -k --keepParent build/Release/SeekDeep.app /tmp/SeekDeep.zip
xcrun notarytool submit /tmp/SeekDeep.zip --keychain-profile seekdeep --wait
xcrun stapler staple build/Release/SeekDeep.app
```

## Architectures

`bare-link` emits one framework per addon per arch. Check what shipped before promising a
universal binary; if only arm64 is present, say **arm64-only** in the release notes rather
than shipping an app that fails to dlopen on Intel.

```bash
lipo -archs app/addons/bare-buffer.3.7.1.framework/Versions/A/bare-buffer
```

## Known limitations

- Unsandboxed (the DHT's UDP sockets and process spawn need it). App Store distribution
  would mean moving the worklet into an app extension — a separate project.
- Room history is local only; there is no protocol-level message persistence.
- Release has no `SEEKDEEP_AUTOSEND` smoke hook (it is `#if DEBUG`), so automated
  end-to-end checks in Release stop at "worker ready, room=…".
