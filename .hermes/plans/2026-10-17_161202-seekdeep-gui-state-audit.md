# SeekDeep GUI State and Startup Reliability Implementation Plan

> **For Hermes:** Use the `subagent-driven-development` skill to implement this plan task-by-task. Per the user’s standing convention, hand coding work to `omp`; independently verify every diff and command result before accepting it.

**Goal:** Make the SeekDeep desktop GUI reliably show its 64-hex room key after startup and fix other reproducible state-rendering, startup-error, and composer-error defects without changing the P2P protocol.

**Architecture:** Keep the Bare worker (`js/p2p/chat-service.js`) as the source of room/provider state and the renderer’s `clientState` as the single projection consumed by views. Add focused JSDOM regression tests around the renderer, then make the smallest changes in `js/ui/rendering.js`, a new startup helper, `js/main.js`, and composer routing; do not add a second state store or let DOM code call P2P services directly.

**Tech stack:** Pear desktop runtime, ES modules, JSDOM, Brittle, Hyperswarm worker RPC.

---

## Current context / assumptions

- Workspace: `/Users/nate/pearprojects/seekdeep`.
- Current branch: `Fix-Streaming`, eight commits ahead of `origin/Fix-Streaming`.
- The worktree is already heavily modified and contains untracked files. In particular, `js/main.js`, `js/ui/events.js`, `js/ui/submit-routing.js`, and many tests contain active work. **Do not reset, stash, clean, or bulk-stage this work.** Before implementation, the user must approve a baseline checkpoint/commit or another non-destructive isolation strategy. Later task commits must contain only reviewed task changes.
- Confirmed code defect: `js/session/client-state.js` receives `status.topic`, but `js/ui/rendering.js:217-221` never projects `topic` into `#current-topic`; the existing `updateTopicDisplay()` function is therefore never called.
- Confirmed adjacent state defects: renderer state does not synchronize or host-gate `#provider-select`; failed initial room creation is written only to `console.warn`; failed sends can reject out of the form handler, clear the user’s draft, and leave no durable GUI explanation.
- The latest observed `npm start` reached `✔ Pre-run [pear-electron/pre]: configure` and then the tracked process exited. A green implementation requires a sustained live window, not merely the pre-run marker.
- Do not broaden this work into Pear-runtime migration, visual redesign, protocol changes, provider refactoring, or persistence cleanup. Record unrelated findings separately.

## Acceptance criteria

1. Within five seconds of a normal launch, `#current-topic` visibly contains exactly 64 lowercase hexadecimal characters and its copy button is usable.
2. The topic display updates when joining another room and clears when leaving/no room is active.
3. Provider, model, collaboration mode, and peer widgets reflect `clientState`; controls that require the host are disabled for peers.
4. A create/status failure is visible inside the GUI; it is not console-only.
5. A failed or premature prompt submission keeps the draft and adds a system message explaining the failure; a successful submission clears it exactly once.
6. Focused tests, the full isolated suite, syntax checks, `git diff --check`, and a live GUI smoke test pass.
7. No topic/harness key, prompt, model response, or peer identifier is added to logs beyond the room key already intentionally displayed in the GUI.

---

## Task 0: Protect the existing work and establish a reproducible baseline

**Objective:** Ensure GUI fixes can be reviewed and committed without swallowing or discarding the current unrelated work.

**Files:** None.

**Step 1: Inspect the working tree**

Run:

```bash
cd /Users/nate/pearprojects/seekdeep
git status --short --branch
git diff --stat
git diff --check
```

Expected: branch `Fix-Streaming`; many tracked/untracked changes; `git diff --check` exits 0.

**Step 2: Obtain a safe baseline**

Stop and ask the user to approve one of these options:

1. Commit the current intentional work as a baseline checkpoint, or
2. Finish/commit the current feature work before GUI implementation.

Do not use `git reset`, `git clean`, or `git stash`. Do not proceed while task commits would mix unrelated changes.

**Step 3: Run the baseline suite**

After the baseline is safe, run:

```bash
npm test
```

Expected: exit 0 and a final line matching `All 40 test files passed.` If the number changes because the baseline gained tests, record the actual count. If any baseline test fails, stop and record it before editing GUI code.

