# SeekDeep native rewrite — Swift shell over an embedded Bare core

**Status:** in progress — branch `native`
**Author:** Hermes (analysis of `~/pearprojects/seekdeep` @ `5a492a2`)
**Target reader:** an implementer with zero familiarity with this repo who will follow
steps literally. If a step is ambiguous, that is a bug in this document — fix the
document in the same commit as the code.

### Progress

| Phase | Tasks | State |
|---|---|---|
| 0. Repo hygiene + toolchain proof | 0.1–0.4 | **done** (`e3f5478`, `10642f7`, `efcb1b4`) |
| 0.5 BareKit embedding proof | 0.5 | **done** (`ff9ce8c`) — app boots the worklet and answers RPC |
| 1. The worklet | 1.1–1.4 | **done**, with the deviations noted at each task |
| 2. `SeekDeepCore` | 2.1–2.10 | **done** (`e228ae3`…`855b316`) — 66 swift tests, 0 failures |
| 3. SwiftUI shell + chat MVP | 3.1–3.5 | **done** (`e77b56d`) — window, room, streamed answer |
| 4. Fidelity | — | next |
| 5–7 | — | not started |

Deviations from the code below that actually shipped are called out inline as
**As built:** notes. Trust those over the original snippet.

---

## Table of contents

1. [Goal](#1-goal)
2. [Executive decision](#2-executive-decision)
3. [Current context](#3-current-context)
4. [Swift vs Rust — the honest comparison](#4-swift-vs-rust--the-honest-comparison)
5. [Proposed architecture](#5-proposed-architecture)
6. [Repository layout](#6-repository-layout)
7. [The RPC wire contract (read this before writing Swift)](#7-the-rpc-wire-contract)
8. [Phase 0 — repo hygiene + toolchain proof](#phase-0--repo-hygiene--toolchain-proof)
9. [Phase 1 — the worklet (JS entry, Node-testable)](#phase-1--the-worklet)
10. [Phase 2 — `SeekDeepCore` SwiftPM package](#phase-2--seekdeepcore-swiftpm-package)
11. [Phase 3 — SwiftUI shell + chat MVP](#phase-3--swiftui-shell--chat-mvp)
12. [Phase 4 — fidelity (markdown, slash, history, polish)](#phase-4--fidelity)
13. [Phase 5 — packaging, signing, CI](#phase-5--packaging-signing-ci)
14. [Phase 6 — parity verification and cutover](#phase-6--parity-verification-and-cutover)
15. [Phase 7 — retire the Electron renderer (blocked on approval)](#phase-7--retire-the-electron-renderer-blocked-on-approval)
16. [Tests and validation strategy](#15-tests-and-validation-strategy)
17. [Risks, tradeoffs, open questions](#16-risks-tradeoffs-open-questions)
18. [Appendix A — the Rust path, spelled out](#appendix-a--the-rust-path-spelled-out)
19. [Appendix B — RPC method reference](#appendix-b--rpc-method-reference)

---

## 1. Goal

Replace SeekDeep's Electron/HTML renderer with a native macOS app without breaking
wire compatibility with the existing P2P rooms, and do it in a way a single
implementer can finish in ~3 focused weeks.

---

## 2. Executive decision

**Build a SwiftUI application that embeds the existing JavaScript P2P core inside a
Bare worklet, and talk to it over the JSON-RPC pipe the code already speaks.**

Concretely:

- **Rewritten natively (Swift):** the entire renderer — `index.html`, `css/app.css`,
  `js/main.js`, `js/ui/**`, `js/messages/**`, `js/session/**`, `js/chat-client.js`
  (≈ 1.9k lines of JS + 882 lines of HTML/CSS) plus a Swift port of the *display*
  logic. That is the part the user actually feels.
- **Kept as-is (JS, bundled into the app):** `js/p2p/**` (3 450 lines — Hyperswarm,
  HyperDHT, Hyperdrive, Corestore, Localdrive, Mirror, Hyperbeam), `js/llm/**` (763),
  `js/slash/**` (1 754), `js/harness/**` (848), and all 44 test files (6 478 lines).
  These run unchanged, inside the app, on their own thread.
- **Never ported:** the Electron shell (`index.js`, `pear-electron`, `pear-bridge`,
  `pear-ctrl`), because SwiftUI *is* the shell. `server.js`, `bridge.js`, `tui.js` and
  the `js/openai/**` HTTP surface stay as Node CLIs.
- **Same repository, same history.** The app is pre-1.0 and unreleased, so this is a
  migration *inside* `~/pearprojects/seekdeep` on a branch, not a fork or a new repo.
  `core/`, `app/`, `worklet/` and `project.yml` are added at the repo root; the Pear
  entry points keep working untouched until the very last phase, which deletes them
  after parity is signed off.

Why not Rust: the network layer has no Rust equivalent. `hyperswarm`/`hyperdht` do
have a wire-compatible Rust port (`peeroxide` 1.7.4), but `hyperdrive`, `corestore`,
`localdrive`, `mirror-drive` and `hyperbeam` do not exist in Rust at all — the only
`hyperdrive` crate on crates.io is an unrelated 2019 HTTP-routing library, and the
`hypercore` crate is `0.17.0-alpha.1` while this app uses Hypercore 10/11 via
`hyperdrive@13`/`corestore@7`. A Rust rewrite therefore deletes `/drive`,
`/localdrive`, `/mirror` and `/beam` — the majority of the slash-command surface —
and breaks compatibility with every existing peer. Section 4 and Appendix A carry
the full argument and the cost.

---

## 3. Current context

### 3.1 What the app is

A P2P chat room where one peer ("the host") owns a local LLM (Ollama on
`:11434`, LM Studio on `:1234`) and every other peer in the Hyperswarm topic streams
inference from it. Peers can also run a local OpenAI-compatible HTTP bridge.

### 3.2 Process architecture today

```
┌──────────────────────────────┐        ┌─────────────────────────────────────┐
│ Chromium renderer            │  pipe  │ Bare worker (separate process)      │
│ index.html + js/main.js      │◄──────►│ js/p2p/worker-runtime.js            │
│ js/ui/**, js/messages/**     │ JSON-  │  ├── chat-service  (Hyperswarm)     │
│ js/session/**, js/chat-client│ RPC,   │  ├── hyperdrive/localdrive/mirror   │
│                              │ \n-    │  ├── beam, bot, harness (plugins)   │
│ (no Node APIs, CSP-locked)   │ framed │  └── provider router (Ollama/LMStudio)
└──────────────────────────────┘        └─────────────────────────────────────┘
        ▲                                            ▲
        │ pear-electron Runtime.start({bridge})      │ Hyperswarm (Noise/UDP)
        └── index.js (Electron main, pear-bridge)    └── other peers
```

The critical property: **the renderer already speaks only JSON-RPC.** `js/main.js`
never touches a socket. That is what makes this rewrite tractable — the seam already
exists, and the native app just becomes another client of the same seam.

### 3.3 Inventory (measured, not estimated)

| Area | Path | Lines | Files | Fate |
|---|---|---|---|---|
| P2P services | `js/p2p/**` | 3 450 | 14 | **keep** (bundled into worklet) |
| Slash engine | `js/slash/**` | 1 754 | 20 | **keep** |
| OpenAI HTTP surface | `js/openai/**` | 1 318 | 9 | keep, out of scope (CLI only) |
| UI modules | `js/ui/**` | 1 128 | 8 | **delete** (SwiftUI replaces) |
| Terminal UI | `js/tui/**` | 851 | 7 | keep as-is (Node CLI) |
| Harness/plugins | `js/harness/**` | 848 | 7 | **keep** |
| LLM adapters | `js/llm/**` | 763 | 7 | **keep** |
| Session/storage | `js/session/**` | 478 | 3 | **replace** (Swift `SessionStore`) |
| Message store | `js/messages/**` | 305 | 4 | **replace** (Swift reducer) |
| Runtime glue | `js/runtime/**` | 78 | 1 | keep |
| Renderer entry | `js/main.js`, `js/chat-client.js` | ~110 | 2 | **delete** |
| Markup + CSS | `index.html`, `css/app.css` | 882 | 2 | **delete** (SwiftUI replaces) |
| Plugins | `plugins/**` | 120 | 3 | **keep** |
| Tests | `test/**` | 6 478 | 44 | **keep** (they are the core's safety net) |

### 3.4 Constraints and assumptions

- **A1 — Wire compatibility is required.** Existing peers must be able to join a room
  created by the native app and vice versa. No protocol changes in this project.
- **A2 — The JS core is the source of truth for behaviour.** If Swift and JS disagree,
  JS wins. Do not "improve" the protocol while porting.
- **A3 — One repo, one branch.** All work lands in this repository on a branch named
  `native`. The Pear/Electron entry points stay runnable (`pear run .`) until Phase 7,
  so the old app can be used to test interop at any moment.
- **A4 — macOS only.** Deployment target macOS 14.0 (needed for
  `AsyncStream.makeStream`). No iOS, no Windows, no Linux in this plan.
- **A5 — Toolchain, verified on this machine on 2026-11-02:**
  `swift 6.2.4`, `Xcode 26.3`, `xcodegen 2.45.4`, `gh 2.92.0`, `node v22.23.4`
  (matches `.nvmrc` and `engines.node`). **`bare` (the standalone CLI) is NOT
  installed and is not required** — `BareKit` embeds the runtime; `bare-link` and
  `bare-pack` come from `devDependencies`. `git` is on branch `Fix-Streaming`, 8
  commits ahead of origin, with 109 uncommitted files (Task 0.1 deals with this).
- **A6 — No new product features.** Text chat, streaming, provider/model selection,
  private/collaborative mode, `/` commands, saved history, room join. Nothing else.
- **A7 — Ollama must be running for the manual E2E checks** (`ollama serve`, one model
  pulled). CI never needs a model; it uses a fake provider.

---

## 4. Swift vs Rust — the honest comparison

### 4.1 The three real options (not two)

"Swift vs Rust" hides a third axis: *how much of the existing core survives*.

| | **A. Swift + embedded Bare (chosen)** | **B. Swift + Node sidecar process** | **C. Pure Rust** |
|---|---|---|---|
| Native UI | yes (SwiftUI) | yes | yes (egui/Tauri/SwiftUI+UniFFI) |
| Core language | JS in-process | JS out-of-process | all Rust |
| Ships without Node installed | **yes** (`bare-pack` bundle) | no | yes |
| Wire-compatible with existing rooms | **yes, byte-identical** | yes | chat-plane only; drives/beams break |
| Needs Hyperdrive/Hypercore in the new language | no | no | **impossible today** |
| App Sandbox / App Store viable | yes (with entitlements) | no | yes |
| Dev loop speed | medium (rebuild bundle) | **fast** | slow (whole stack) |
| Time to reach feature parity | **~3 weeks** | ~2 weeks | 3–6 months |
| Risk | additive-nothing strategy | process lifecycle/orphans | protocol reimplementation |

Option B is not a shipping architecture (an `.app` that requires a user-installed
Node is not a native app), but **it is an excellent development transport** and this
plan uses it: the same Swift client talks to a spawned `node worklet/dev.js --stdio`
during development and to a `BareKit` worklet in the shipped build. One protocol, two
transports, no divergence. See §5.4.

### 4.2 Swift vs Rust on the merits, for *this* codebase

**Where Rust wins, genuinely:**

- Memory and CPU per idle peer: a Bare/V8 worklet idles around 25–45 MB RSS; a Rust
  peer would idle under 10 MB. SeekDeep's stated ceiling is 5–20 peers per room, so
  this does not bind.
- Single static binary, no V8, no JIT entitlement, no 40–80 MB runtime bundled.
  Real, and it matters for distribution polish.
- Type safety for the protocol: a `serde`-tagged enum makes illegal frames
  unrepresentable; today `js/p2p/protocol.js` hand-validates 231 lines of it at
  runtime.
- It is the only option that ends the dual-language build.

**Where Rust loses, decisively, for this repo:**

- **The storage/p2p stack does not exist.** See §4.3. This is not a "more work"
  problem, it is a "the product loses features" problem.
- **The plugin system is a JS contract.** `plugins/*/index.js` export default objects
  with `handler(parsed, services)`; users author them on disk and sync them over a
  Hyperdrive (`/harness create|join|push|pull`). A Rust core needs a new plugin ABI,
  a new sync format, and a new on-disk convention — a rewrite of `/harness`, not a
  port.
- **The slash surface is 1 754 lines of validated behaviour with 20 test files.**
  Every command must be re-verified against the JS implementation anyway.
- **Nobody on this project can maintain a hand-rolled Noise/UDP/BLAKE2 stack.** If
  `peeroxide` stalls (one org, 5.7k downloads), the app is stuck.

**Where Swift wins:**

- `bare-kit` is the *vendor-supported* way to do exactly this, with a reference app:
  `holepunchto/bare-macos` embeds Bare inside a SwiftUI app, runs Hyperswarm on a
  worklet thread, and talks typed RPC. The path is paved.
- SwiftUI gives AppKit-quality text, native menus, system appearance, accessibility,
  and a 720×540 window that does not look like a web page.
- Swift's toolchain is on every Mac; `swift test` on a pure-logic package is a fast,
  dependency-free TDD loop (this plan puts ~80 % of the new code there).
- App Sandbox / notarization / App Store are known quantities.

### 4.3 The blocking facts for Rust (verified)

| Need | JS (today) | Rust reality |
|---|---|---|
| Peer discovery + connections | `hyperswarm@4.6`, `hyperdht@6.33` | `peeroxide@1.7.4` — wire-compatible port, DHT + Noise + holepunch. **Usable.** |
| Append-only log | `hypercore@10/11` (via `corestore@7.12`) | `hypercore` crate `0.17.0-alpha.1` (datrs). Alpha, not protocol-compatible with HC10. |
| P2P filesystem | `hyperdrive@13.3` | **none** (crates.io `hyperdrive` is HTTP routing, 2019) |
| Key/value tree | `hyperbee` (implicit, via drive) | `hyperbee` crate `0.5.0`, last published 2024, tied to datrs hypercore |
| Local disk mapping | `localdrive@2.2` | **none** |
| Drive mirroring | `mirror-drive@1.14` | **none** |
| One-shot streams | `hyperbeam@3.1` | **none** |
| Plugin harness | JS modules on disk + Hyperdrive sync | must be redesigned |

Consequence: a Rust core can serve `/p2p`+chat+`/bot` on the chat plane, but
`/drive`, `/localdrive`, `/mirror`, `/beam` and `/harness` (the biggest single plugin,
`plugins/p2p-core/index.js` + `js/slash/tags/*`) are simply gone. That is a product
regression, not a port.

**Therefore: Swift (Option A).** Rust remains the right answer *if and only if* the
requirement becomes "no JavaScript runtime in the process at any cost" — Appendix A
is the plan for that world, including what it costs.

---

## 5. Proposed architecture

### 5.1 Three layers, one seam

```
┌──────────────────────────────────────────────────────────────────────┐
│ SeekDeep.app  (SwiftUI, main thread)                                 │
│  Views ──► ChatViewModel ──► ChatReducer (pure) ──► ChatState         │
│                    │                                                 │
│                    └──► RPCClient (actor, newline JSON-RPC)           │
│                              ▲                                       │
│                    WorkletTransport (protocol)                        │
│                     ├── BareTransport   (BareKit IPC, shipped)        │
│                     └── ProcessTransport (node, dev + integration)    │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ newline-delimited JSON, 128 KiB frames
┌──────────────────────────────▼───────────────────────────────────────┐
│ Bare worklet (its own thread, same process in release)               │
│  worklet/backend.js → createWorkerBackend(Bare.IPC, …)               │
│  = js/p2p/worker-runtime.js (vendored, unchanged)                    │
│  = Hyperswarm + Hyperdrive + localdrive + mirror + beam + harness    │
│  = provider router → Ollama / LM Studio                              │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.2 What the Swift side owns

1. **Presentation** — one window, 720×540 default (matching `package.json`'s GUI size),
   `#1F2430` background (matching `css/app.css`).
2. **A pure reducer** — the same state machine as `js/session/client-state.js` +
   `js/messages/store.js` + `js/messages/stream.js`, ported once, tested with the
   literal JSON the worker emits.
3. **Persistence** — `~/Library/Application Support/SeekDeep/sessions/*.json`, a
   semantic port of `js/session/storage.js` (which used `localStorage`).
4. **Input affordances** — `/` palette (command list from `slash.list`), Enter to send,
   Shift+Enter newline, ⌘C for topic.
5. **Markdown rendering** — block splitter + `AttributedString(markdown:)` inline.

### 5.3 What stays in JS, verbatim

`createWorkerBackend` from `js/p2p/worker-runtime.js`. Not a copy, not a fork, not a
package dependency — the worklet entry imports it with a relative path
(`../js/p2p/worker-runtime.js`) because it lives in the same repository. One source of
truth for the core, forever, and no symlink or version pin to drift.

### 5.4 Why a Bearer of transports matters

`RPCClient` never imports `BareKit`. That is what makes:
- unit tests run in `swift test` with a scripted transport (no Xcode app, no V8),
- integration tests spawn `node worklet/dev.js --stdio` in CI,
- the shipped app use `BareTransport`.

The process transport is **dev + test only** and must be compiled behind
`#if DEBUG` in the app target.

---

## 6. Repository layout

Everything below is added to the existing repository at `~/pearprojects/seekdeep`, on
branch `native`. Nothing is moved: the current renderer keeps its paths until Phase 7.

```
seekdeep/                                   # existing repo, branch: native
├── core/                                   # NEW — SwiftPM package "SeekDeepCore"
│   ├── Package.swift
│   ├── Sources/SeekDeepCore/
│   │   ├── JSONValue.swift
│   │   ├── RPCFrame.swift
│   │   ├── RPCNotification.swift
│   │   ├── RPCClient.swift
│   │   ├── SerialWriter.swift
│   │   ├── WorkletTransport.swift
│   │   ├── WorkerEvent.swift
│   │   ├── ChatState.swift
│   │   ├── ChatReducer.swift
│   │   ├── Thinking.swift
│   │   ├── MarkdownBlocks.swift
│   │   ├── SlashQuery.swift
│   │   ├── Transcript.swift
│   │   └── SessionStore.swift
│   └── Tests/SeekDeepCoreTests/
│       ├── JSONValueTests.swift
│       ├── RPCFrameTests.swift
│       ├── RPCClientTests.swift
│       ├── SerialWriterTests.swift
│       ├── WorkerEventTests.swift
│       ├── ChatReducerTests.swift
│       ├── ThinkingTests.swift
│       ├── MarkdownBlocksTests.swift
│       ├── SlashQueryTests.swift
│       ├── TranscriptTests.swift
│       └── SessionStoreTests.swift
├── app/                                    # NEW — SwiftUI application
│   ├── SeekDeepApp.swift
│   ├── ContentView.swift
│   ├── Views/{MessageList,MessageRow,Composer,TopBar,JoinBar,Sidebar,EphemeralBanner,EmptyState}.swift
│   ├── ViewModels/ChatViewModel.swift
│   ├── Services/{BareTransport,ProcessTransport,WorkletHost}.swift
│   ├── Style/Theme.swift
│   ├── Info.plist
│   ├── SeekDeep.entitlements
│   ├── frameworks/                         # gitignored: BareKit.xcframework
│   ├── addons/                             # gitignored: bare-link output
│   └── app.bundle                          # gitignored: bare-pack output
├── worklet/                                # NEW — JS entry points (packed into the app)
│   ├── pipe-adapter.js
│   ├── worklet.js                          # shared boot: pipe + backend
│   ├── backend.js                          # Bare entry (Bare.IPC + bare-fs)
│   └── dev.js                              # Node entry (stdio), dev + tests
├── project.yml                             # NEW — xcodegen spec (repo root: pre-actions use ${PWD})
├── test/                                   # EXISTING, extended
│   ├── worklet-pipe-adapter.test.js        # NEW — rides `npm test` automatically
│   ├── worklet-boot.test.js                # NEW
│   ├── worklet-dev-entry.test.js           # NEW
│   └── … 44 existing files, untouched
├── js/, plugins/, scripts/, css/, lib/     # EXISTING, untouched
├── index.js, index.html, server.js, bridge.js, tui.js   # EXISTING, untouched until Phase 7
└── package.json                            # EXTENDED: scripts + 2 devDependencies
```

**Why the worklet tests live in `test/` and not `worklet/test/`:** `scripts/run-tests.mjs`
globs `test/*.test.js` at the top level only (line 14) and spawns each file in its own
process. Naming them `test/worklet-*.test.js` means `npm test` and the existing ubuntu CI
job cover the new code with **zero runner changes** — and `scripts/check-dependencies.mjs`
still gates the lockfile.

**Hard rules for the implementer:**

1. Do not create a file that is not in the tree above without adding it here first.
2. Do not move, rename, or reformat any existing file. The diff must be additive until
   Phase 7.
3. Do not add a `worklet/package.json`: the repo root is already `"type": "module"`, and
   a nested manifest would break `bare-pack`'s resolution.
4. Do not touch `index.html`, `css/`, `js/ui/`, `js/main.js`, or `js/chat-client.js`.

## 7. The RPC wire contract

Read `js/p2p/rpc-codec.js` and `js/p2p/rpc-server.js` once before writing Swift. The
contract, exactly:

### 7.1 Framing

- UTF-8, one JSON object per line, `\n` terminated.
- Max frame 128 KiB (`DEFAULT_MAX_MESSAGE_BYTES`), max aggregate buffered 512 KiB.
- Requests are handled serially by the worker (`chain = chain.then(...)`), so a slow
  request blocks the next one. Do not pipeline.

### 7.2 Request → worker

Exactly three keys, all required. No extra fields — the server rejects them.

```json
{"id":"1","method":"chat.send","params":{"prompt":"hi","model":"qwen3"}}
```

`id` is a non-empty string ≤ 64 chars. Use `"1"`, `"2"`, `"3"`…

### 7.3 Worker → response

Success, exactly three keys:

```json
{"id":"1","ok":true,"result":{"requestId":"m1-1"}}
```

Failure, exactly three keys (`error` is a string, or `{code,message}` only for codes
prefixed `LOCALDRIVE_`/`MIRROR_`):

```json
{"id":"1","ok":false,"error":"Not connected to a host"}
```

### 7.4 Worker → event (unsolicited, exactly two keys)

```json
{"event":"chat.event","data":{"type":"response","requestId":"m1-1","chunk":"Hello","done":false}}
{"event":"harness.event","data":{"type":"slash","content":"No peers.","metadata":{"kind":"slash-help"}}}
```

Event names in use: `chat.event`, `harness.event`. Nothing else.

### 7.5 `chat.event` payloads (from `js/p2p/chat-service.js`)

| `data.type` | Shape after `type` |
|---|---|
| `status` | `{topic, role, connected, peerCount, collaborative, provider}` (+ `publicKey` if from `chat.status`) |
| `peers` | `{peers:[{id, displayName, role:"host"\|"peer"}]}` |
| `mode` | `{collaborative:Bool}` |
| `models` | `{provider:String, models:[{id,name,created?}]}` |
| `message` | `{message:{id, type:"user"\|"assistant"\|"system", content, timestamp, fromPeer?, requestId?}}` |
| `response` | `{requestId, chunk:String, done:Bool, error?:String}` |
| `chat_response` | `{requestId, kind:"text"\|"tool_call"\|"done"\|"error", …}` (HTTP bridge only) |

### 7.6 `harness.event` payloads (from `js/harness/harness.js`)

| `data.type` | Shape |
|---|---|
| `slash` | `{content:String, metadata:{kind, command, action, …}}` |
| `bot` | `{kind:"message"\|"reply", text, from?, fromName?}` |
| `plugin` | `{status, plugin, source, message?}` |

The old renderer's mapping, which the Swift reducer must reproduce exactly
(`js/main.js:46-61`): `harness.event` + `type == "slash"` → **ephemeral** message
(rendered as a dashed box, not added to the transcript); `type == "bot"` → system
message; `chat.event` + `type == "message"` → transcript; `type == "response"` →
append chunk to the assistant message for that `requestId`.

---

## Phase 0 — repo hygiene + toolchain proof

Two goals: get the tree to a known-good, pushed state so every later commit is
reviewable, and prove `bare-pack` can bundle *this* core before anyone writes Swift.

### Task 0.1 — Branch, and checkpoint the working tree

The tree is dirty (109 files) and `Fix-Streaming` is 8 commits ahead of origin. Do not
push that branch: the migration gets its own branch, with the existing work checkpointed
as its first commit so every later diff is reviewable.

```bash
cd ~/pearprojects/seekdeep
git status --short | wc -l
```
Expected: `109`

```bash
git switch -c native
git add -A
git commit -m "chore: checkpoint working tree before native migration"
git status --short
git branch --show-current
```
Expected: `git status --short` prints nothing; `git branch --show-current` prints
`native`. `Fix-Streaming` is untouched and still 8 ahead — that is intentional.

> If `git switch -c native` fails because the branch exists, use `git switch native` and
> verify it is at `5a492a2` or later (`git log --oneline -1`).

Commit: (the checkpoint commit above)

### Task 0.2 — Baseline the existing suite

```bash
cd ~/pearprojects/seekdeep && npm test 2>&1 | tail -2
```
Expected: `All 44 test files passed.`

Write that number down. It is the regression gate for every task in this plan.

### Task 0.3 — Add the worklet toolchain to the existing manifest

Extend `package.json` (do **not** rewrite it — edit in place so the diff shows only the
new lines). Add to `scripts`:

```json
    "native:core": "cd core && swift test",
    "native:pack": "bare-pack --preset darwin --linked --base . --out app/app.bundle worklet/backend.js",
    "native:link": "bare-link --preset darwin --out app/addons .",
    "native:app": "xcodegen generate && xcodebuild -scheme SeekDeep -derivedDataPath build build",
    "native:run": "open build/Build/Products/Debug/SeekDeep.app",
    "native:dev": "node worklet/dev.js --stdio"
```

Add to `devDependencies` (alphabetical, matching the file's existing order):

```json
    "bare-link": "^3.2.2",
    "bare-pack": "^2.1.0",
```

Append to `.gitignore`:

```gitignore
# native build artifacts
build/
core/.build/
core/.swiftpm/
app/SeekDeep.xcodeproj/
app/app.bundle
app/addons/
app/frameworks/
```

```bash
cd ~/pearprojects/seekdeep && npm install --ignore-scripts && node -e "console.log(require('./package.json').devDependencies['bare-pack'])"
```
Expected: `npm install` reports `added N packages` (N ≥ 2); the last line prints
`^2.1.0`.

```bash
cd ~/pearprojects/seekdeep && npx bare-link --version
```
Expected: a version line (`3.x.y`), exit 0.

> **As built:** do **not** check `bare-pack --version`. In `bare-pack@2.2.5` the CLI
> validates its positional entry even for `--version` and bails with
> `MISSING_ARG: <entry>`. Prove the packer works by actually packing (Task 0.4) instead.

```bash
cd ~/pearprojects/seekdeep && npm test 2>&1 | tail -2
```
Expected: still `All 44 test files passed.` (the manifest change broke nothing).

Commit: `chore: add bare toolchain for the native build`

### Task 0.4 — Prove `bare-pack` can bundle the real core

This is the single risk that invalidates the plan. `worklet/backend.js` is a stub here
and gets its real body in Task 1.4; the point is to prove resolution and linking.

Create `worklet/backend.js`:

```js
const { IPC } = Bare

IPC.on('data', (chunk) => {
  IPC.write(`${JSON.stringify({ id: null, ok: false, error: `echo:${chunk.toString()}` })}\n`)
})

IPC.on('end', () => {})
```

```bash
cd ~/pearprojects/seekdeep && npm run native:pack && ls -l app/app.bundle && test -s app/app.bundle && echo PACK_OK
```
Expected: `PACK_OK`, and `app/app.bundle` is several MB.

Now prove it pulled in the core, not just the stub — pack a module that imports the
worker runtime and check the bundle mentions its dependencies:

```bash
cd ~/pearprojects/seekdeep && strings app/app.bundle | grep -c "hyperswarm\|hyperdht\|corestore" 
```
Expected: a non-zero count (typically dozens). Zero means `bare-pack` silently emitted an
empty bundle — stop and report.

Commit: `chore: prove bare-pack bundles the seekdeep core`

### Task 0.5 — Prove BareKit embeds the bundle (throwaway app)

```bash
cd ~/pearprojects/seekdeep
gh release download v2.1.3 --repo holepunchto/bare-kit --pattern prebuilds.zip
unzip -o prebuilds.zip 'darwin/*' -d prebuilds/
mkdir -p app/frameworks && mv prebuilds/darwin/BareKit.xcframework app/frameworks/ && rm -rf prebuilds prebuilds.zip
ls app/frameworks/BareKit.xcframework
```
Expected: `Info.plist  darwin-arm64  darwin-x86_64` (or similar slice directories).

Create `project.yml` at the repo root (final version; Task 3.1 extends it with a test
target):

```yaml
name: SeekDeep
options:
  bundleIdPrefix: to.seekdeep
  deploymentTarget:
    macOS: "14.0"
packages:
  BareKit:
    url: https://github.com/holepunchto/bare-kit-swift
    branch: main
  BareRPC:
    url: https://github.com/holepunchto/bare-rpc-swift
    branch: main
targets:
  SeekDeep:
    type: application
    platform: macOS
    sources:
      - path: app
        excludes: [frameworks, addons, app.bundle, Info.plist, SeekDeep.entitlements]
      - path: app/app.bundle
        optional: true
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: to.seekdeep.native
        SWIFT_VERSION: "6.0"
        SWIFT_STRICT_CONCURRENCY: minimal
        MACOSX_DEPLOYMENT_TARGET: "14.0"
        CODE_SIGN_IDENTITY: "-"
    info:
      path: app/Info.plist
      properties:
        CFBundleName: SeekDeep
        LSMinimumSystemVersion: "14.0"
        NSHighResolutionCapable: true
    entitlements:
      path: app/SeekDeep.entitlements
      properties:
        com.apple.security.cs.allow-jit: true
        com.apple.security.cs.allow-unsigned-executable-memory: true
        com.apple.security.network.client: true
        com.apple.security.network.server: true
    dependencies:
      - framework: app/frameworks/BareKit.xcframework
      - package: BareKit
      - package: BareRPC
    scheme:
      preActions:
        - name: Link
          script: |
            set -e
            PATH="${PATH}" "${PWD}/node_modules/.bin/bare-link" --preset darwin --out ${PWD}/app/addons ${PWD}
        - name: Pack
          script: |
            set -e
            PATH="${PATH}" "${PWD}/node_modules/.bin/bare-pack" --preset darwin --linked --base ${PWD} --out ${PWD}/app/app.bundle ${PWD}/worklet/backend.js
            test -s "${PWD}/app/app.bundle"
```

`app/Info.plist` (minimal, xcodegen fills the rest):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
</dict>
</plist>
```

`app/SeekDeep.entitlements` is generated by xcodegen from the `properties` above; do not
create it by hand.

Minimal `app/SeekDeepApp.swift` (replaced in Phase 3):

```swift
import SwiftUI

@main
struct SeekDeepApp: App {
    var body: some Scene {
        WindowGroup { Text("boot") }
    }
}
```

```bash
cd ~/pearprojects/seekdeep && xcodegen generate && xcodebuild -scheme SeekDeep -derivedDataPath build -configuration Debug build 2>&1 | tail -3
```
Expected: `** BUILD SUCCEEDED **`

```bash
ls ~/pearprojects/seekdeep/build/Build/Products/Debug/SeekDeep.app/Contents/Resources/app.bundle
```
Expected: the path prints (a file, not a directory). If the pre-actions failed, Xcode
prints their stderr and the build stops — read the first 20 lines of the tool output.

> **Stop here if Task 0.5 fails.** Report which pre-action failed and the tool output.
> Do not work around it by copying JS files into the bundle by hand.

**As built — read this before repeating the task.** Four things the steps above get
wrong or leave out, all discovered the hard way:

1. **The release asset is not laid out as the reference README says.** `prebuilds.zip`
   contains `apple/BareKit.xcframework` (with an `ios-arm64`, an
   `ios-arm64_x86_64-simulator` and a **universal** `macos-arm64_x86_64` slice), not a
   `darwin/` directory. Also, `gh` is unauthenticated on this machine, so fetch with curl:

   ```bash
   curl -fsSL -o /tmp/prebuilds.zip \
     https://github.com/holepunchto/bare-kit/releases/download/v2.1.3/prebuilds.zip
   unzip -q /tmp/prebuilds.zip 'apple/BareKit.xcframework/*' -d /tmp/bk
   mv /tmp/bk/apple/BareKit.xcframework app/frameworks/
   ```
   The extracted framework is ~350 MB and gitignored.

2. **You do not need the local `BareKit.xcframework` as a linker dependency.** the
   `bare-kit-swift` SwiftPM package already declares a `binaryTarget` that fetches its own
   copy. Adding `- framework: app/frameworks/BareKit.xcframework` *and* the package
   duplicates the binary; the working `project.yml` links only `- package: BareKit`. Keep
   the local framework on disk for inspection, not on the link line.

3. **bare-link emits no manifest.** Version 3.3.2 writes one `.framework` per native
   addon into `app/addons/` and does not produce `addons.yml`. Without a manifest that
   embeds and signs them, the worklet dies at load with
   `AddonError: CANNOT_LOAD: Cannot load addon 'linked:…'`. Generate it from the listing
   and `include:` it:

   ```bash
   cd ~/pearprojects/seekdeep && node -e "
   const fs=require('node:fs');
   const dir='app/addons';
   const fw=fs.readdirSync(dir).filter(n=>n.endsWith('.framework')).sort();
   fs.writeFileSync(dir+'/addons.yml',
     ['targets:','  SeekDeep:','    dependencies:',...fw.map(n=>'      - framework: '+n)].join('\n')+'\n');
   console.log('wrote', fw.length, 'frameworks');"
   ```
   Expected: `wrote 30 frameworks`. Then `project.yml` starts with:

   ```yaml
   name: SeekDeep
   include:
     - app/addons/addons.yml
   ```

4. **`localdrive` needs Node's `fs`.** It does `require('fs')` / `require('fs/promises')`,
   which do not exist under Bare (`bare-fs` does). Alias it the way this repo already
   aliases `os` and `path`, in `package.json` `dependencies`:

   ```json
   "fs": "npm:bare-node-fs@^1.0.2",
   ```
   Then `npm install --ignore-scripts`. Under Node the builtin still wins, so nothing else
   changes.

Two more runtime facts that will bite Phase 3 if they are forgotten:

- **`Worklet` and `IPC` throw, and `start` takes a filename + arguments** — the API in
  `bare-kit-swift` is `try Worklet()`, `try IPC(worklet:)`,
  `try worklet.start("app.bundle", arguments: ["--storage=…"])`. The reference app's
  `start(name:ofType:)` does not exist in this version.
- **The worklet is not Node's** — `Bare.IPC`, `Bare.argv` and `Bare.exit` exist;
  `globalThis.fetch` and `process` do **not**. Resolve fetch through `bare-fetch`
  (as `js/runtime/boot.js` does) and guard anything touching `process`.
- Exiting with a live worklet aborts the process (exit 134). The shutdown order is
  `ipc.end()` → drop the `IPC` reference → drop the `Worklet` → `exit(0)`.

Verification that actually proves embedding (do this, not just the bundle-in-Resources
check): run the binary from a terminal, not with `open`:

```bash
cd ~/pearprojects/seekdeep && ./build/Build/Products/Debug/SeekDeep.app/Contents/MacOS/SeekDeep 2>&1 | tail -3; echo "exit=$?"
```
Expected: the worklet's start line, one `{"id":"1","ok":true,…"publicKey":"…"}` frame, and
`exit=0`.

Commit: `chore: prove BareKit embeds the worklet`

---

## Phase 1 — the worklet

Goal: a JS entry point that boots the real `createWorkerBackend` over any duplex pipe,
runs under Node for tests, and runs under Bare unchanged. Everything here is verified
by `npm test` — no Xcode, no Swift, no network.

### Task 1.1 — Pipe adapter

`Bare.IPC` is a stream, but `js/p2p/rpc-server.js` writes with the callback form
`pipe.write(frame, cb)` and reads `pipe.destroyed` / `pipe.writableEnded`. A 40-line
adapter pins that contract down and lets the same code run on Node and Bare.

**Test first** — `test/worklet-pipe-adapter.test.js`:

```js
import test from 'brittle'
import { EventEmitter } from 'node:events'
import { createPipeAdapter } from '../worklet/pipe-adapter.js'

class FakeIpc extends EventEmitter {
  constructor() { super(); this.written = []; this.ended = false }
  write(chunk, cb) { this.written.push(Buffer.from(chunk).toString()); if (cb) cb(); return true }
  end() { this.ended = true; this.emit('end') }
}

test('write() forwards to the ipc and invokes the callback exactly once', async (t) => {
  const ipc = new FakeIpc()
  const pipe = createPipeAdapter(ipc)
  const calls = []
  pipe.write(Buffer.from('{"a":1}\n'), (error) => calls.push(error))
  t.alike(ipc.written, ['{"a":1}\n'])
  t.is(calls.length, 1)
  t.is(calls[0], undefined)
})

test('inbound data surfaces on "data" and end closes the readable side', async (t) => {
  const ipc = new FakeIpc()
  const pipe = createPipeAdapter(ipc)
  const seen = []
  pipe.on('data', (chunk) => seen.push(Buffer.from(chunk).toString()))
  ipc.emit('data', Buffer.from('x'))
  ipc.emit('data', Buffer.from('y'))
  t.alike(seen, ['x', 'y'])

  const ended = new Promise((resolve) => pipe.once('end', resolve))
  ipc.emit('end')
  await ended
})

test('destroy() marks the pipe destroyed once and emits close once', async (t) => {
  const pipe = createPipeAdapter(new FakeIpc())
  let closes = 0
  pipe.on('close', () => { closes += 1 })
  t.is(pipe.destroyed, false)
  pipe.destroy()
  pipe.destroy()
  t.is(pipe.destroyed, true)
  t.is(closes, 1)
})
```

```bash
cd ~/pearprojects/seekdeep && node test/worklet-pipe-adapter.test.js 2>&1 | tail -3
```
Expected before implementing: `Cannot find module '…/worklet/pipe-adapter.js'` and a
non-zero exit.

**Now implement** `worklet/pipe-adapter.js`:

```js
/**
 * Adapt a Bare.IPC (or any duplex byte stream) to the exact surface
 * js/p2p/rpc-server.js expects: on/off/once for data|error|close|end,
 * write(chunk, cb), end(), destroy(), and `destroyed` / `writableEnded` flags.
 *
 * Zero dependencies on purpose: this file runs inside Bare, inside Node, and in tests.
 */
import { EventEmitter } from 'node:events'

const FORWARDED = ['data', 'error', 'close', 'end']

export function createPipeAdapter (ipc) {
  if (!ipc || typeof ipc.write !== 'function') throw new TypeError('createPipeAdapter requires a writable stream')

  const events = new EventEmitter()
  let destroyed = false
  let writableEnded = false

  const bound = {}
  for (const name of FORWARDED) {
    bound[name] = (payload) => {
      if (name === 'end' || name === 'close') writableEnded = true
      events.emit(name, payload)
    }
    if (typeof ipc.on === 'function') ipc.on(name, bound[name])
  }

  const pipe = {
    get destroyed () { return destroyed },
    get writableEnded () { return writableEnded },
    on: (name, handler) => { events.on(name, handler); return pipe },
    off: (name, handler) => { events.off(name, handler); return pipe },
    once: (name, handler) => { events.once(name, handler); return pipe },
    write (chunk, callback) {
      if (destroyed) { callback?.(new Error('pipe is destroyed')); return false }
      try { ipc.write(chunk); callback?.(); return true } catch (error) { callback?.(error); return false }
    },
    end () {
      if (writableEnded) return
      writableEnded = true
      try { ipc.end?.() } catch { /* already closed */ }
    },
    destroy (error) {
      if (destroyed) return
      destroyed = true
      writableEnded = true
      for (const name of FORWARDED) {
        if (typeof ipc.off === 'function') ipc.off(name, bound[name])
        else if (typeof ipc.removeListener === 'function') ipc.removeListener(name, bound[name])
      }
      events.emit('close')
      if (error) setImmediate(() => events.emit('error', error))
    }
  }

  return pipe
}
```

> **`node:events` inside Bare.** Bare ships a Node-compatibility layer that resolves
> `node:events`; this repo already relies on that mapping for `os`/`path` in
> `package.json`. If `bare-pack` errors on `node:events` during Task 1.4, swap the import
> for `bare-events` **in this one file** and re-run both tests — the adapter's public
> surface must not change.

```bash
cd ~/pearprojects/seekdeep && node test/worklet-pipe-adapter.test.js 2>&1 | tail -3
```
Expected: `3 tests pass` (brittle prints `ok 1 - …` per test plus a summary; exit code 0).

**As built:** the shipped `worklet/pipe-adapter.js` adds two behaviours the snippet above
lacks, both discovered by the tests failing:

1. **Inbound buffering.** `createWorkerBackend` awaits harness construction *before*
   `createJsonRpcServer` attaches `data`, so a host that writes immediately on start hit
   an `EventEmitter` with no listener and the request vanished. Frames are queued until a
   listener subscribes, then flushed synchronously inside `on()`.
2. **Sticky `end`/`close`.** `createWorklet` registers `pipe.once('end')` *after* boot; an
   `end` that arrived during boot must still fire it. The adapter remembers the settled
   payload and re-emits it on late subscription.

Both are covered by the fourth test case (`test/worklet-pipe-adapter.test.js`), which
asserts data emitted before any listener still arrives, and that a late `once('end')`
still fires. Do not "simplify" the adapter back to the snippet.

Commit: `feat(worklet): pipe adapter for Bare.IPC`

### Task 1.2 — Shared backend boot

`worklet/worklet.js` — the whole job is choosing arguments for
`createWorkerBackend`. Compare with `tui.js:41-49`, which does the same thing for the
terminal client.

```js
/**
 * Boot the unmodified SeekDeep worker backend over a duplex byte stream.
 *
 * tui.js proves this is legal outside Pear: pass `config.storage` explicitly and inject
 * an `fs`. Everything else is the same code path the desktop app uses.
 */
import path from 'path'                     // Bare resolves its builtin; Node resolves node:path
import { createPipeAdapter } from './pipe-adapter.js'
import { createWorkerBackend } from '../js/p2p/worker-runtime.js'
import { createProviderRouter } from '../js/llm/provider.js'
import { parseBootstrapArgs } from '../js/p2p/bootstrap-args.js'

export async function createWorklet ({ ipc, fs, storageRoot, argv = [], fetchImpl = globalThis.fetch, logger = console }) {
  if (typeof storageRoot !== 'string' || !path.isAbsolute(storageRoot)) {
    throw new TypeError('createWorklet requires an absolute storageRoot')
  }
  const pipe = createPipeAdapter(ipc)
  const { bootstrap, ollamaUrl, lmstudioUrl } = parseBootstrapArgs(argv)
  const providers = createProviderRouter({
    fetch: fetchImpl,
    baseUrls: { ollama: ollamaUrl, lmstudio: lmstudioUrl }
  })
  const backend = await createWorkerBackend(pipe, {
    config: { storage: storageRoot },
    providers,
    bootstrap,
    fs,
    harnessLogger: logger
  })
  // When the host closes its side of the IPC the pipe ends: flush drives, stop the swarm.
  pipe.once('end', () => { void backend.close().catch(() => {}) })
  return { backend, pipe }
}
```

**Test first** — `test/worklet-boot.test.js` (integration, no network: it only asserts the
RPC surface answers):

```js
import test from 'brittle'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Duplex } from 'node:stream'
import { createWorklet } from '../worklet/worklet.js'

function pair () {
  let a, b
  a = new Duplex({ read () {}, write (chunk, _enc, cb) { b.push(Buffer.from(chunk)); cb() } })
  b = new Duplex({ read () {}, write (chunk, _enc, cb) { a.push(Buffer.from(chunk)); cb() } })
  return { a, b }
}

test('worklet answers chat.status over a duplex pipe', async (t) => {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'seekdeep-worklet-'))
  const { a: hostSide, b: clientSide } = pair()
  const { backend } = await createWorklet({ ipc: hostSide, fs, storageRoot })

  const reply = new Promise((resolve) => {
    let buffer = ''
    clientSide.on('data', (chunk) => {
      buffer += chunk.toString()
      let index
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        if (line) resolve(JSON.parse(line))
      }
    })
  })
  clientSide.write(`${JSON.stringify({ id: '1', method: 'chat.status', params: {} })}\n`)
  const response = await reply

  t.is(response.id, '1')
  t.is(response.ok, true)
  t.is(response.result.topic, null)
  t.is(response.result.role, 'none')

  await backend.close()
  clientSide.destroy()
  await fs.rm(storageRoot, { recursive: true, force: true })
})
```

```bash
cd ~/pearprojects/seekdeep && node test/worklet-boot.test.js 2>&1 | tail -3
```
Expected: `1 test pass` (or brittle's `ok 1 - worklet answers chat.status…` + summary),
exit 0. If it hangs, the pipe adapter's write callback is not firing — that is what Task
1.1's first assertion guards.

**As built:** three `harness.event` plugin-loaded notifications are emitted *before* any
client request is answered, so tests and clients must filter on `parsed.id` rather than
taking the first frame off the pipe. The shipped test does exactly that.

Commit: `feat(worklet): shared backend boot`

### Task 1.3 — Node dev entry (stdio transport)

`worklet/dev.js`:

```js
#!/usr/bin/env node
/**
 * Node-only entry: boots the worklet backend and serves it over stdio, so the macOS app
 * can be developed and integration-tested without BareKit.
 *
 *   node worklet/dev.js --stdio --storage=/tmp/seekdeep-dev
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createWorklet } from './worklet.js'

const argv = process.argv.slice(2)
const storageArg = argv.find((arg) => arg.startsWith('--storage='))
const storageRoot = storageArg ? storageArg.slice('--storage='.length) : path.join(os.homedir(), '.seekdeep-dev')

process.stdout.on('error', () => process.exit(0))

await createWorklet({ ipc: process, fs, storageRoot, argv })
```

**Test** — `test/worklet-dev-entry.test.js`:

```js
import test from 'brittle'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('dev.js serves chat.status over stdio', async (t) => {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'seekdeep-dev-'))
  const child = spawn(process.execPath, ['worklet/dev.js', '--stdio', `--storage=${storageRoot}`], {
    stdio: ['pipe', 'pipe', 'inherit']
  })

  const reply = await new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error('timeout waiting for chat.status')), 15000)
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString()
      let index
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        if (!line) continue
        const parsed = JSON.parse(line)
        if (parsed.id === '1') { clearTimeout(timer); resolve(parsed) }
      }
    })
    child.stdin.write(`${JSON.stringify({ id: '1', method: 'chat.status', params: {} })}\n`)
  })

  t.is(reply.ok, true)
  child.kill('SIGTERM')
  await fs.rm(storageRoot, { recursive: true, force: true })
})
```

Manual check (deterministic, no test harness):

```bash
cd ~/pearprojects/seekdeep
printf '{"id":"1","method":"chat.status","params":{}}\n' | node worklet/dev.js --stdio --storage=/tmp/seekdeep-dev
```
Expected: exactly one line starting
`{"id":"1","ok":true,"result":{"initialized":false,"topic":null,"role":"none",…` and the
process exits when stdin closes.

**As built:** `process` is not a duplex, so `dev.js` presents stdin/stdout through a
small `ipc` object (`write(chunk, cb)` on stdout, `data` from stdin, everything else
forwarded to `process`). It deliberately does **not** forward stdin's `end`: `rpc-server`
treats `end` as "never write again" and drops the reply to a request that arrived with
EOF. The entry owns shutdown instead — one macrotask for in-flight replies,
`backend.close()`, a stdout drain, then `exit 0`.

Commit: `feat(worklet): stdio dev entry`

### Task 1.4 — Bare entry

Replace the stub `worklet/backend.js`:

```js
/**
 * Bare entry. Packed by bare-pack into app.bundle and started by BareKit.
 *
 * Bare.IPC is the duplex byte stream to the Swift host (see bare-kit's README);
 * bare-fs supplies the promise-based fs the Localdrive service and harness need.
 * The storage root is passed in by the host: a Bare worklet has no Pear.app.storage.
 */
import * as bareFs from 'bare-fs'
import { createWorklet } from './worklet.js'

const fs = bareFs.promises || (await import('bare-fs/promises'))

const storageArg = Bare.argv.find((arg) => typeof arg === 'string' && arg.startsWith('--storage='))
if (!storageArg) {
  console.error('[worklet] missing --storage=<absolute path>')
  Bare.exit(1)
}
const storageRoot = storageArg.slice('--storage='.length)

await createWorklet({ ipc: Bare.IPC, fs, storageRoot, argv: Bare.argv.slice(1) })

// The worklet dies with the host process; createWorklet()'s `end` handler flushes
// drives on a clean quit.
process.on('uncaughtException', (error) => { console.error('[worklet] uncaught', error); process.exit(1) })
process.on('unhandledRejection', (error) => { console.error('[worklet] unhandled', error); process.exit(1) })
```

```bash
cd ~/pearprojects/seekdeep && npm run native:pack && test -s app/app.bundle && echo PACK_OK
```
Expected: `PACK_OK`, with no `bare-pack` resolution errors. If it complains about
`bare-fs.promises`, switch to the explicit `bare-fs/promises` import above (already
written as a fallback) and re-pack.

```bash
cd ~/pearprojects/seekdeep && npm test 2>&1 | tail -3
```
Expected: `All 47 test files passed.` (44 existing + 3 worklet). Report the exact count
if it differs — a lower number means the new files were not picked up.

Commit: `feat(worklet): bare entry with host-supplied storage`

---

## Phase 2 — `SeekDeepCore` SwiftPM package

Everything in this phase is testable with `swift test` — no Xcode app, no V8, no
network. This is where the TDD loop lives and where most of the new code belongs.

`core/Package.swift`:

```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SeekDeepCore",
    platforms: [.macOS(.v14)],
    products: [.library(name: "SeekDeepCore", targets: ["SeekDeepCore"])],
    // Swift 5 language mode on purpose: this package is a straight port of
    // JavaScript semantics, and Swift 6 strict concurrency would force
    // `sendable` noise on every value type without changing a single behaviour.
    swiftLanguageModes: [.v5],
    targets: [
        .target(name: "SeekDeepCore"),
        .testTarget(name: "SeekDeepCoreTests", dependencies: ["SeekDeepCore"])
    ]
)
```

```bash
cd ~/pearprojects/seekdeep/core && swift build
```
Expected: `Build complete!` (first run downloads nothing; ~10 s).

### Task 2.1 — `JSONValue`

Why not `Codable` structs everywhere? Because the worker's payloads are dynamic
(`chat.event` carries sixteen shapes), and the old code validates them structurally.
One dynamic type keeps the decoding in one place.

**Test first** — `core/Tests/SeekDeepCoreTests/JSONValueTests.swift`:

```swift
import XCTest
@testable import SeekDeepCore

final class JSONValueTests: XCTestCase {
    func testDecodesNestedDocument() throws {
        let json = #"{"a":[1,2.5,true,null,"s"],"b":{"c":false}}"#
        let value = try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
        XCTAssertEqual(value["b"]?["c"], .bool(false))
        XCTAssertEqual(value["a"]?.array?.count, 5)
        XCTAssertEqual(value["a"]?.array?[2], .null)
        XCTAssertEqual(value["a"]?.array?[1].int, 2)
    }

    func testRoundTripsThroughEncoder() throws {
        let value: JSONValue = .object(["t": .string("x"), "n": .number(1), "a": .array([.bool(true)])])
        let data = try JSONEncoder().encode(value)
        XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: data), value)
    }

    func testSubscriptOnNonObjectIsNil() {
        XCTAssertNil(JSONValue.number(1)["missing"])
        XCTAssertNil(JSONValue.null.string)
    }
}
```

```bash
cd ~/pearprojects/seekdeep/core && swift test --filter JSONValueTests
```
Expected before implementation: `error: cannot find 'JSONValue' in scope`.

**Implement** `core/Sources/SeekDeepCore/JSONValue.swift`:

```swift
import Foundation

/// A JSON document with no schema. The worker's payloads are dynamic
/// (`chat.event` alone has six shapes), so the boundary decodes to this and the
/// typed layer is built on top, exactly as `js/p2p/rpc-codec.js` does with plain
/// objects.
public enum JSONValue: Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])
}

extension JSONValue: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "unsupported JSON value")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }
}

public extension JSONValue {
    subscript(key: String) -> JSONValue? {
        guard case .object(let object) = self else { return nil }
        return object[key]
    }

    var string: String? { if case .string(let value) = self { return value } else { return nil } }
    var bool: Bool? { if case .bool(let value) = self { return value } else { return nil } }
    var double: Double? { if case .number(let value) = self { return value } else { return nil } }
    var array: [JSONValue]? { if case .array(let value) = self { return value } else { return nil } }
    var object: [String: JSONValue]? { if case .object(let value) = self { return value } else { return nil } }

    /// Numbers are always decoded as `Double`; timestamps and counts come back as
    /// whole values, so narrow explicitly rather than relying on implicit conversion.
    var int: Int? {
        guard case .number(let value), value.rounded() == value, value.magnitude < 9e15 else { return nil }
        return Int(value)
    }

    static func str(_ value: String) -> JSONValue { .string(value) }
    static func intValue(_ value: Int) -> JSONValue { .number(Double(value)) }
}
```

```bash
cd ~/pearprojects/seekdeep/core && swift test --filter JSONValueTests
```
Expected: `Executed 3 tests, with 0 failures`.

Commit: `feat(core): JSONValue`

### Task 2.2 — `RPCFrame` (encode/decode, strict)

**Test first** — `RPCFrameTests.swift`:

```swift
import XCTest
@testable import SeekDeepCore

final class RPCFrameTests: XCTestCase {
    func testEncodesRequestWithExactlyThreeKeysAndTrailingNewline() throws {
        let data = try RPCFrame.encodeRequest(id: "7", method: "chat.send", params: ["prompt": .str("hi")])
        XCTAssertEqual(data.last, 0x0A)
        let text = String(decoding: data.dropLast(), as: UTF8.self)
        let object = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any]
        XCTAssertEqual(Set(object?.keys.map { $0 } ?? []), ["id", "method", "params"])
        XCTAssertEqual(object?["id"] as? String, "7")
        XCTAssertEqual(object?["method"] as? String, "chat.send")
    }

    func testDecodesSuccessResponse() throws {
        let line = Data(#"{"id":"1","ok":true,"result":{"requestId":"r1"}}"#.utf8)
        XCTAssertEqual(try RPCFrame(line: line), .response(id: "1", result: .object(["requestId": .str("r1")])))
    }

    func testDecodesStringError() throws {
        let line = Data(#"{"id":"2","ok":false,"error":"Not connected to a host"}"#.utf8)
        XCTAssertEqual(try RPCFrame(line: line), .failure(id: "2", error: RPCError(message: "Not connected to a host", code: nil)))
    }

    func testDecodesCodedError() throws {
        let line = Data(#"{"id":"3","ok":false,"error":{"code":"LOCALDRIVE_LIST_FAILED","message":"nope"}}"#.utf8)
        XCTAssertEqual(try RPCFrame(line: line), .failure(id: "3", error: RPCError(message: "nope", code: "LOCALDRIVE_LIST_FAILED")))
    }

    func testDecodesEvent() throws {
        let line = Data(#"{"event":"chat.event","data":{"type":"status"}}"#.utf8)
        XCTAssertEqual(try RPCFrame(line: line), .notification(RPCNotification(name: "chat.event", data: .object(["type": .str("status")]))))
    }

    func testRejectsExtraKeysAndUnknownShapes() {
        XCTAssertThrowsError(try RPCFrame(line: Data(#"{"id":"1","ok":true,"result":{},"extra":1}"#.utf8)))
        XCTAssertThrowsError(try RPCFrame(line: Data(#"{"nope":1}"#.utf8)))
        XCTAssertThrowsError(try RPCFrame(line: Data("not json".utf8)))
        XCTAssertThrowsError(try RPCFrame(line: Data(#"{"id":"1","ok":false,"error":42}"#.utf8)))
    }
}
```

Then implement `core/Sources/SeekDeepCore/RPCFrame.swift` and
`core/Sources/SeekDeepCore/RPCNotification.swift` (kept in separate files so the
`RPCNotification` type is importable on its own):

```swift
// RPCNotification.swift
import Foundation

/// An unsolicited frame from the worker: `{"event":String,"data":JSON}`.
public struct RPCNotification: Equatable, Sendable {
    public let name: String
    public let data: JSONValue
    public init(name: String, data: JSONValue) {
        self.name = name
        self.data = data
    }
}
```

```swift
// RPCFrame.swift
import Foundation

public struct RPCError: Error, Equatable, Sendable {
    public let message: String
    public let code: String?
    public init(message: String, code: String? = nil) {
        self.message = message
        self.code = code
    }
}

public enum RPCFrameError: Error, Equatable {
    case malformed(String)
}

/// One line of the worker pipe. Mirrors `js/p2p/rpc-server.js`'s `send()` and
/// `notify()`: responses are exactly `{id,ok,result}` or `{id,ok,error}`, events are
/// exactly `{event,data}`. Anything else is dropped rather than guessed at.
public enum RPCFrame: Equatable, Sendable {
    case response(id: String, result: JSONValue)
    case failure(id: String, error: RPCError)
    case notification(RPCNotification)

    public init(line: Data) throws {
        let decoded: JSONValue
        do { decoded = try JSONDecoder().decode(JSONValue.self, from: line) }
        catch { throw RPCFrameError.malformed("not JSON") }
        guard let object = decoded.object else { throw RPCFrameError.malformed("not a JSON object") }
        let keys = Set(object.keys)

        if keys == ["event", "data"] {
            guard let name = object["event"]?.string, Self.isValidEventName(name) else {
                throw RPCFrameError.malformed("invalid event name")
            }
            self = .notification(RPCNotification(name: name, data: object["data"] ?? .null))
            return
        }

        if keys == ["id", "ok", "result"], object["ok"]?.bool == true {
            guard let id = Self.identifier(object["id"]) else { throw RPCFrameError.malformed("invalid id") }
            self = .response(id: id, result: object["result"] ?? .null)
            return
        }

        if keys == ["id", "ok", "error"], object["ok"]?.bool == false {
            guard let id = Self.identifier(object["id"]) else { throw RPCFrameError.malformed("invalid id") }
            switch object["error"] {
            case .string(let message)?:
                self = .failure(id: id, error: RPCError(message: message))
            case .object(let payload)? where Set(payload.keys) == ["code", "message"]:
                guard let code = payload["code"]?.string, let message = payload["message"]?.string else {
                    throw RPCFrameError.malformed("invalid error payload")
                }
                self = .failure(id: id, error: RPCError(message: message, code: code))
            default:
                throw RPCFrameError.malformed("invalid error payload")
            }
            return
        }

        throw RPCFrameError.malformed("unknown frame shape")
    }

    public static func encodeRequest(id: String, method: String, params: [String: JSONValue]) throws -> Data {
        guard !id.isEmpty, id.utf8.count <= 64, !method.isEmpty else {
            throw RPCFrameError.malformed("invalid request")
        }
        let payload = JSONValue.object(["id": .string(id), "method": .string(method), "params": .object(params)])
        var data = try JSONEncoder().encode(payload)
        data.append(0x0A)
        return data
    }

    /// Request ids are echoed verbatim; the client only ever sends strings, but the
    /// server also accepts safe integers (`validateRequest`), so both are honoured.
    private static func identifier(_ value: JSONValue?) -> String? {
        guard let value else { return nil }
        switch value {
        case .string(let text):
            guard !text.isEmpty, text.utf8.count <= 64 else { return nil }
            return text
        case .number(let number):
            guard number >= 0, number.rounded() == number, number.magnitude < 9e15 else { return nil }
            return String(Int(number))
        default:
            return nil
        }
    }

    private static func isValidEventName(_ name: String) -> Bool {
        // Mirrors EVENT_PATTERN: /^[a-z][a-z0-9.-]{0,63}$/
        guard let first = name.first, first.isLowercase, first.isASCII, name.count <= 64 else { return false }
        return name.allSatisfy { character in
            character.isASCII && (character.isLowercase || character.isNumber || character == "." || character == "-")
        }
    }
}
```

```bash
cd ~/pearprojects/seekdeep/core && swift test --filter RPCFrameTests
```
Expected: `Executed 6 tests, with 0 failures`.

Commit: `feat(core): strict RPC frames`

### Task 2.3 — Transport protocol + serial writer

`core/Sources/SeekDeepCore/WorkletTransport.swift`:

```swift
import Foundation

/// The byte pipe to the worker. Implemented by `BareTransport` (BareKit IPC) in the
/// app and by `ProcessTransport` (spawned `node worklet/dev.js`) in dev and tests.
public protocol WorkletTransport: AnyObject, Sendable {
    func start() async throws
    func send(_ data: Data) async throws
    var inbound: AsyncStream<Data> { get }
    func stop() async
}
```

`core/Sources/SeekDeepCore/SerialWriter.swift`:

```swift
import Foundation

/// Serializes writes so two concurrent `request()` calls can never interleave
/// halves of two frames on the wire. The worker parses lines, so a torn write is a
/// protocol error, not a small glitch.
public actor SerialWriter {
    private let transport: any WorkletTransport
    private var tail: Task<Void, Error>?

    public init(transport: any WorkletTransport) {
        self.transport = transport
    }

    public func send(_ data: Data) async throws {
        let previous = tail
        let task = Task { [transport] in
            _ = try? await previous?.value
            try await transport.send(data)
        }
        tail = task
        try await task.value
    }
}
```

**Test** — this one lives in `core/Tests/SeekDeepCoreTests/SerialWriterTests.swift`
(it needs the `RecordingTransport` double, so write that file from Task 2.4 first and
put this test class in its own file):

```swift
import XCTest
@testable import SeekDeepCore

final class SerialWriterTests: XCTestCase {
    func testConcurrentWritesNeverInterleave() async throws {
        let transport = RecordingTransport()
        let writer = SerialWriter(transport: transport)
        try await withThrowingTaskGroup(of: Void.self) { group in
            for index in 0..<10 {
                group.addTask { try await writer.send(Data("frame-\(index)\n".utf8)) }
            }
            try await group.waitForAll()
        }
        let frames = await transport.sent
        XCTAssertEqual(frames.count, 10)
        for frame in frames { XCTAssertTrue(frame.hasSuffix("\n")) }
    }
}
```

```bash
cd ~/pearprojects/seekdeep/core && swift test --filter SerialWriterTests
```
Expected: `Executed 1 test, with 0 failures`.

Commit: `feat(core): transport protocol and serialized writes`

### Task 2.4 — `RPCClient`

**Test first** — `RPCClientTests.swift`:

```swift
import XCTest
@testable import SeekDeepCore

/// Transport double: records what the client sends and lets the test push bytes back.
actor RecordingTransport: WorkletTransport {
    private(set) var sent: [String] = []
    private nonisolated let continuation: AsyncStream<Data>.Continuation
    nonisolated let inbound: AsyncStream<Data>

    init() {
        var captured: AsyncStream<Data>.Continuation!
        inbound = AsyncStream { captured = $0 }
        continuation = captured
    }

    func start() async throws {}
    func send(_ data: Data) async throws { sent.append(String(decoding: data, as: UTF8.self)) }
    func stop() async { continuation.finish() }

    nonisolated func push(_ line: String) { continuation.yield(Data(line.utf8)) }
}

final class RPCClientTests: XCTestCase {
    func testRequestResolvesWithResult() async throws {
        let transport = RecordingTransport()
        let client = RPCClient(transport: transport)
        try await client.start()

        let task = Task { try await client.request("chat.status", [:]) }
        try await waitUntil { await transport.sent.count == 1 }
        // Extract before asserting: XCTest's @autoclosure parameters cannot await.
        let sent = await transport.sent
        XCTAssertEqual(sent.first, #"{"id":"1","method":"chat.status","params":{}}"# + "\n")
        transport.push(#"{"id":"1","ok":true,"result":{"role":"none"}}"# + "\n")
        let result = try await task.value
        XCTAssertEqual(result["role"]?.string, "none")
    }

    func testRequestThrowsWorkerError() async throws {
        let transport = RecordingTransport()
        let client = RPCClient(transport: transport)
        try await client.start()
        let task = Task { try await client.request("chat.send", ["prompt": .str("x"), "model": .str("m")]) }
        try await waitUntil { await transport.sent.count == 1 }
        transport.push(#"{"id":"1","ok":false,"error":"Not connected to a host"}"# + "\n")
        do {
            _ = try await task.value
            XCTFail("expected an error")
        } catch let error as RPCError {
            XCTAssertEqual(error.message, "Not connected to a host")
        }
    }

    func testNotificationsArriveOnTheEventStream() async throws {
        let transport = RecordingTransport()
        let client = RPCClient(transport: transport)
        try await client.start()
        let received = Task { () -> String? in
            for await notification in client.notifications { return notification.name }
            return nil
        }
        transport.push(#"{"event":"chat.event","data":{"type":"status"}}"# + "\n")
        let name = await received.value
        XCTAssertEqual(name, "chat.event")
    }
}

/// Poll until `condition` is true, or fail after 2 s. Avoids arbitrary sleeps in
/// async tests without pulling in a dependency.
func waitUntil(timeout: Duration = .seconds(2), _ condition: @escaping () async -> Bool) async throws {
    let deadline = ContinuousClock.now + timeout
    while ContinuousClock.now < deadline {
        if await condition() { return }
        try await Task.sleep(for: .milliseconds(5))
    }
    XCTFail("condition not met within \(timeout)")
}
```

Implement `core/Sources/SeekDeepCore/RPCClient.swift`:

```swift
import Foundation

/// Newline-framed JSON-RPC client for the worker pipe.
///
/// Responsibilities, in order: frame the request, correlate the response by id,
/// time it out, and fan unsolicited `{event,data}` frames out on `notifications`.
/// It deliberately knows nothing about chat semantics — that is `ChatReducer`'s job.
public actor RPCClient {
    public let notifications: AsyncStream<RPCNotification>

    private let transport: any WorkletTransport
    private let writer: SerialWriter
    private let timeout: Duration
    private let sink: AsyncStream<RPCNotification>.Continuation

    private var nextID = 0
    private var pending: [String: CheckedContinuation<JSONValue, Error>] = [:]
    private var buffer = Data()
    private var readTask: Task<Void, Never>?

    public init(transport: any WorkletTransport, timeout: Duration = .seconds(60)) {
        self.transport = transport
        self.writer = SerialWriter(transport: transport)
        self.timeout = timeout
        let (stream, continuation) = AsyncStream.makeStream(of: RPCNotification.self)
        self.notifications = stream
        self.sink = continuation
    }

    public func start() async throws {
        guard readTask == nil else { return }
        let inbound = transport.inbound
        readTask = Task { [weak self] in
            for await chunk in inbound {
                await self?.ingest(chunk)
            }
            await self?.closePending(RPCError(message: "worker pipe closed"))
        }
        try await transport.start()
    }

    public func request(_ method: String, _ params: [String: JSONValue] = [:]) async throws -> JSONValue {
        nextID += 1
        let id = String(nextID)
        let frame = try RPCFrame.encodeRequest(id: id, method: method, params: params)
        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            Task { [weak self] in
                guard let self else { return }
                do { try await self.writer.send(frame) }
                catch { await self.fail(id, with: error) }
            }
            Task { [weak self, timeout] in
                try? await Task.sleep(for: timeout)
                await self?.fail(id, with: RPCError(message: "\(method) timed out"))
            }
        }
    }

    public func stop() async {
        readTask?.cancel()
        readTask = nil
        closePending(RPCError(message: "client stopped"))
        await transport.stop()
    }

    // MARK: - inbound

    private func ingest(_ chunk: Data) {
        buffer.append(chunk)
        while let newline = buffer.firstIndex(of: 0x0A) {
            let line = Data(buffer[buffer.startIndex..<newline])
            buffer = Data(buffer[buffer.index(after: newline)...])
            guard !line.isEmpty else { continue }
            guard let frame = try? RPCFrame(line: line) else { continue }
            switch frame {
            case .notification(let notification):
                sink.yield(notification)
            case .response(let id, let result):
                pending.removeValue(forKey: id)?.resume(returning: result)
            case .failure(let id, let error):
                pending.removeValue(forKey: id)?.resume(throwing: error)
            }
        }
    }

    private func fail(_ id: String, with error: Error) {
        pending.removeValue(forKey: id)?.resume(throwing: error)
    }

    private func closePending(_ error: Error) {
        for continuation in pending.values { continuation.resume(throwing: error) }
        pending.removeAll()
        sink.finish()
    }
}
```

The `stop()` above is the final version: it must **not** try to finish the transport's
stream itself — the transport owns its own stream and finishes it in its own `stop()`.

```bash
cd ~/pearprojects/seekdeep/core && swift test --filter RPCClientTests
```
Expected: `Executed 3 tests, with 0 failures`.

Commit: `feat(core): JSON-RPC client`

### Task 2.5 — `WorkerEvent` decoding

**Test first** — `WorkerEventTests.swift`:

```swift
import XCTest
@testable import SeekDeepCore

final class WorkerEventTests: XCTestCase {
    private func event(_ json: String) throws -> WorkerUpdate? {
        let notification = try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
        return WorkerEvent.decode(notification: RPCNotification(name: "chat.event", data: notification))
    }

    func testResponseEvent() throws {
        let decoded = try XCTUnwrap(event(#"{"type":"response","requestId":"r1","chunk":"Hi","done":false}"#))
        XCTAssertEqual(decoded, .response(requestId: "r1", chunk: "Hi", done: false, error: nil))
    }

    func testSystemMessageEvent() throws {
        let decoded = try XCTUnwrap(event(#"{"type":"message","message":{"id":"m1","type":"system","content":"hi","timestamp":1700000000000}}"#))
        guard case .message(let message) = decoded else { return XCTFail("wrong case") }
        XCTAssertEqual(message.id, "m1")
        XCTAssertEqual(message.kind, .system)
        XCTAssertEqual(message.content, "hi")
    }

    func testUnknownTypesAreIgnored() throws {
        XCTAssertNil(try event(#"{"type":"chat_response","requestId":"r","kind":"text"}"#))
    }

    func testStatusEventCarriesServerFacts() throws {
        let decoded = try XCTUnwrap(event(#"{"type":"status","topic":"ab","role":"host","connected":true,"peerCount":2,"collaborative":true,"provider":"ollama"}"#))
        XCTAssertEqual(decoded, .status(topic: "ab", role: "host", connected: true, peerCount: 2, collaborative: true, provider: "ollama"))
    }
}
```

Note the 13-digit `timestamp`: the JS worker emits `Date.now()` **milliseconds**. Get
this wrong and every message shows 1970 — that is why it is in the test fixture.

Implement `core/Sources/SeekDeepCore/WorkerEvent.swift`:

```swift
import Foundation

public enum MessageKind: String, Sendable { case user, assistant, system, bot }

/// One transcript row. Mirrors what `js/messages/store.js` kept as a plain object,
/// plus the `rawContent`/`isComplete` fields `js/messages/stream.js` mutated.
public struct ChatMessage: Identifiable, Equatable, Sendable {
    public let id: String
    public var kind: MessageKind
    public var content: String
    public var rawContent: String
    public var fromPeer: String?
    public var requestId: String?
    public var timestamp: Date
    public var isComplete: Bool

    public init(id: String, kind: MessageKind, content: String, rawContent: String? = nil,
                fromPeer: String? = nil, requestId: String? = nil, timestamp: Date = Date(),
                isComplete: Bool = true) {
        self.id = id
        self.kind = kind
        self.content = content
        self.rawContent = rawContent ?? content
        self.fromPeer = fromPeer
        self.requestId = requestId
        self.timestamp = timestamp
        self.isComplete = isComplete
    }
}

public struct WirePeer: Equatable, Sendable, Identifiable {
    public let id: String
    public let displayName: String
    public let role: String
}

public struct WireModel: Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
}

/// Every worker notification the UI cares about. Anything the decoder does not
/// recognise returns `nil` — the client is a viewer, not a validator.
public enum WorkerUpdate: Equatable, Sendable {
    case status(topic: String?, role: String, connected: Bool, peerCount: Int, collaborative: Bool, provider: String?)
    case peers([WirePeer])
    case mode(collaborative: Bool)
    case models(provider: String?, models: [WireModel])
    case message(ChatMessage)
    case response(requestId: String, chunk: String, done: Bool, error: String?)
    case slash(content: String, kind: String)
    case bot(kind: String, text: String, from: String?)
}

public enum WorkerEvent {
    public static func decode(notification: RPCNotification) -> WorkerUpdate? {
        switch notification.name {
        case "chat.event": return decodeChat(notification.data)
        case "harness.event": return decodeHarness(notification.data)
        default: return nil
        }
    }

    private static func decodeChat(_ data: JSONValue) -> WorkerUpdate? {
        switch data["type"]?.string {
        case "status":
            return .status(
                topic: data["topic"]?.string,
                role: data["role"]?.string ?? "none",
                connected: data["connected"]?.bool ?? false,
                peerCount: data["peerCount"]?.int ?? 0,
                collaborative: data["collaborative"]?.bool ?? false,
                provider: data["provider"]?.string)
        case "peers":
            let peers = (data["peers"]?.array ?? []).compactMap { entry -> WirePeer? in
                guard let id = entry["id"]?.string else { return nil }
                return WirePeer(id: id,
                                displayName: entry["displayName"]?.string ?? id.prefix(6).description,
                                role: entry["role"]?.string ?? "peer")
            }
            return .peers(peers)
        case "mode":
            return .mode(collaborative: data["collaborative"]?.bool ?? false)
        case "models":
            let models = (data["models"]?.array ?? []).compactMap { entry -> WireModel? in
                guard let id = entry["id"]?.string else { return nil }
                return WireModel(id: id, name: entry["name"]?.string ?? id)
            }
            return .models(provider: data["provider"]?.string, models: models)
        case "message":
            guard let wire = data["message"], let id = wire["id"]?.string else { return nil }
            let kind = MessageKind(rawValue: wire["type"]?.string ?? "system") ?? .system
            return .message(ChatMessage(
                id: id,
                kind: kind,
                content: wire["content"]?.string ?? "",
                rawContent: nil,
                fromPeer: wire["fromPeer"]?.string,
                timestamp: Date(timeIntervalSince1970: (wire["timestamp"]?.double ?? 0) / 1000)))
        case "response":
            guard let requestId = data["requestId"]?.string else { return nil }
            return .response(
                requestId: requestId,
                chunk: data["chunk"]?.string ?? "",
                done: data["done"]?.bool ?? false,
                error: data["error"]?.string)
        default:
            return nil
        }
    }

    private static func decodeHarness(_ data: JSONValue) -> WorkerUpdate? {
        switch data["type"]?.string {
        case "slash":
            // `content` is the rendered text; `metadata.kind` is the style hint the old
            // UI handed to `js/ui/ephemeral.js` ("slash-help", "slash-error", …).
            return .slash(
                content: data["content"]?.string ?? "",
                kind: data["metadata"]?["kind"]?.string ?? "ephemeral")
        case "bot":
            return .bot(
                kind: data["kind"]?.string ?? "message",
                text: data["text"]?.string ?? "",
                from: data["fromName"]?.string ?? data["from"]?.string)
        default:
            return nil
        }
    }
}
```

```bash
cd ~/pearprojects/seekdeep/core && swift test --filter WorkerEventTests
```
Expected: `Executed 4 tests, with 0 failures`.

Commit: `feat(core): worker event decoding`

### Task 2.6 — `ChatState` + `ChatReducer`

This is the port of `js/session/client-state.js`, `js/messages/store.js` and
`js/messages/stream.js` (~400 JS lines) into one pure function. Write the reducer
tests **first**, using the exact payloads from §7.5.

**Test first** — `ChatReducerTests.swift`, complete file:

```swift
import XCTest
@testable import SeekDeepCore

final class ChatReducerTests: XCTestCase {
    private func sample(id: String, kind: MessageKind = .system, content: String = "text") -> ChatMessage {
        ChatMessage(id: id, kind: kind, content: content)
    }

    func testResponseChunksAccumulateIntoOneAssistantMessage() {
        var state = ChatState()
        state = ChatReducer.reduce(state, .response(requestId: "r1", chunk: "Hel", done: false, error: nil))
        state = ChatReducer.reduce(state, .response(requestId: "r1", chunk: "lo", done: true, error: nil))
        XCTAssertEqual(state.messages.count, 1)
        XCTAssertEqual(state.messages[0].kind, .assistant)
        XCTAssertEqual(state.messages[0].rawContent, "Hello")
        XCTAssertTrue(state.messages[0].isComplete)
    }

    func testResponseErrorBecomesSystemMessage() {
        var state = ChatState()
        state = ChatReducer.reduce(state, .response(requestId: "r1", chunk: "", done: true, error: "boom"))
        XCTAssertTrue(state.messages.contains { $0.kind == .system && $0.content.contains("boom") })
    }

    func testMessagesCapAt100DroppingOldest() {
        var state = ChatState()
        for index in 0..<105 { state = ChatReducer.reduce(state, .message(sample(id: "m\(index)"))) }
        XCTAssertEqual(state.messages.count, 100)
        XCTAssertEqual(state.messages.first?.id, "m5")
    }

    func testDuplicateMessageIdsAreIgnored() {
        var state = ChatState()
        state = ChatReducer.reduce(state, .message(sample(id: "m1")))
        state = ChatReducer.reduce(state, .message(sample(id: "m1")))
        XCTAssertEqual(state.messages.count, 1)
    }

    func testSlashOutputIsEphemeralAndNotInTranscript() {
        var state = ChatState()
        state = ChatReducer.reduce(state, .slash(content: "/p2p help", kind: "slash-help"))
        XCTAssertEqual(state.ephemeral?.content, "/p2p help")
        XCTAssertEqual(state.messages.count, 0)
    }

    func testOnlyHostMayChangeProviderAndMode() {
        var state = ChatState()
        state = ChatReducer.reduce(state, .status(topic: "t", role: "peer", connected: true, peerCount: 2, collaborative: false, provider: "ollama"))
        XCTAssertFalse(state.isHost)
        state = ChatReducer.reduce(state, .status(topic: "t", role: "host", connected: true, peerCount: 2, collaborative: false, provider: "ollama"))
        XCTAssertTrue(state.isHost)
    }
}
```

```bash
cd ~/pearprojects/seekdeep/core && swift test --filter ChatReducerTests
```
Expected before implementation: `cannot find 'ChatState' in scope`.

**Implement** `core/Sources/SeekDeepCore/ChatState.swift`:

```swift
import Foundation

public struct Ephemeral: Equatable, Sendable {
    public var content: String
    public var kind: String          // "slash-help" | "slash-error" | "slash-placeholder"
    public var createdAt: Date
}

/// The renderer's entire view of the room. One value type, mutated only by
/// `ChatReducer`, driven only by worker notifications — no I/O, no timers, no views.
public struct ChatState: Equatable, Sendable {
    public var messages: [ChatMessage] = []
    public var ephemeral: Ephemeral?
    public var topic: String?
    public var role: String = "none"
    public var connected: Bool = false
    public var peerCount: Int = 0
    public var collaborative: Bool = false
    public var provider: String?
    public var peers: [WirePeer] = []
    public var models: [WireModel] = []
    public var selectedModel: String?

    public init() {}

    public var isHost: Bool { role == "host" }

    /// The model the composer should send. Falls back to the first known model so a
    /// peer that never opened the picker can still type and send.
    public var effectiveModel: String? { selectedModel ?? models.first?.id }
}
```

**Implement** `core/Sources/SeekDeepCore/ChatReducer.swift`:

```swift
import Foundation

public enum ChatReducer {
    /// `js/messages/store.js` keeps at most 100 messages in memory.
    public static let maxHistory = 100

    public static func reduce(_ state: ChatState, _ update: WorkerUpdate) -> ChatState {
        var state = state
        switch update {
        case .status(let topic, let role, let connected, let peerCount, let collaborative, let provider):
            state.topic = topic ?? state.topic
            state.role = role
            state.connected = connected
            state.peerCount = peerCount
            state.collaborative = collaborative
            state.provider = provider ?? state.provider

        case .peers(let peers):
            state.peers = peers
            state.peerCount = peers.count

        case .mode(let collaborative):
            state.collaborative = collaborative

        case .models(let provider, let models):
            state.provider = provider ?? state.provider
            state.models = models
            if let selected = state.selectedModel, models.contains(where: { $0.id == selected }) { break }
            state.selectedModel = models.first?.id

        case .message(let message):
            append(message, to: &state)

        case .response(let requestId, let chunk, let done, let error):
            if let error, !error.isEmpty {
                append(ChatMessage(id: "err-\(requestId)-\(state.messages.count)", kind: .system,
                                   content: "Error: \(error)"), to: &state)
            }
            guard !chunk.isEmpty || done else { break }
            var message: ChatMessage
            if let index = state.messages.lastIndex(where: { $0.requestId == requestId && $0.kind == .assistant }) {
                message = state.messages[index]
            } else {
                message = ChatMessage(id: "asst-\(requestId)", kind: .assistant, content: "",
                                      rawContent: "", requestId: requestId, isComplete: false)
                append(message, to: &state)
            }
            guard let index = state.messages.firstIndex(where: { $0.id == message.id }) else { break }
            message.rawContent += chunk
            message.content = message.rawContent
            message.isComplete = message.isComplete || done
            state.messages[index] = message

        case .slash(let content, let kind):
            state.ephemeral = Ephemeral(content: content, kind: kind, createdAt: Date())

        case .bot(let kind, let text, let from):
            let label = kind == "reply" ? "Bot reply" : "Bot \(from ?? "peer")"
            append(ChatMessage(id: "bot-\(state.messages.count)-\(text.hashValue)", kind: .system,
                               content: "\(label): \(text)"), to: &state)
        }
        return state
    }

    public static func append(_ message: ChatMessage, to state: inout ChatState) {
        guard !state.messages.contains(where: { $0.id == message.id }) else { return }
        state.messages.append(message)
        if state.messages.count > maxHistory {
            state.messages.removeFirst(state.messages.count - maxHistory)
        }
    }
}
```

Note the `.response` branch deliberately appends the error as a **system** message and
*also* processes the terminal `done` frame: the worker sends `done: true` with an empty
chunk on both success and failure (`chat-service.js:151-172`), so dropping it on error
would leave the assistant bubble spinning forever.

```bash
cd ~/pearprojects/seekdeep/core && swift test --filter ChatReducerTests
```
Expected: `Executed 6 tests, with 0 failures`.

Commit: `feat(core): chat reducer`

### Task 2.7 — `MarkdownBlocks`

`css` + `marked.js` gave the old UI rich text. Native equivalent: split into blocks
yourself, render inline with `AttributedString(markdown:)`. Blocks keep streaming
cheap (only the last block re-renders).

**Test first:**

```swift
func testSplitsFencedCodeOutOfParagraphs() {
    let blocks = MarkdownBlocks.parse("Hi\n\n```swift\nlet x = 1\n```\n\nBye")
    XCTAssertEqual(blocks, [
        .paragraph("Hi"),
        .code(language: "swift", text: "let x = 1"),
        .paragraph("Bye")
    ])
}

func testUnclosedFenceDuringStreamingIsStillCode() {
    XCTAssertEqual(MarkdownBlocks.parse("```js\nconst a"), [.code(language: "js", text: "const a")])
}

func testHeadingsAndBullets() {
    XCTAssertEqual(MarkdownBlocks.parse("# Title"), [.heading(level: 1, text: "Title")])
    XCTAssertEqual(MarkdownBlocks.parse("- a\n- b"), [.bullets(["a", "b"])])
}
```

Expected failure: `cannot find 'MarkdownBlocks' in scope`. Then implement
`parse(_:) -> [MarkdownBlocks.Block]` where

```swift
public enum Block: Equatable, Sendable {
    case paragraph(String)
    case heading(level: Int, text: String)
    case bullets([String])
    case code(language: String?, text: String)
}
```

Implementation rules (line-based, ~60 lines, no regex):
1. Iterate lines with an index.
2. ` ``` ` opens a fence; capture the info string as `language`; close on the next
   ` ``` ` or EOF (streaming!).
3. `#{1,6} ` → heading.
4. Consecutive `- ` / `* ` lines → one `.bullets`.
5. Blank line ends a paragraph; otherwise append to the current paragraph with `\n`.

```bash
cd ~/pearprojects/seekdeep/core && swift test --filter MarkdownBlocksTests
```
Expected: `Executed 3 tests, with 0 failures`.

Commit: `feat(core): markdown block splitter`

### Task 2.8 — `SlashQuery`

Only one thing belongs on the Swift side: knowing whether the caret is inside a `/`
token, and what prefix it has. Do **not** port the flag parser
(`js/slash/parser.js`) — the worklet owns parsing, and duplicating it creates two
sources of truth.

```swift
func testLeadingCommandWithoutSpace() {
    XCTAssertEqual(SlashQuery.command(in: "/p2p", caret: 4), "p2p")
}
func testCommandIsNilOnceThereIsASpace() {
    XCTAssertNil(SlashQuery.command(in: "/p2p drive", caret: 10))
}
func testPlainTextIsNotACommand() {
    XCTAssertNil(SlashQuery.command(in: "hello /p2p", caret: 10))
}
func testSlashAloneIsEmptyCommandNotNil() {
    XCTAssertEqual(SlashQuery.command(in: "/", caret: 1), "")
}
```

```bash
cd ~/pearprojects/seekdeep/core && swift test --filter SlashQueryTests
```
Expected: `Executed 4 tests, with 0 failures`.

Commit: `feat(core): slash query detection`

### Task 2.9 — `SessionStore`

Port of `js/session/storage.js` semantics onto files. Root injected so tests use a
temp dir.

```swift
func testSaveListLoadDeleteRoundTrip() async throws {
    let root = URL(fileURLWithPath: NSTemporaryDirectory()).appending(path: UUID().uuidString)
    let store = SessionStore(root: root)
    let session = StoredSession(id: "s1", name: "Test", createdAt: Date(timeIntervalSince1970: 100), messages: [sample(id: "m1")])
    try await store.save(session)
    XCTAssertEqual(try await store.list().map(\.id), ["s1"])
    XCTAssertEqual(try await store.load(id: "s1")?.messages.count, 1)
    try await store.delete(id: "s1")
    XCTAssertEqual(try await store.list(), [])
}

func testSearchMatchesNameAndContentCaseInsensitively() async throws { … }
func testCorruptRegistryIsTreatedAsEmpty() async throws { … }
```

Implementation: `SessionStore` actor; `list()` reads `registry.json`
(`[{id,name,createdAt,messageCount}]`), sorted newest first; `save` writes
`<id>.json` atomically (`Data.write(options: .atomic)`) then rewrites the registry;
`search` filters in memory; a `FileManager.createDirectory` in `init`-time `ensureRoot()`.

```bash
cd ~/pearprojects/seekdeep/core && swift test --filter SessionStoreTests
```
Expected: `Executed 3 tests, with 0 failures`.

Commit: `feat(core): session store`

### Task 2.10 — Full core suite green

```bash
cd ~/pearprojects/seekdeep/core && swift test 2>&1 | tail -5
```
Expected: a summary line ending `with 0 failures`. (Phase 2 ends with roughly 30 tests;
the exact count grows in Phase 4 — a non-zero failure count is the only thing that
matters here.)

Also confirm no Foundation/UI leakage into the core:

```bash
cd ~/pearprojects/seekdeep/core && grep -rn "import SwiftUI\|import BareKit\|import AppKit" Sources/ || echo CLEAN
```
Expected: `CLEAN`.

Commit: `test(core): full suite green`

---

## Phase 3 — SwiftUI shell + chat MVP

Target: a window that joins a room, lists models, sends a prompt, and streams the
answer. Nothing else.

### Task 3.1 — Add the core package and a test target to `project.yml`

Do not rewrite `project.yml`; apply exactly these four edits to the file from Task 0.5.

1. Under `packages:`, add the local package first:

```yaml
packages:
  SeekDeepCore:
    path: core
  BareKit:
```

2. Under the `SeekDeep` target's `dependencies:`, add the package:

```yaml
    dependencies:
      - framework: app/frameworks/BareKit.xcframework
      - package: SeekDeepCore
      - package: BareKit
      - package: BareRPC
```

3. In the `SeekDeep` target's `settings.base`, add the hardened-runtime keys (dev builds
   ignore them; Task 5.3 depends on them):

```yaml
        ENABLE_HARDENED_RUNTIME: YES
```

4. Append a second target at the end of the file:

```yaml
  SeekDeepTests:
    type: bundle.unit-test
    platform: macOS
    sources: [Tests]
    dependencies:
      - package: SeekDeepCore
    settings:
      base:
        GENERATE_INFOPLIST_FILE: YES
```

Then create a placeholder test so the target compiles:

`Tests/PlaceholderTests.swift`:

```swift
import XCTest
@testable import SeekDeepCore

final class PlaceholderTests: XCTestCase {
    func testPackageLoads() {
        XCTAssertEqual(JSONValue.string("ok").string, "ok")
    }
}
```

```bash
cd ~/pearprojects/seekdeep && xcodegen generate && xcodebuild -scheme SeekDeep -derivedDataPath build build 2>&1 | tail -3
```
Expected: `** BUILD SUCCEEDED **`

```bash
cd ~/pearprojects/seekdeep && xcodebuild -scheme SeekDeep -derivedDataPath build test 2>&1 | grep -E "Executed|TEST (SUCCEEDED|FAILED)" | tail -3
```
Expected: `Executed 1 test, with 0 failures` and `** TEST SUCCEEDED **`.

> `Tests/` here is the Xcode target's directory (it holds `PlaceholderTests.swift` only).
> The real logic tests live in `core/Tests/SeekDeepCoreTests/` and run with `swift test`;
> the Xcode target exists so UI-level tests have a home later.

Commit: `chore(app): wire SeekDeepCore and a test target into the project`

### Task 3.2 — Transports

`app/Services/ProcessTransport.swift` (DEBUG only):

```swift
#if DEBUG
import Foundation

/// DEV/TEST transport: spawns `node worklet/dev.js --stdio` and speaks the same
/// newline-JSON protocol as BareTransport. Never ships.
final class ProcessTransport: WorkletTransport, @unchecked Sendable {
    private let process = Process()
    private let stdinPipe = Pipe()
    private let stdoutPipe = Pipe()
    private let writeLock = NSLock()
    private let continuation: AsyncStream<Data>.Continuation
    let inbound: AsyncStream<Data>

    init(projectRoot: URL = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent(), storageRoot: URL) {
        var captured: AsyncStream<Data>.Continuation!
        inbound = AsyncStream { captured = $0 }
        continuation = captured
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["node", "worklet/dev.js", "--stdio", "--storage=\(storageRoot.path)"]
        process.currentDirectoryURL = projectRoot
        process.standardInput = stdinPipe
        process.standardOutput = stdoutPipe
        process.standardError = FileHandle.standardError
        stdoutPipe.fileHandleForReading.readabilityHandler = { [continuation] handle in
            let data = handle.availableData
            if data.isEmpty { continuation.finish() } else { continuation.yield(data) }
        }
    }

    func start() async throws { try process.run() }

    func send(_ data: Data) async throws {
        writeLock.lock()
        defer { writeLock.unlock() }
        try stdinPipe.fileHandleForWriting.write(contentsOf: data)
    }

    func stop() async {
        stdoutPipe.fileHandleForReading.readabilityHandler = nil
        if process.isRunning { process.terminate() }
        continuation.finish()
    }
}
#endif
```

`app/Services/BareTransport.swift` — **checked against `bare-kit-swift` on this machine**
(`Worklet` and `IPC` throw; `start` takes a filename plus `arguments`, and the reference
app's `start(name:ofType:)` does not exist):

```swift
import BareKit
import Foundation

/// Ships: the worklet runs on its own thread inside this process (bare-kit).
final class BareTransport: WorkletTransport, @unchecked Sendable {
    private var worklet: Worklet?
    private var ipc: IPC?
    private let storageRoot: URL
    private let continuation: AsyncStream<Data>.Continuation
    let inbound: AsyncStream<Data>

    init(storageRoot: URL) {
        self.storageRoot = storageRoot
        var captured: AsyncStream<Data>.Continuation!
        inbound = AsyncStream { captured = $0 }
        continuation = captured
    }

    func start() async throws {
        let worklet = try Worklet()
        let ipc = try IPC(worklet: worklet)
        self.worklet = worklet
        self.ipc = ipc
        // The storage root travels as a worklet argument: a Bare worklet has no Pear
        // config, so `resolveAppStorage()` in worker-runtime.js needs it passed in.
        // A relative filename resolves against the app bundle's resources.
        try worklet.start("app.bundle", arguments: ["--storage=\(storageRoot.path)"])

        Task { [ipc, continuation] in
            do {
                for try await chunk in ipc { continuation.yield(chunk) }
            } catch {
                continuation.finish()
            }
        }
    }

    func send(_ data: Data) async throws {
        guard let ipc else { throw BareKitError.closed }
        try await ipc.write(data)
    }

    /// Order matters: end the pipe, close the IPC, terminate, wait for the worklet's own
    /// teardown, then exit. `end()` alone leaves the worklet alive because BareKit keeps it
    /// running until both IPC sides have ended, and exiting with a live worklet aborts the
    /// process (exit 134, intermittently).
    func stop() async {
        continuation.finish()
        ipc?.end()
        ipc?.close()
        ipc = nil
        worklet?.terminate()
        _ = await worklet?.wait()
        worklet = nil
    }
}
```

`app/Services/WorkletHost.swift` — the small factory that picks a transport:

```swift
import Foundation

enum WorkletHost {
    static func storageRoot() throws -> URL {
        let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let root = base.appending(path: "SeekDeep", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    static func makeTransport(storageRoot: URL) -> any WorkletTransport {
        #if DEBUG
        if ProcessInfo.processInfo.environment["SEEKDEEP_DEV_TRANSPORT"] == "process" {
            return ProcessTransport(storageRoot: storageRoot)
        }
        #endif
        return BareTransport(storageRoot: storageRoot)
    }
}
```

```bash
cd ~/pearprojects/seekdeep && xcodebuild -scheme SeekDeep -derivedDataPath build build 2>&1 | tail -3
```
Expected: `** BUILD SUCCEEDED **`.

Commit: `feat(app): worklet transports`

### Task 3.3 — `ChatViewModel`

`app/ViewModels/ChatViewModel.swift`:

```swift
import Foundation
import SeekDeepCore
import SwiftUI

@MainActor
final class ChatViewModel: ObservableObject {
    @Published private(set) var state = ChatState()
    @Published var draft: String = ""
    @Published var isBusy = false
    @Published private(set) var slashCommands: [String] = []

    private let client: RPCClient
    private var eventTask: Task<Void, Never>?

    init(transport: any WorkletTransport) {
        self.client = RPCClient(transport: transport)
    }

    func start() async {
        do {
            try await client.start()
            eventTask = Task { [weak self] in
                guard let self else { return }
                for await notification in await self.client.notifications {
                    await self.handle(notification)
                }
            }
            await bootstrap()
            await loadSlashCommands()
        } catch {
            state = ChatReducer.reduce(state, .slash(content: "Could not start the worker: \(error.localizedDescription)", kind: "slash-error"))
        }
    }

    /// Mirrors `js/ui/startup.js`: create a room, then reconcile with the
    /// authoritative `chat.status` snapshot (the worker is the source of truth).
    private func bootstrap() async {
        do {
            let created = try await client.request("chat.create")
            state = ChatReducer.reduce(state, .status(
                topic: created["topic"]?.string,
                role: created["role"]?.string ?? "host",
                connected: state.connected,
                peerCount: state.peerCount,
                collaborative: state.collaborative,
                provider: state.provider))
            let status = try await client.request("chat.status")
            if let decoded = WorkerEvent.decode(notification: RPCNotification(name: "chat.event", data: merged(status, type: "status"))),
               case .status(let topic, let role, let connected, let peerCount, let collaborative, let provider) = decoded {
                state = ChatReducer.reduce(state, .status(topic: topic, role: role, connected: connected, peerCount: peerCount, collaborative: collaborative, provider: provider))
            }
        } catch {
            state = ChatReducer.reduce(state, .slash(content: "Could not create a chat room: \(error.localizedDescription)", kind: "slash-error"))
        }
    }

    private func merged(_ value: JSONValue, type: String) -> JSONValue {
        guard case .object(var object) = value else { return .object(["type": .str(type)]) }
        object["type"] = .str(type)
        return .object(object)
    }

    func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isBusy else { return }
        draft = ""
        state = ChatReducer.reduce(state, .message(ChatMessage(
            id: "local-\(UUID().uuidString)", kind: .user, content: text,
            fromPeer: state.role == "host" ? "Host" : "You", requestId: nil, timestamp: Date())))
        isBusy = true
        defer { isBusy = false }
        do {
            if text.hasPrefix("/") {
                _ = try await client.request("slash.dispatch", ["text": .str(text)])
            } else {
                guard let model = state.effectiveModel else { throw RPCError(message: "No model available — start Ollama or LM Studio") }
                _ = try await client.request("chat.send", ["prompt": .str(text), "model": .str(model)])
            }
        } catch {
            state = ChatReducer.reduce(state, .slash(content: error.localizedDescription, kind: "slash-error"))
        }
    }

    func join(topic raw: String) async {
        let topic = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard topic.count == 64, topic.allSatisfy(\.isHexDigit) else {
            state = ChatReducer.reduce(state, .slash(
                content: "Invalid topic key format. It should be a 64-character hexadecimal string.",
                kind: "slash-error"))
            return
        }
        do {
            let joined = try await client.request("chat.join", ["topic": .str(topic)])
            state = ChatReducer.reduce(state, .status(
                topic: joined["topic"]?.string, role: "peer", connected: false,
                peerCount: state.peerCount, collaborative: state.collaborative, provider: state.provider))
        } catch {
            state = ChatReducer.reduce(state, .slash(content: error.localizedDescription, kind: "slash-error"))
        }
    }

    func leave() async {
        _ = try? await client.request("chat.leave")
        state = ChatState()
    }

    func setMode(collaborative: Bool) async {
        do {
            _ = try await client.request("chat.setMode", ["collaborative": .bool(collaborative)])
        } catch {
            state = ChatReducer.reduce(state, .slash(content: error.localizedDescription, kind: "slash-error"))
        }
    }

    func selectModel(_ id: String) {
        state.selectedModel = id
    }

    func refreshModels() async {
        _ = try? await client.request("chat.refreshModels")
    }

    func setProvider(_ provider: String) async {
        do {
            _ = try await client.request("chat.setProvider", ["provider": .str(provider)])
        } catch {
            state = ChatReducer.reduce(state, .slash(content: error.localizedDescription, kind: "slash-error"))
        }
    }

    private func loadSlashCommands() async {
        guard let result = try? await client.request("slash.list"),
              let plugins = result["plugins"]?.array else { return }
        slashCommands = plugins
            .compactMap { $0["commands"]?.array }
            .flatMap { $0 }
            .compactMap(\.string)
            .sorted()
    }

    private func handle(_ notification: RPCNotification) async {
        guard let event = WorkerEvent.decode(notification: notification) else { return }
        state = ChatReducer.reduce(state, event)
    }
}
```

`state.selectedModel`, `state.effectiveModel`, `state.isHost` and `state.connected` are
all defined on `ChatState` in Task 2.6 — do not add a second copy in the app target.

```bash
cd ~/pearprojects/seekdeep && xcodebuild -scheme SeekDeep -derivedDataPath build build 2>&1 | grep -E "error:|BUILD" | head -20
```
Expected: `** BUILD SUCCEEDED **` and no `error:` lines.

Commit: `feat(app): chat view model`

### Task 3.4 — Message list and composer

`app/Views/MessageList.swift`:

```swift
import SeekDeepCore
import SwiftUI

struct MessageList: View {
    let messages: [ChatMessage]

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(messages) { message in
                        MessageRow(message: message)
                            .id(message.id)
                    }
                }
                .padding(10)
            }
            .onChange(of: messages.last?.id) { _, id in
                guard let id else { return }
                withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo(id, anchor: .bottom) }
            }
        }
        .background(Theme.canvas)
    }
}
```

`app/Views/MessageRow.swift` — bubble styling taken from `css/app.css`: user
`#4A6BBF` right-aligned, assistant `#33404F` left-aligned with a 3 pt `#81A1C1`
leading border, system `#4C566A` italic. Corner radius 12, with the "tail" corner at 0.

```swift
import SeekDeepCore
import SwiftUI

struct MessageRow: View {
    let message: ChatMessage

    private var body_: String { message.rawContent.isEmpty ? message.content : message.rawContent }

    private var blocks: [MarkdownBlocks.Block] { MarkdownBlocks.parse(body_) }

    var body: some View {
        HStack(spacing: 0) {
            if message.kind == .user { Spacer(minLength: 40) }
            VStack(alignment: .leading, spacing: 6) {
                if message.kind != .user, let from = message.fromPeer, !from.isEmpty {
                    Text(from)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.heading)
                }
                ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                    blockView(block)
                }
                if !message.isComplete {
                    ProgressView().controlSize(.mini)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(background)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            if message.kind != .user { Spacer(minLength: 40) }
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private func blockView(_ block: MarkdownBlocks.Block) -> some View {
        switch block {
        case .paragraph(let text):
            Text(inline(text))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        case .heading(let level, let text):
            Text(inline(text))
                .font(.system(size: level == 1 ? 17 : 14, weight: .semibold))
                .textSelection(.enabled)
        case .bullets(let items):
            VStack(alignment: .leading, spacing: 3) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    Text("• " + inline(item))
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        case .code(_, let text):
            CodeBlock(text: text)
        }
    }

    private var background: Color {
        switch message.kind {
        case .user: return Theme.userBubble
        case .assistant: return Theme.assistantBubble
        case .system, .bot: return Theme.systemBubble
        }
    }

    /// `AttributedString(markdown:)` is the native replacement for marked.js, but only
    /// for *inline* syntax — block structure is handled by `MarkdownBlocks` above.
    private func inline(_ text: String) -> AttributedString {
        (try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(text)
    }
}

private struct CodeBlock: View {
    let text: String

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Text(text)
                .font(.system(size: 12, design: .monospaced))
                .textSelection(.enabled)
                .padding(8)
        }
        .background(Theme.canvas)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}
```

`app/Views/Composer.swift` — `TextEditor` bound to `viewModel.draft`, ⌘↩ sends,
`:help`-style hint line under it, and the `/` palette as a `.popover` listing
`viewModel.slashCommands.filter { $0.hasPrefix(SlashQuery.command(in: draft, caret: draft.count) ?? "\u{0}") }`.
When empty, the palette is hidden (no empty popover — this is a real bug in the
current UI, cf. `js/ui/composer-discovery.js`).

`app/ContentView.swift` — `VStack`: `TopBar` (History button, topic + copy), `JoinBar`
(topic field + Join), `MessageList`, ephemeral banner, `Composer` with
provider/model/mode pickers.

`app/SeekDeepApp.swift`:

```swift
import SwiftUI

@main
struct SeekDeepApp: App {
    @StateObject private var model: ChatViewModel

    init() {
        let root = (try? WorkletHost.storageRoot()) ?? FileManager.default.temporaryDirectory
        _model = StateObject(wrappedValue: ChatViewModel(transport: WorkletHost.makeTransport(storageRoot: root)))
    }

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
                .frame(minWidth: 560, minHeight: 420)
                .task { await model.start() }
        }
        .defaultSize(width: 720, height: 540)
        .commands { CommandGroup(replacing: .newItem) {} }
    }
}
```

`app/Style/Theme.swift` — the exact palette from `css/app.css`:

```swift
enum Theme {
    static let chrome = Color(hex: 0x171C27)
    static let canvas = Color(hex: 0x232834)
    static let userBubble = Color(hex: 0x4A6BBF)
    static let assistantBubble = Color(hex: 0x3B4252)
    static let systemBubble = Color(hex: 0x4C566A)
    static let accent = Color(hex: 0x81A1C1)
    static let ephemeral = Color(hex: 0x2B3445)
    static let danger = Color(hex: 0xBF616A)
    static let warning = Color(hex: 0xEBCB8B)
    static let secondaryText = Color(hex: 0xD8DEE9)
    static let heading = Color(hex: 0x88C0D0)
}
```
with `init(hex:)` at the bottom of the file.

```bash
cd ~/pearprojects/seekdeep && xcodebuild -scheme SeekDeep -derivedDataPath build build 2>&1 | tail -3
open build/Build/Products/Debug/SeekDeep.app
```
Expected: a 720×540 dark window, topic field populated with 64 hex chars within ~3 s.

Commit: `feat(app): chat MVP`

### Task 3.5 — Prove the MVP against a real host

Terminal A (existing JS host, from the old repo):

```bash
cd ~/pearprojects/seekdeep && node scripts/local-dht.mjs   # leaves a DHT on 127.0.0.1:40001
```
Terminal B:

```bash
cd ~/pearprojects/seekdeep && node server.js --local-dht=40001
```
Expected:
```
SeekDeep headless host
Topic: <64 hex>
Public key: <64 hex>
OpenAI base URL: http://127.0.0.1:8080/v1
HTTP bind: 127.0.0.1:8080 (auth off)
Waiting for peers. Press Ctrl+C to exit.
```

Terminal C — the app, pointed at the same local DHT. Boot it with the env var (Task
5.2 wires this into the scheme; for now it is enough that the *app* joins the room):

```bash
SEEKDEEP_DEV_TRANSPORT=process open build/Build/Products/Debug/SeekDeep.app
```
In the app: paste the 64-hex topic from Terminal B into the topic field → Join.
Pick a model → type `hello` → Seek.

Expected: the assistant bubble streams a reply from the JS host's Ollama; the host
terminal prints nothing extra (private mode) — switch the app to Collaborative and
both sides see the prompt (verifiable in the host's OpenAI bridge logs only, which is
why Task 6.1 exists).

If the stream arrives but never completes, `done` is being dropped: check
`ChatReducer`'s `.response` handling — the JS sets `done: true` with an empty chunk.

Commit: `feat(app): verified against JS host`

---

### Phase 3 — as built

The chat MVP is live: the window opens, `chat.create` makes a room, models list, and a
prompt streams into a bubble. Verified headlessly end to end — the app, its own transport,
the real JS worker and a fake provider, with no human at the keyboard:

```
[seekdeep] transport: node process (dev), args=["--ollama-url=http://127.0.0.1:11999"]
[seekdeep] starting worker
[seekdeep] spawning node worklet/dev.js --stdio --storage=… --ollama-url=…
[seekdeep] transport started
[seekdeep] worker ready, room=39f216c1fd2c…6dc19
[seekdeep] response done: error=none, assistant=70 chars
```

`SEEKDEEP_AUTOSEND="say hi in five words"` drives composer → `chat.send` → stream →
`ChatReducer`; the fake provider (`scripts/e2e-worklet.mjs` + a tiny NDJSON server) makes
it repeatable without pulling a 4 GB model.

Corrections to the tasks above, all of them a compile error, a hang or a blank screen
first:

1. **`ProcessTransport` lives in the core, not the app.** Foundation-only, so `swift test`
   boots the real worker (`WorkletIntegrationTests`, 4 tests, `XCTSkip` when
   `worklet/dev.js` is missing). It takes `repositoryRoot:` and `additionalArguments:`.
2. **`SEEKDEEP_WORKLET_ARGS`** (space separated) forwards worker flags from `WorkletHost`,
   which is how the app points at a fake provider or a loopback DHT.
3. **xcodegen does not define `DEBUG`.** Without
   `settings.configs.Debug.SWIFT_ACTIVE_COMPILATION_CONDITIONS: DEBUG`, `#if DEBUG` is dead
   code and the app silently uses the embedded transport.
4. **Never derive the repo root from `#filePath`.** Xcode compiles package sources with
   *relative* paths, so `URL(fileURLWithPath: #filePath)` resolved to `/Users/nate` and the
   `Process` started in a directory that does not exist. `findRepositoryRoot(startingAt:)`
   walks up looking for `worklet/dev.js` instead.
5. **`MarkdownBlock` is the real name** (not `MarkdownBlocks`), with
   `.bulletList([String])` and `.code(String)` — no language payload; SwiftUI colours code
   from the palette.
6. **A blank app is window-state restoration, not layout.** macOS restores the previous
   window under an identifier SwiftUI derives from the view tree; after the probe build was
   replaced the restore failed (`restoreWindowWithIdentifier … window=0x0`) and SwiftUI
   opened nothing at all. Fix: `NSQuitAlwaysKeepsWindows: false`, and the dev launcher
   `scripts/run-native-app.sh` kills with `SIGKILL`, deletes
   `~/Library/Saved Application State/to.seekdeep.native.savedState`, and passes
   `-ApplePersistenceIgnoreState YES`.
7. **`MessageList` scrolls on content length**, not on the last id: a streaming chunk keeps
   the message id and only grows its text.
8. **Screenshots are unavailable in this environment.** `screencapture` needs Screen
   Recording and `CGWindowListCreateImage` is obsoleted in macOS 15. Verify with
   `CGWindowListCopyWindowInfo` (window exists + bounds) plus stderr logs, and ask the user
   to look.

Commands added: `npm run native:dev:app` (clean-state launch), `npm run native:e2e`
(worker + fake provider, asserts `STREAM_OK`).

Known, not fixed: the Release build fails to launch because the signed frameworks and the
ad-hoc binary disagree about Team ID. That is Phase 5 (signing), not a code defect.

---

## Phase 4 — fidelity

Each task is independently verifiable and ordered by user visibility, so stopping
early is safe. Every task names its file, ships its code, and ends with a command whose
output is checkable.

### Task 4.1 — Thinking blocks

The JS splitter (`js/messages/thinking.js`) is 45 lines and its whole contract is:
text inside `…` becomes reasoning, the **last** block wins, and an
unterminated block at end-of-stream leaves `open: true` and is excluded from the
answer. During streaming that last rule is what stops half a reasoning block from
leaking into the bubble.

**Test first** — `core/Tests/SeekDeepCoreTests/ThinkingTests.swift`:

```swift
import XCTest
@testable import SeekDeepCore

final class ThinkingTests: XCTestCase {
    func testSplitsReasoningFromAnswer() {
        let split = Thinking.split("a<think>why</think>b")
        XCTAssertEqual(split.answer, "ab")
        XCTAssertEqual(split.thinking, "why")
        XCTAssertFalse(split.open)
    }

    func testUnterminatedBlockIsExcludedFromAnswerWhileStreaming() {
        let split = Thinking.split("answer so far<think>still think")
        XCTAssertEqual(split.answer, "answer so far")
        XCTAssertEqual(split.thinking, "still think")
        XCTAssertTrue(split.open)
    }

    func testLastBlockWins() {
        XCTAssertEqual(Thinking.split("<think>one</think>mid<think>two</think>").thinking, "two")
    }
}
```

Implement `core/Sources/SeekDeepCore/Thinking.swift` as a straight port:

```swift
public struct ThinkingSplit: Equatable, Sendable {
    public var thinking: String
    public var answer: String
    public var open: Bool
}

public enum Thinking {
    static let openTag = "<think>"
    static let closeTag = "</think>"

    public static func split(_ text: String) -> ThinkingSplit {
        var thinking = ""
        var answer = ""
        var index = text.startIndex
        while index < text.endIndex {
            guard let start = text.range(of: Self.openTag, range: index..<text.endIndex) else {
                answer += text[index...]
                break
            }
            answer += text[index..<start.lowerBound]
            let bodyStart = start.upperBound
            guard let close = text.range(of: Self.closeTag, range: bodyStart..<text.endIndex) else {
                thinking = String(text[bodyStart...])
                return ThinkingSplit(thinking: thinking, answer: answer, open: true)
            }
            thinking = String(text[bodyStart..<close.lowerBound])
            index = close.upperBound
        }
        return ThinkingSplit(thinking: thinking, answer: answer, open: false)
    }
}
```

Then in `ChatState`, add `public var thinking: String = ""` and set it in the reducer's
`.response` branch from `Thinking.split(accumulated).thinking`; `MessageRow` shows it in
a `DisclosureGroup("Thinking")` above the bubble body, collapsed by default.

```bash
cd ~/pearprojects/seekdeep/core && swift test --filter ThinkingTests
```
Expected: `Executed 3 tests, with 0 failures`.

Commit: `feat(core): think-block splitter`

### Task 4.2 — Ephemeral banner with the right lifetime

Kinds come from `js/ui/ephemeral.js`: `slash-help`, `slash-error`, `slash-placeholder`.
Only `slash-error` must survive the auto-clear timer — the old UI kept errors on screen
until the next interaction, and losing an error message is the worst possible outcome.

**Test first** — add to `ChatReducerTests.swift`:

```swift
func testErrorEphemeralIsStickyWhileHelpExpires() {
    var state = ChatState()
    state = ChatReducer.reduce(state, .slash(content: "oops", kind: "slash-error"))
    XCTAssertFalse(ChatReducer.shouldExpireEphemeral(state.ephemeral, now: Date().addingTimeInterval(60)))
    state = ChatReducer.reduce(state, .slash(content: "help", kind: "slash-help"))
    XCTAssertTrue(ChatReducer.shouldExpireEphemeral(state.ephemeral, now: Date().addingTimeInterval(60)))
}
```

Implement in `core/Sources/SeekDeepCore/ChatReducer.swift`:

```swift
public static let ephemeralLifetime: TimeInterval = 6

public static func shouldExpireEphemeral(_ ephemeral: Ephemeral?, now: Date) -> Bool {
    guard let ephemeral, ephemeral.kind != "slash-error" else { return false }
    return now.timeIntervalSince(ephemeral.createdAt) >= ephemeralLifetime
}
```

`app/Views/EphemeralBanner.swift` renders `state.ephemeral` in a 1 pt dashed
`#81A1C1` box (solid `#BF616A` for `slash-error`), and `ContentView` runs a
`.task(id: state.ephemeral?.createdAt)` that sleeps 6 s and clears the slot only when
`shouldExpireEphemeral` says so.

```bash
cd ~/pearprojects/seekdeep/core && swift test --filter testErrorEphemeralIsStickyWhileHelpExpires
```
Expected: `Executed 1 test, with 0 failures`.

Commit: `feat(core): ephemeral banner lifetime`

### Task 4.3 — Saved history

`SessionStore` already exists (Task 2.9). Wire it in `app/ViewModels/ChatViewModel.swift`:

```swift
private let sessions: SessionStore?
private var saveTask: Task<Void, Never>?

private func persist() {
    guard let sessions, saveHistory else { return }
    saveTask?.cancel()
    let snapshot = state.messages
    saveTask = Task { [topic = state.topic] in
        try? await Task.sleep(for: .milliseconds(500))   // debounce streaming updates
        guard !Task.isCancelled else { return }
        try? await sessions.save(StoredSession(
            id: sessionID,
            name: topic.map { "Room \($0.prefix(8))" } ?? "Session",
            createdAt: sessionStartedAt,
            messages: snapshot))
    }
}
```

Call `persist()` from `handle(_:)` after `state` changes; set `saveHistory` from the
"Save History" toggle (default `true`, matching the old checkbox's `checked` state).

```bash
cd ~/pearprojects/seekdeep/core && swift test --filter SessionStoreTests
```
Expected: `Executed 3 tests, with 0 failures` (unchanged — this task adds no core logic).

Manual check: send two messages, ⌘Q, relaunch, open the sidebar → both present.

Commit: `feat(app): persist transcripts`

### Task 4.4 — Transcript export

Pure function, so it gets a test:

```swift
func testExportProducesStableMarkdown() {
    let messages = [
        ChatMessage(id: "1", kind: .user, content: "hi", fromPeer: "Host", timestamp: Date(timeIntervalSince1970: 0)),
        ChatMessage(id: "2", kind: .assistant, content: "hello", timestamp: Date(timeIntervalSince1970: 1))
    ]
    XCTAssertEqual(Transcript.export(messages: messages, topic: "abc"),
                   "# SeekDeep room abc\n\n**Host**\n\nhi\n\n**assistant**\n\nhello\n")
}
```

`core/Sources/SeekDeepCore/Transcript.swift`:

```swift
public enum Transcript {
    public static func export(messages: [ChatMessage], topic: String?) -> String {
        var out = "# SeekDeep room \(topic ?? "untitled")\n\n"
        for message in messages {
            let author = message.fromPeer ?? message.kind.rawValue
            out += "**\(author)**\n\n\(message.rawContent)\n\n"
        }
        return out
    }
}
```

Menu item writes it via `NSSavePanel` to a `.md` file.

```bash
cd ~/pearprojects/seekdeep/core && swift test --filter TranscriptTests
```
Expected: `Executed 1 test, with 0 failures`.

Commit: `feat(core): transcript export`

### Task 4.5 — Host-only controls

`chat.setProvider` and `chat.setMode` throw `Only the host can change …` on a peer
(`js/p2p/chat-service.js:399-422`). Bind the pickers' `.disabled(!model.state.isHost)`
and add `.help("Only the host can change …")`. Covered by
`testOnlyHostMayChangeProviderAndMode` from Task 2.6 — no new test needed.

```bash
cd ~/pearprojects/seekdeep/core && swift test --filter testOnlyHostMayChangeProviderAndMode
```
Expected: `Executed 1 test, with 0 failures`.

Commit: `feat(app): host-only controls`

### Task 4.6 — Empty and error states

One `enum EmptyReason { noProvider, noModel, noHost, workerFailed }` in `ChatState`,
derived (not stored) in a computed property, rendered by `app/Views/EmptyState.swift`.
Strings, verbatim from the worker so users can search them:

| State | String |
|---|---|
| no provider | `No LLM providers are available` |
| no model | `No model available — start Ollama or LM Studio` |
| no host | `Not connected to a host` |
| worker failed | the `RPCError.message` from the failed call |

```bash
cd ~/pearprojects/seekdeep && xcodebuild -scheme SeekDeep -derivedDataPath build build 2>&1 | tail -3
```
Expected: `** BUILD SUCCEEDED **`. Then stop Ollama (`ollama stop`), relaunch, and
confirm the app shows the "no provider" state instead of an empty window.

Commit: `feat(app): empty states`

---

## Phase 5 — packaging, signing, CI

### Task 5.1 — Verify the pre-actions fail loudly

Task 0.5 already wrote `set -e` + `test -s` into both pre-actions and Task 3.1 kept them.
Prove they work by breaking the worklet on purpose:

```bash
cd ~/pearprojects/seekdeep && cp worklet/backend.js /tmp/backend.js.bak
echo 'syntax error(' >> worklet/backend.js
xcodebuild -scheme SeekDeep -derivedDataPath build build 2>&1 | tail -5; echo "exit=$?"
cp /tmp/backend.js.bak worklet/backend.js
```
Expected: the build **fails** (`exit=65` or non-zero) and the tail shows `bare-pack`'s
error, not a green `BUILD SUCCEEDED`. Then confirm the restore:

```bash
cd ~/pearprojects/seekdeep && npm run native:pack && test -s app/app.bundle && echo PACK_OK
```
Expected: `PACK_OK`.

Commit: nothing (verification only). If the failure did *not* fail the build, fix the
pre-action before continuing — a silently stale bundle is the worst failure mode here.

### Task 5.2 — Dev scheme environment

Add to `project.yml`, inside the `SeekDeep` target's `scheme:` block, above
`preActions:`:

```yaml
      environmentVariables:
        SEEKDEEP_DEV_TRANSPORT: process
```

```bash
cd ~/pearprojects/seekdeep && xcodegen generate && npm run native:app 2>&1 | tail -2
```
Expected: `** BUILD SUCCEEDED **`; running from Xcode spawns a `node` child (visible in
Activity Monitor under SeekDeep). Release builds must not set this variable.

Commit: `chore(app): default the dev scheme to the process transport`

### Task 5.3 — Hardened runtime, notarization, universal binary

- Release builds: `ENABLE_HARDENED_RUNTIME=YES` (set in Task 3.1) plus the
  `allow-jit` and `allow-unsigned-executable-memory` entitlements already declared —
  V8 needs both, and the reference app documents JIT as mandatory.
- Universal slices — check the addons `bare-link` produced:

```bash
ls ~/pearprojects/seekdeep/app/addons/darwin/
```
Expected: `arm64` and `x64` directories. If only `arm64` is present, Intel builds fail at
runtime with a dlopen error: either ship arm64-only for v1 (document it in the README) or
run `npm run native:link` on an Intel builder and commit the result. **Decide explicitly;
do not leave it ambiguous in the release notes.**
- Sign:

```bash
codesign --deep --force --options runtime --sign "Developer ID Application: <NAME>" build/Build/Products/Release/SeekDeep.app
xcrun notarytool submit build/Build/Products/Release/SeekDeep.app.zip --keychain-profile seekdeep --wait
```
Expected: `status: Accepted`.
- The app is **unsandboxed** for v1: the sandbox blocks the DHT's UDP sockets and any
  process spawn. If App Store distribution is later required, the worklet has to move to
  an app extension — separate plan.

### Task 5.4 — CI: add a native job, keep the existing one

`.github/workflows/ci.yml` currently runs `npm ci --ignore-scripts`, `npm test` and
`npm run check:deps` on `ubuntu-latest`. Leave that job alone (it now also runs the three
worklet tests). Append a second job:

```yaml
  native:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22.23.4"
      - run: npm ci --ignore-scripts
      - run: cd core && swift test
      - run: npm run native:pack
      - run: test -s app/app.bundle
```

```bash
cd ~/pearprojects/seekdeep && git push -u origin native
gh run list --branch native --limit 3
```
Expected: two workflows listed (`test`, `native`); after they finish,
`gh run view --branch native` shows both green. `native` may take ~4 minutes (SwiftPM
cold build).

Commit: `ci: build and test the native target on macOS`

### Task 5.5 — Scripts, not a Makefile

`npm run` is already the repo's interface (`package.json`), so do not add a `Makefile`.
The six scripts from Task 0.3 are the whole build interface; verify each:

```bash
cd ~/pearprojects/seekdeep
npm run native:core 2>&1 | tail -2      # Executed N tests, with 0 failures
npm run native:pack && echo PACK_OK     # PACK_OK
npm run native:app 2>&1 | tail -2       # ** BUILD SUCCEEDED **
```

Expected: all three succeed; `npm test` still passes (`All 47 test files passed.`).

Add the build instructions to the **existing** `README.md` (new section at the end,
titled `## Native macOS build`), covering: prerequisites (Xcode 26, xcodegen, the
`BareKit` framework download step), `npm run native:app`, `npm run native:dev` for the
Node-transport dev loop, and the arm64-only caveat if it applies.

Commit: `docs: native build instructions`

### Task 5.6 — Push the branch

```bash
cd ~/pearprojects/seekdeep && git log --oneline origin/native..native | wc -l && git push origin native
```
Expected: a commit count ≥ the number of tasks completed, and a push that ends with
`native -> native`.

## Phase 6 — parity verification and cutover

### Task 6.1 — Interop harness (scripted, no UI)

`scripts/parity.sh` — the JS half of the acceptance test. It also proves the core still
works after all the JS/JS-edits of Phases 0–1:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# 1. local DHT on 127.0.0.1:40001
node scripts/local-dht.mjs & DHT=$!
sleep 1
# 2. JS host: owns the LLM, serves the room
node server.js --local-dht=40001 --http-port=8080 > /tmp/host.log 2>&1 & HOST=$!
sleep 3
TOPIC=$(grep -oE '[0-9a-f]{64}' /tmp/host.log | head -1)
echo "topic=$TOPIC"
# 3. JS bridge peer joins the same room, answers over HTTP
node bridge.js --local-dht=40001 --topic="$TOPIC" --http-port=8081 > /tmp/bridge.log 2>&1 & BRIDGE=$!
sleep 2
curl -sN http://127.0.0.1:8081/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen3","messages":[{"role":"user","content":"reply with exactly: ok"}]}' | head -c 200
echo
kill $BRIDGE $HOST $DHT 2>/dev/null || true
wait 2>/dev/null || true
```

```bash
chmod +x ~/pearprojects/seekdeep/scripts/parity.sh
cd ~/pearprojects/seekdeep && ./scripts/parity.sh
```
Expected: `topic=<64 hex>`, then a streamed chat completion body containing `ok`, then a
clean exit (no `Killed` noise from `set -e`).

The native half cannot be scripted without UI automation — say so plainly in
`docs/parity.md` and record the run: date, machine, Ollama model, topic, and whether the
app rendered the same text.

### Task 6.2 — Soak

30 minutes, 200 messages, 3 peers (2 native + 1 JS). Acceptance: no crash, RSS growth
< 100 MB per peer, every message rendered exactly once (the reducer's id dedupe is what
makes this pass), no orphaned `node`/`SeekDeep` process after quitting.

### Task 6.3 — Rollback

The native app writes to `~/Library/Application Support/SeekDeep`; the JS app writes to
Pear's app storage. Neither reads the other's drives, so rolling back is "delete the
.app" — and because **rooms are ephemeral (no message persistence in the protocol)**
there is nothing to migrate. Saved transcripts do not cross over; note it in the release
notes.

### Task 6.4 — Definition of done

- [ ] `npm test` green: `All 47 test files passed.`
- [ ] `npm run native:core` green on a clean clone (`core/.build` deleted).
- [ ] `npm run native:app` produces an app that boots the worklet (no `node` child).
- [ ] Joined a JS-hosted room (`./scripts/parity.sh` topic), streamed a reply, switched
      to collaborative, saw the peer's prompt appear in both clients.
- [ ] `/p2p help`, `/models`, `/p2p drive create` round-trip from the composer.
- [ ] Saved history survives relaunch; export produces valid Markdown.
- [ ] App runs with Ollama stopped (shows the "no provider" state, does not crash).
- [ ] README documents `npm run native:*`, the dev transport, and the limitations
      (arm64-only if applicable, no sandbox).
- [ ] `git status --short` clean, `git log --oneline origin/native..native` empty.

### Task 6.5 — Final push

```bash
cd ~/pearprojects/seekdeep
git status --short
git push origin native
gh pr create --base main --head native --title "Native macOS app (SwiftUI + embedded Bare core)" --body "$(cat <<'EOF'
Replaces the Electron renderer with a SwiftUI app while keeping the JS P2P/LLM/slash core,
bundled as a Bare worklet. Wire-compatible with existing peers; `/drive`, `/localdrive`,
`/mirror`, `/beam` and the plugin harness are unchanged.

- `core/` — SwiftPM package with the JSON-RPC client, reducer, markdown and session store (TDD'd)
- `app/` — SwiftUI shell, transports (BareKit for release, Node for dev)
- `worklet/` — 4 small JS entry points; the existing `js/**` core is untouched
- `npm test` covers the worklet via 3 new test files; CI gains a macOS job
EOF
)"
```
Expected: a PR URL. Do not merge without a manual run of Task 6.1's native half.

---

### Phase 2 — as built

The package shipped with these corrections to the tasks above. Each one was a compile
error or a test failure first, so they are not stylistic preferences:

1. **`Package.swift` argument order.** `swiftLanguageModes:` must come after `targets:`,
   or the manifest fails with `argument 'targets' must precede argument
   'swiftLanguageModes'`.
2. **`RPCClient.notifications` must be `nonisolated`.** It is an immutable `AsyncStream`,
   so isolating it only forces every caller onto the actor for no benefit — and tests can
   not iterate it at all without it.
3. **`JSONValue.int` rejects negatives and non-integers.** It exists for counts and
   millisecond timestamps; `-1` and `1.5` both return `nil`, so a hostile frame cannot
   produce a negative peer count.
4. **Request frames use `.sortedKeys`.** Without it the encoded key order is
   hash-dependent, which makes byte-level assertions (and captured-frame debugging)
   impossible.
5. **Two names differ from the task text:** the file is `MarkdownBlock.swift` and the type
   is `MarkdownBlock` (`Block` loses its `language` payload — SwiftUI colours code blocks
   from the palette, not from the fence info string).
6. **`ChatState.emptyReason` only reports `.noHost` when `role == "peer"`.** During the
   first few hundred milliseconds after launch the role is `"none"`, and showing
   "Not connected to a host" then is a lie.
7. **`Transcript` timestamps are UTC with an explicit `UTC` suffix**, so exports are
   unambiguous and testable.
8. **The Xcode scheme needs `testTargets: [SeekDeepTests]`**; without it
   `xcodebuild test` fails with "Scheme SeekDeep is not currently configured for the test
   action".

Verification actually run:

```bash
cd ~/pearprojects/seekdeep/core && swift test          # Executed 66 tests, with 0 failures
cd ~/pearprojects/seekdeep && npm test                # 47 files
cd ~/pearprojects/seekdeep && xcodebuild -scheme SeekDeep -destination 'platform=macOS' test
# ** TEST SUCCEEDED **
```

### Worklet shutdown — the rule that cost the most time

`ipc.end()` alone does **not** stop a worklet. BareKit keeps the worklet alive until both
sides of the IPC have ended, so the host's `await worklet.wait()` hangs forever (and
`exit()` while the thread is still running aborts the process, exit 134, roughly one run
in ten). Two cooperating pieces are required:

- **worklet side** (`worklet/worklet.js`): on `end`, close the backend and then end its
  own side of the IPC:

  ```js
  pipe.once('end', () => {
    void backend.close().catch(() => {}).then(() => { try { pipe.end() } catch {} })
  })
  ```

- **host side**: end, close, terminate, wait, then exit:

  ```swift
  ipc?.end()
  ipc?.close()
  worklet?.terminate()
  _ = await worklet?.wait()
  exit(code)
  ```

Verified by running the app binary four times in a row: `exit=0` each time.

---

## Phase 7 — retire the Electron renderer (blocked on approval)

Do **not** start this phase without an explicit "go" from the owner. It is listed so the
end state is unambiguous, and it is deliberately a single, revertable commit.

### Task 7.1 — Delete what the native app replaced

```bash
cd ~/pearprojects/seekdeep
git rm -r js/ui js/messages js/session index.html css lib/marked.min.js
git rm js/main.js js/chat-client.js index.js
git rm -r node_modules/pear-electron 2>/dev/null || true
```
Keep: `js/p2p`, `js/llm`, `js/slash`, `js/harness`, `js/openai`, `js/runtime`, `js/tui`,
`plugins/`, `server.js`, `bridge.js`, `tui.js`, `test/` (minus the three renderer-only
tests: `test/gui-*.test.js`, `test/renderer-csp.test.js`, `test/slash-ui.test.js`).

### Task 7.2 — Point the manifest at the native build

In `package.json`: drop the `pear` block, `pear-bridge`, `pear-electron`, `pear-interface`,
`jsdom`, `@testing-library/dom`, `supertest`; make `npm start` run
`npm run native:app && npm run native:run`.

```bash
cd ~/pearprojects/seekdeep && npm test 2>&1 | tail -2
```
Expected: all remaining test files pass (the count drops — record it).

```bash
npm run native:app 2>&1 | tail -2 && npm start
```
Expected: `** BUILD SUCCEEDED **` and the window opens.

Commit: `refactor: retire the Electron renderer`

### Task 7.3 — CI cleanup

Remove the now-dead `check:deps`… no: keep it (it still gates the lockfile). Instead
delete the Pear-specific bits from `.github/workflows/ci.yml` if any exist, and confirm
both jobs are green after the deletion commit.

```bash
cd ~/pearprojects/seekdeep && git push origin native && gh run list --branch native --limit 2
```
Expected: two green runs.

## 15. Tests and validation strategy

Five rings, each with a runner and a defined meaning. Rings 1 and 3 are the *same
command* — `npm test` — because the worklet tests were named to ride the existing runner.

| Ring | What | Command (from repo root) | Expected |
|---|---|---|---|
| 1. Existing suite | the 44 brittle files, untouched | `npm test` | `All 47 test files passed.` (44 + 3 worklet) |
| 2. Swift unit | frames, client, reducer, markdown, slash, sessions | `npm run native:core` | `Executed N tests, with 0 failures.` |
| 3. Worklet contract | adapter + boot + stdio entry | `node test/worklet-boot.test.js` | `1 test pass`, exit 0 |
| 4. Bundle | `bare-pack` produces a runnable bundle | `npm run native:pack && test -s app/app.bundle` | exit 0 |
| 5. Interop | native ↔ JS room, HTTP bridge | `./scripts/parity.sh` + manual matrix | same text both sides |

Rules for the implementer:

1. **Every Swift file starts as a failing test.** If you cannot write an assertion for
   it, it belongs in a view, not in `core`.
2. **No `sleep` in tests.** Use `waitUntil` (Task 2.4) or the async stream's own ordering.
   The one exception is `scripts/parity.sh`, where process startup genuinely needs it.
3. **Fixtures come from the JS.** When a payload shape is unclear, read
   `js/p2p/chat-service.js` and copy the object literal — do not invent fields.
4. **One commit per task**, message `type(scope): summary`. `git log --oneline` should
   read as the plan. Push after each phase, never mid-phase.
5. **The diff is additive until Phase 7.** No reformatting, no renames, no "while I'm
   here" cleanups in `js/**`, `index.html`, `css/`, or `package.json`'s existing keys.
6. **Never break `npm test`.** It is both the old app's regression gate and the new
   worklet's, and the ubuntu CI job runs it on every push.

## 16. Risks, tradeoffs, open questions

### Risks with mitigations

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | `bare-pack` cannot bundle `hyperdht`/`sodium-native` addons | blocks everything | **Phase 0 Tasks 0.4 and 0.5 gate the project.** Reference app proves it works; if it fails, fall back to `ProcessTransport` shipping a bundled `bare` binary as a helper (ugly but viable) and re-plan. |
| R2 | `Bare.IPC` write callback semantics differ from Node streams | hangs or dropped frames | Task 1.1's adapter pins the contract with 3 tests before anything else uses it |
| R3 | `Worklet.start` has no `args:` parameter | storage path not passed | documented fallback (Info.plist env); do not hardcode |
| R4 | App Sandbox blocks UDP + spawn | cannot ship to MAS | unsandboxed Developer ID for v1; document; extension-based worklet is a later plan |
| R5 | Two runtimes = ~60 MB app, ~40 MB idle RSS | feels un-native | accepted; measure in Task 6.2 and publish the number |
| R6 | V8 JIT entitlement required | Gatekeeper/hardened-runtime failures | entitlements in `project.yml`; test a notarized build before announcing |
| R7 | Divergence between Swift display logic and worker truth | messages lost/duplicated | id-based dedupe + reducer tests built on real payload fixtures; parity matrix |
| R8 | Native and JS renderers drift apart while both exist | two behaviours to reason about | they share one process boundary and one `js/**` core in the same repo; the JS renderer is read-only until Phase 7, and the reducer tests are built from the payloads that renderer receives |
| R9 | Implementer "improves" the protocol while porting | interop breaks | A2: JS wins; no protocol edits in this repo, ever |

### Tradeoffs accepted

- **Not a pure-native app.** There is a JS engine in the process. This is the same
  tradeoff Pear itself makes, and it is the only way to keep `/drive`, `/mirror`,
  `/beam` and the plugin harness.
- **Two test suites, two languages.** Offset by keeping the boundary thin: the Swift
  side never re-implements a network behaviour.
- **No protocol improvements.** Joined-at-the-hip to the old wire format until the JS
  app is retired.

### Open questions for the user (answer before Phase 3)

1. **Does "native rewrite" require zero JavaScript in the process?** If yes, this
   plan is wrong and Appendix A is the plan instead — say so before Task 0.4.
2. **Is App Store distribution a goal?** If yes, the sandbox/extension work must be
   scheduled up front (R4), not bolted on.
3. **arm64-only acceptable for v1?** (Removes the Intel addon problem.)
4. **Does the TUI survive?** Recommendation: yes, untouched — it is 851 lines that
   cost nothing and prove the core is headless.
5. **Who signs/notarizes?** Developer ID certificate + `notarytool` credentials must
   exist before Task 5.3.

---

## Appendix A — the Rust path, spelled out

For completeness, and because "plan a rewrite in Rust" deserves a real answer rather
than a dismissal. Estimated 3–6 months for one strong engineer; the Swift plan is
~3 weeks. Use this only if open question 1 is answered "yes".

### A.1 What would be ported, and what would be dropped

| Feature | Rust plan |
|---|---|
| Room discovery/join, Noise transport | `peeroxide` (`Hyperswarm`-compatible) — **keep** |
| Text chat, streaming, private/collaborative | `seekdeep-proto` + `tokio` — **keep**, re-implemented |
| Ollama / LM Studio adapters | `reqwest` + `serde` + `eventsource-stream` — **keep** |
| OpenAI/Anthropic HTTP surface | `axum` — **keep** (easier than today) |
| `/p2p`, `/status`, `/models`, `/help` | native `SlashCommand` trait — **keep** |
| `/drive`, `/localdrive`, `/mirror`, `/beam` | **dropped** — no Hyperdrive/Corestore in Rust |
| `/harness` (JS plugin files + Hyperdrive sync) | **redesigned** as native dynamic plugins (`libloading`) or dropped |
| Wire compat with existing JS peers | chat plane yes (frames are plain JSON), drives no |

### A.2 Workspace

```toml
# Cargo.toml
[workspace]
members = ["crates/proto", "crates/llm", "crates/net", "crates/harness", "crates/app", "crates/daemon"]
resolver = "2"

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
tokio = { version = "1", features = ["rt-multi-thread", "macros", "net", "time"] }
reqwest = { version = "0.12", features = ["json", "stream"] }
thiserror = "2"
tracing = "0.1"
```

```
crates/
  proto/src/frame.rs        # peer frames, tagged enum, serde
  proto/src/rpc.rs          # the Swift/CLI JSON-RPC surface
  llm/src/lib.rs            # LlmProvider trait
  llm/src/ollama.rs
  net/src/swarm.rs          # peeroxide wrapper
  harness/src/command.rs    # SlashCommand trait + registry
  app/src/main.rs           # egui or Tauri or UniFFI->SwiftUI
  daemon/src/main.rs        # headless host (replaces server.js)
```

### A.3 Type-safe frames (the actual win over JS)

```rust
// crates/proto/src/frame.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum PeerFrame {
    Handshake { client_id: String, display_name: String, timestamp: f64, is_host: bool },
    HandshakeAck { server_id: String },
    ModeUpdate { is_collaborative_mode: bool, is_host: bool },
    ModelsUpdate { models: Vec<ModelEntry> },
    ModelRequest,
    Query { model: String, prompt: String, request_id: String, #[serde(skip_serializing_if = "Option::is_none")] from_peer_id: Option<String> },
    ChatQuery {
        request_id: String,
        model: String,
        messages: Vec<Message>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")] tools: Vec<Tool>,
        temperature: Option<f32>,
        max_tokens: Option<u32>,
    },
    ChatResponse { request_id: String, kind: ResponseKind, text: Option<String>, error: Option<String> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResponseKind { Text, ToolCall, Done, Error }
```

`deny_unknown_fields` gives you, for free, what
`js/p2p/protocol.js` spends 231 lines hand-enforcing — and illegal frames become
unrepresentable rather than merely rejected.

Test:

```rust
#[test]
fn rejects_extra_fields_like_the_js_validator() {
    let json = r#"{"type":"handshake","clientId":"a","displayName":"b","timestamp":1.0,"isHost":true,"oops":1}"#;
    assert!(serde_json::from_str::<PeerFrame>(json).is_err());
}

#[test]
fn chat_query_round_trips_without_optional_noise() {
    let frame = PeerFrame::ChatQuery { request_id: "r".into(), model: "m".into(), messages: vec![], tools: vec![], temperature: None, max_tokens: None };
    let json = serde_json::to_string(&frame).unwrap();
    assert!(!json.contains("temperature"), "absent options must not serialize: {json}");
}
```

### A.4 Provider trait

```rust
#[async_trait::async_trait]
pub trait LlmProvider: Send + Sync {
    fn name(&self) -> &'static str;
    async fn list_models(&self) -> Result<Vec<ModelEntry>, LlmError>;
    async fn chat(&self, model: &str, req: ChatRequest, sink: tokio::sync::mpsc::Sender<ChatChunk>) -> Result<ChatOutcome, LlmError>;
}
```

Test with `wiremock` (assert the exact request body `{"model","messages","stream":true}`)
and `insta` snapshot of the parsed chunk sequence — a direct port of
`test/llm-provider.test.js`.

### A.5 Swift-vs-Rust test structure, side by side

| | Swift plan | Rust plan |
|---|---|---|
| unit runner | `swift test` (XCTest) | `cargo test` |
| async assertions | `waitUntil` polling helper | `tokio::test` + `timeout` |
| transport double | `RecordingTransport` actor | `impl Transport` with `mpsc` |
| HTTP fixtures | `URLProtocol` stub | `wiremock` |
| snapshots | explicit `XCTAssertEqual` on literals | `insta` |
| golden frames | JSON literals in test files | JSON literals + `serde_json` |
| E2E | `ProcessTransport` → `node worklet/dev.js` | two `seekdeepd` processes on a local DHT |

### A.6 Effort, honestly

| Work | Estimate |
|---|---|
| `proto` (frames + RPC + tests) | 1 week |
| `net` (peeroxide integration, holepunch behaviour, relay) | 3–4 weeks, plus unknown unknowns |
| `llm` (two adapters, streaming, tool calls) | 1 week |
| `harness` (native plugin ABI or a JS-less command set) | 2 weeks |
| `daemon` + `app` shell | 2–3 weeks |
| **Re-implementing drive/mirror/beam or accepting their loss** | **unbounded / product decision** |
| Total | 3–6 months |

---

## Appendix B — RPC method reference

Only what the native app calls, with the exact parameter keys the server accepts
(extracted from `js/p2p/rpc-server.js`'s `METHOD_SPECS`; extra keys are rejected).

| Method | Params | Result |
|---|---|---|
| `chat.status` | `{}` | `{initialized, topic, role, connected, peerCount, collaborative, provider, publicKey}` |
| `chat.create` | `{}` | `{topic, role:"host"}` |
| `chat.join` | `{topic:"<64 hex>"}` | `{topic, role:"peer"}` |
| `chat.leave` | `{}` | `{topic:null, role:"none"}` |
| `chat.peers` | `{}` | `{peers:[{id, displayName, role}]}` |
| `chat.send` | `{prompt, model}` | `{requestId}` |
| `chat.setMode` | `{collaborative: Bool}` | `{collaborative}` |
| `chat.refreshModels` | `{}` | `{provider, models:[{id,name,created?}]}` |
| `chat.setProvider` | `{provider:"ollama"\|"lmstudio"}` | `{provider, models}` |
| `slash.list` | `{}` | `{key, storageRoot, dirs, configPath, plugins:[{name,version,description,source,enabled,commands:[String]}]}` |
| `slash.dispatch` | `{text:"/p2p help"}` | `{handled: Bool, content?: String, metadata?: Object}` |

Errors the Swift layer must survive verbatim (all arrive as
`{"ok":false,"error":"<message>"}`):

- `Invalid topic key format. It should be a 64-character hexadecimal string.`
- `Only the host can change the collaboration mode`
- `Only the host can change the provider`
- `Not connected to a host`
- `No LLM providers are available`