**Step 4: Capture the baseline GUI defect**

Run:

```bash
npm start
```

Expected baseline observation: the Pear window opens, but the “Current Topic” row contains no 64-hex key. Record whether the process remains alive for 15 seconds and list every additional visible defect using this fixed checklist:

- Current topic/key and copy control
- Provider/model controls
- Host/peer mode control state
- Active-user chips
- Empty/loading/error states
- Prompt send and retained draft on failure
- History controls
- Layout at the configured 720×540 window size
- Keyboard operation: Tab, Enter, Shift+Enter, Cmd/Ctrl+Enter

Do not fix unconfirmed items during this step.

---

## Task 1: Add a failing renderer-state regression test

**Objective:** Prove that room, provider, model, mode, and peer state are projected from `clientState` into the existing GUI.

**Files:**
- Create: `test/gui-state-rendering.test.js`
- Read only: `index.html`
- Read only: `js/session/client-state.js`
- Read only: `js/ui/elements.js`
- Read only: `js/ui/rendering.js`

**Step 1: Create the failing test**

Create `test/gui-state-rendering.test.js` with exactly:

```js
import test from 'brittle';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { initializeElements } from '../js/ui/elements.js';
import { initializeRendering } from '../js/ui/rendering.js';
import { clientState, INITIAL_STATE } from '../js/session/client-state.js';
import { clear } from '../js/messages/store.js';

function installAppDom() {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://seekdeep.local/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  initializeElements();
  clear();
  clientState.setState({ ...INITIAL_STATE });
  initializeRendering();
  return dom;
}

test('renderer projects room and host controls from client state', function (t) {
  const dom = installAppDom();
  const topic = 'ab'.repeat(32);

  clientState.setState({
    topic,
    role: 'host',
    provider: 'lmstudio',
    collaborative: true,
    peers: [{ id: 'peer-1', displayName: 'Peer One', role: 'peer' }],
    models: [{ id: 'model-1', name: 'Model One' }]
  });

  const document = dom.window.document;
  const topicElement = document.getElementById('current-topic');
  const topicContainer = topicElement.parentElement;
  const provider = document.getElementById('provider-select');
  const model = document.getElementById('model-select');
  const mode = document.getElementById('chat-mode');
  const users = Array.from(document.querySelectorAll('#active-users .user-chip'));

  t.is(topicElement.textContent, topic, 'current room key is visible');
  t.is(topicContainer.style.display, 'flex', 'topic container is shown');
  t.is(provider.value, 'lmstudio', 'provider follows worker state');
  t.absent(provider.disabled, 'host can change provider');
  t.is(model.value, 'model-1', 'model list follows worker state');
  t.is(mode.value, 'collaborative', 'mode follows worker state');
  t.absent(mode.disabled, 'host can change mode');
  t.alike(users.map((node) => node.textContent), ['You', 'Peer One']);

  clientState.setState({ topic: null, role: 'peer', provider: 'ollama' });
  t.is(topicElement.textContent, '', 'topic clears after leaving');
  t.is(topicContainer.style.display, 'none', 'empty topic container is hidden');
  t.ok(provider.disabled, 'peer cannot change provider');
  t.ok(mode.disabled, 'peer cannot change mode');
});
```

**Step 2: Run it and verify the red state**

Run:

```bash
node test/gui-state-rendering.test.js
```

Expected: exit 1; the first failure says `current room key is visible` because the DOM text is empty rather than the 64-hex topic. Do not change production code until this exact regression is reproduced.

**Step 3: Commit only the failing test**

```bash
git add test/gui-state-rendering.test.js
git diff --cached --check
git diff --cached --name-only
git commit -m "test: reproduce missing GUI room state"
```

Expected staged-name output: only `test/gui-state-rendering.test.js`.

---

## Task 2: Project all existing room state into the GUI

**Objective:** Fix the missing key and keep host-gated controls synchronized from one renderer state function.

**Files:**
- Modify: `js/ui/rendering.js:7-14,193-221,236-242`
- Test: `test/gui-state-rendering.test.js`

**Step 1: Extend the existing elements import**

In `js/ui/rendering.js`, replace the import from `./elements.js` with:

```js
import {
  chatMessagesEl,
  activeUsersEl,
  modelSelect,
  providerSelect,
  chatModeSelect,
  setChatModeSelectValue,
  setChatModeSelectEnabled,
  updateTopicDisplay
} from './elements.js';
```

**Step 2: Add the minimal projection helpers**

Insert these functions immediately after `updateModelSelectFromState()`:

```js
function updateRoomDisplayFromState() {
  updateTopicDisplay(getState().topic);
}

function updateProviderSelectFromState() {
  if (!providerSelect) return;
  const { provider, role } = getState();
  const hasProvider = Array.from(providerSelect.options)
    .some((option) => option.value === provider);
  if (hasProvider) providerSelect.value = provider;
  providerSelect.disabled = role !== 'host';
}
```

Replace `renderClientState()` with:

```js
function renderClientState() {
  updateRoomDisplayFromState();
  updateActiveUsersDisplay();
  updateProviderSelectFromState();
  updateModelSelectFromState();
  updateModeSelectFromState();
}
```

Add `updateRoomDisplayFromState` and `updateProviderSelectFromState` to the export list so focused tests can call them if later debugging requires it.

**Step 3: Run focused tests**

```bash
node test/gui-state-rendering.test.js
node test/slash-ui.test.js
```

Expected: both commands exit 0; the new test passes every assertion and the existing renderer test file remains green.

**Step 4: Verify syntax and scope**

```bash
node --check js/ui/rendering.js
git diff --check
git diff -- js/ui/rendering.js test/gui-state-rendering.test.js
```

Expected: no syntax or whitespace errors; no worker, protocol, or storage changes.

**Step 5: Commit**

```bash
git add js/ui/rendering.js
git diff --cached --check
git diff --cached --name-only
git commit -m "fix: render room state in desktop GUI"
```

Expected staged-name output: only `js/ui/rendering.js`.

---

## Task 3: Make initial-room creation deterministic and visible

**Objective:** Reconcile the GUI from an authoritative `chat.status` snapshot after create and show startup failures in the chat instead of only the console.

**Files:**
- Create: `js/ui/startup.js`
- Create: `test/gui-startup.test.js`
- Modify: `js/main.js:70-74`

**Step 1: Write the failing startup-helper test**

Create `test/gui-startup.test.js`:

```js
import test from 'brittle';
import { createInitialRoom } from '../js/ui/startup.js';

test('initial room reconciles authoritative status into client state', async function (t) {
  const applied = [];
  const errors = [];
  const chatClient = {
    api: {
      async create() { return { topic: 'cd'.repeat(32), role: 'host' }; },
      async status() {
        return {
          topic: 'cd'.repeat(32),
          role: 'host',
          connected: false,
          peerCount: 0,
          collaborative: false,
          provider: 'ollama'
        };
      }
    }
  };

  const result = await createInitialRoom({
    chatClient,
    applyEvent: (event) => applied.push(event),
    reportError: (message) => errors.push(message)
  });

  t.ok(result.ok);
  t.is(applied.length, 1);
  t.alike(applied[0], {
    type: 'status',
    topic: 'cd'.repeat(32),
    role: 'host',
    connected: false,
    peerCount: 0,
    collaborative: false,
    provider: 'ollama'
  });
  t.alike(errors, []);
});

test('initial room failure is reported for GUI rendering', async function (t) {
  const applied = [];
  const errors = [];
  const result = await createInitialRoom({
    chatClient: { api: { async create() { throw new Error('worker unavailable'); } } },
    applyEvent: (event) => applied.push(event),
    reportError: (message) => errors.push(message)
  });

  t.absent(result.ok);
  t.alike(applied, []);
  t.alike(errors, ['Could not create a chat room: worker unavailable']);
});
```

**Step 2: Verify the red state**

```bash
node test/gui-startup.test.js
```

Expected: exit 1 with `ERR_MODULE_NOT_FOUND` for `js/ui/startup.js`.

**Step 3: Implement the pure helper**

Create `js/ui/startup.js`:

```js
async function createInitialRoom({ chatClient, applyEvent, reportError }) {
  if (!chatClient?.api?.create || !chatClient?.api?.status) {
    throw new TypeError('createInitialRoom requires chat create/status APIs');
  }
  if (typeof applyEvent !== 'function' || typeof reportError !== 'function') {
    throw new TypeError('createInitialRoom requires applyEvent and reportError callbacks');
  }

  try {
    await chatClient.api.create();
    const status = await chatClient.api.status();
    applyEvent({ type: 'status', ...status });
    return { ok: true, status };
  } catch (error) {
    const message = error?.message || 'unknown startup error';
    reportError(`Could not create a chat room: ${message}`);
    return { ok: false, error: message };
  }
}

export { createInitialRoom };
```

**Step 4: Use the helper in `js/main.js`**

Add:

```js
import { createInitialRoom } from './ui/startup.js';
```

Replace the current `chatClient.api.create().catch(...)` block with:

```js
  void createInitialRoom({
    chatClient,
    applyEvent: (event) => clientState.applyEvent(event),
    reportError: (message) => addMessage({ type: 'system', content: message })
  });
```

Do not remove the existing `chat.event` subscription; the status snapshot is reconciliation, not a replacement for events.

**Step 5: Run focused tests and checks**

```bash
node test/gui-startup.test.js
node test/gui-state-rendering.test.js
node --check js/ui/startup.js
node --check js/main.js
git diff --check
```

Expected: all commands exit 0.

**Step 6: Commit only reviewed hunks**

Because `js/main.js` was already dirty before this plan, do not run a blind `git add js/main.js`. Stage only the new import and helper call after comparing against the approved baseline, then verify:

```bash
git diff --cached --check
git diff --cached --name-only
git diff --cached
```

Expected: only `js/ui/startup.js`, `test/gui-startup.test.js`, and the two intentional `js/main.js` hunks. Then commit:

```bash
git commit -m "fix: reconcile desktop room startup state"
```

---

## Task 4: Preserve drafts and render composer failures

**Objective:** Prevent empty-model or RPC failures from becoming unhandled rejections or silently deleting the user’s prompt.

**Files:**
- Create: `test/gui-composer-errors.test.js`
- Modify: `js/ui/submit-routing.js:8-24`
- Modify: `js/ui/events.js:71-81`

**Step 1: Write the failing route tests**

Create `test/gui-composer-errors.test.js`:

```js
import test from 'brittle';
import { routePromptSubmission } from '../js/ui/submit-routing.js';

test('composer keeps the draft when no model is selected', async function (t) {
  let clearCount = 0;
  let askCount = 0;

  await t.exception.all(() => routePromptSubmission('keep me', {
    dispatchSlash: async () => false,
    getSelectedModel: () => '',
    clearPromptArea: () => { clearCount += 1; },
    ask: async () => { askCount += 1; }
  }), /select a model/i);

  t.is(clearCount, 0, 'validation failure keeps the draft');
  t.is(askCount, 0, 'validation failure does not call the worker');
});

test('composer clears the draft only after a successful send', async function (t) {
  let clearCount = 0;
  await routePromptSubmission('send me', {
    dispatchSlash: async () => false,
    getSelectedModel: () => 'model-1',
    clearPromptArea: () => { clearCount += 1; },
    ask: async () => ({ requestId: 'request-1' })
  });
  t.is(clearCount, 1);
});

test('composer keeps the draft when the worker rejects the send', async function (t) {
  let clearCount = 0;
  await t.exception.all(() => routePromptSubmission('retry me', {
    dispatchSlash: async () => false,
    getSelectedModel: () => 'model-1',
    clearPromptArea: () => { clearCount += 1; },
    ask: async () => { throw new Error('pipe closed'); }
  }), /pipe closed/);
  t.is(clearCount, 0);
});
```

**Step 2: Verify the red state**

```bash
node test/gui-composer-errors.test.js
```

Expected: exit 1; at least the “no model” and “worker rejects” draft-retention assertions fail under the current clear-before-send order.

**Step 3: Implement minimal route validation/order**

Replace the non-slash portion of `routePromptSubmission()` in `js/ui/submit-routing.js` with:

```js
  const model = getSelectedModel();
  if (!model) throw new Error('Select a model before sending a message.');
  await ask(model, prompt);
  clearPromptArea();
  return 'llm';
```

Keep the existing slash path unchanged: a successfully handled slash command still clears the composer and returns `'slash'`.

**Step 4: Catch errors at the GUI boundary**

Replace `handleFormSubmit()` in `js/ui/events.js` with:

```js
async function handleFormSubmit(event, chatClient) {
  event.preventDefault();
  const prompt = getPromptValue();
  if (prompt.length === 0) return;

  try {
    await routePromptSubmission(prompt, {
      dispatchSlash: (text) => chatClient.dispatchSlash(text),
      getSelectedModel,
      clearPromptArea,
      ask: (model, text) => chatClient.api.send({ prompt: text, model })
    });
  } catch (error) {
    const message = error?.message || 'unknown send error';
    systemMessage(`Could not send message: ${message}`);
  }
}
```

**Step 5: Extend the test to cover the visible error**

Append this complete test to `test/gui-composer-errors.test.js`:

```js
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { initializeElements } from '../js/ui/elements.js';
import { handleFormSubmit } from '../js/ui/events.js';
import { clear, getHistory } from '../js/messages/store.js';

test('form handler turns a send rejection into a system message', async function (t) {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://seekdeep.local/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  initializeElements();
  clear();

  const prompt = dom.window.document.querySelector('textarea[name="prompt"]');
  const model = dom.window.document.getElementById('model-select');
  model.innerHTML = '<option value="model-1">Model One</option>';
  prompt.value = 'retry me';

  await handleFormSubmit({ preventDefault() {} }, {
    dispatchSlash: async () => false,
    api: { async send() { throw new Error('pipe closed'); } }
  });

  t.is(prompt.value, 'retry me', 'failed send preserves the draft');
  t.ok(getHistory().some((message) => (
    message.type === 'system' && message.content === 'Could not send message: pipe closed'
  )), 'failure is visible in chat history');
});
```

Place all imports at the top of the file; do not leave imports between tests.

**Step 6: Run focused regressions**

```bash
node test/gui-composer-errors.test.js
node test/slash-ui.test.js
node --check js/ui/submit-routing.js
node --check js/ui/events.js
git diff --check
```

Expected: all commands exit 0; existing slash routing still passes.

**Step 7: Commit only reviewed hunks**

`js/ui/events.js` and `js/ui/submit-routing.js` were already dirty. Stage only the intentional hunks after comparing to the approved baseline. Verify the cached diff, then commit:

```bash
git diff --cached --check
git diff --cached
git commit -m "fix: preserve drafts on desktop send errors"
```

---

## Task 5: Fix only additional GUI defects reproduced during the checklist

**Objective:** Address the “other bugs” without turning the task into an unbounded redesign.

**Files:** Determined by the reproduced defect; likely limited to `index.html`, `css/app.css`, `js/ui/elements.js`, `js/ui/rendering.js`, or a new `test/gui-*.test.js`.

For each additional issue from Task 0, repeat this exact mini-cycle as its own commit:

1. Add one focused JSDOM test under `test/gui-<behavior>.test.js` (or a deterministic live smoke script only if JSDOM cannot represent the defect).
2. Run only that test and verify a relevant failure, not a setup failure.
3. Make the smallest implementation change in the existing view/controller module.
4. Run the focused test plus the nearest existing regression file.
5. Run `node --check` on every modified JavaScript file and `git diff --check`.
6. Commit only that issue with `fix: <specific GUI behavior>`.

Do **not** combine unrelated visual, history, P2P, provider, or protocol fixes. If an issue cannot be reproduced, document it under open questions and do not “improve” it speculatively.

---

## Task 6: Full automated validation

**Objective:** Prove the GUI fixes do not regress worker, RPC, slash, TUI, storage, or security behavior.

**Step 1: Run focused GUI files together**

```bash
node test/gui-state-rendering.test.js
node test/gui-startup.test.js
node test/gui-composer-errors.test.js
node test/slash-ui.test.js
```

Expected: each exits 0.

**Step 2: Run the complete isolated suite**

```bash
npm test
```

Expected: exit 0 and final output `All N test files passed.`, where `N` equals the actual number of `test/*.test.js` files after adding the GUI tests (43 if the baseline remains at 40 and only the three named files are added).

**Step 3: Run syntax and whitespace checks**

```bash
node --check js/main.js
node --check js/ui/rendering.js
node --check js/ui/startup.js
node --check js/ui/events.js
node --check js/ui/submit-routing.js
git diff --check
git status --short --branch
```

Expected: every syntax/check command exits 0; status contains no unexpected generated files.

**Step 4: Review the aggregate diff**

```bash
git diff HEAD~4..HEAD --stat
git diff HEAD~4..HEAD -- js/main.js js/ui/rendering.js js/ui/startup.js js/ui/events.js js/ui/submit-routing.js test/gui-state-rendering.test.js test/gui-startup.test.js test/gui-composer-errors.test.js
```

Adjust `HEAD~4` for the actual number of task commits. Expected: only the planned GUI/state/error changes; no protocol, worker-service, persistence, package-lock, dependency, or secret-bearing files.

---

## Task 7: Live Pear GUI verification

**Objective:** Verify the real renderer-worker pipe and window behavior that JSDOM cannot prove.

**Step 1: Launch a bounded local instance**

```bash
pear run --no-updates --tmp-store --no-ask . --local-dht=40001
```

Expected terminal output includes `✔ Pre-run [pear-electron/pre]: configure`; the process remains alive while the window is open and emits no `Uncaught`, `ERR_`, RPC timeout, or worker-pipe error.

**Step 2: Verify startup acceptance criteria in the window**

Within five seconds:

- “Current Topic” shows `/^[0-9a-f]{64}$/`.
- Copying it yields the exact visible value.
- Provider and model controls are populated or a visible provider error is shown.
- Mode is enabled for the host.
- The chat log contains no startup error.

**Step 3: Verify host/peer transitions with a second temporary instance**

Launch a second instance against the same local DHT using a separate temporary store, paste the first instance’s key, and join. Expected:

- Second window shows the same key.
- Second window’s provider and mode controls are disabled.
- Both windows show the other peer in active users.
- Leaving/joining does not leave a stale key.

Use temporary stores only; do not clear the user’s shared room or normal storage.

**Step 4: Verify error UX**

With no model selected (or with the provider deliberately unavailable in the temporary instance), submit `draft must remain`. Expected:

- The textarea still contains `draft must remain`.
- A system message begins `Could not send message:`.
- No uncaught promise rejection appears in the terminal/devtools console.

**Step 5: Close both windows cleanly**

Expected: both processes exit after their windows close; no orphan Pear/SeekDeep worker remains.

---

## Risks and tradeoffs

- **Dirty worktree:** The largest operational risk is accidentally committing or overwriting unrelated active work. Resolve the baseline before implementation and review the staged diff before every commit.
- **Duplicate status updates:** `chat.event` and the post-create `chat.status` snapshot may both apply the same state. This is intentional and idempotent; it closes the startup race without introducing another store.
- **Process lifetime:** A pre-run marker is insufficient. If the app exits immediately again, inspect the real process log/stack before touching GUI code; the cause may be runtime lifecycle rather than rendering.
- **Provider fallback:** Do not treat offline fallback models as proof that Ollama/LM Studio is reachable. The GUI should report send/provider errors honestly.
- **DOM singleton tests:** `initializeRendering()` is intentionally idempotent at module scope. Keep each new GUI test file isolated under the existing per-file process runner; do not place multiple independent DOM bootstraps in the same test file unless the singleton is explicitly resettable.
- **Privacy:** The room key is intentionally shareable and displayed, but must not be added to diagnostics, analytics, persistent history, or unrelated logs by these fixes.

## Open questions

1. Should the app show a textual `Creating room…` state before the key arrives, or simply hide the empty key container? This plan keeps the existing hide/show behavior and avoids new UI copy unless the live checklist shows confusion.
2. Was the observed post-`Pre-run` process exit caused by the user closing the window, or is it a reproducible startup lifecycle bug? Reproduce during Task 0; treat it as a separate blocker if it exits without user action.
3. Should peers be allowed to select a local provider for future private/local operations? Current service behavior makes provider changes host-only, so this plan disables the peer control. Change that only with an explicit product decision and worker/API design.
4. Which additional GUI bugs did the user observe? The fixed checklist captures them without guessing; only reproducible items enter Task 5.
