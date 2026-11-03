import test from 'brittle';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

function installAppDom() {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://seekdeep.local/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  return dom;
}

test('persistence preference gates localStorage saves and drives the checkbox', async function (t) {
  const dom = installAppDom();
  t.teardown(() => {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.localStorage;
  });

  globalThis.localStorage.setItem('seekdeep-persistence-enabled', 'false');

  // Module-level loadPersistencePreference() runs on import, so the fake must be
  // installed first.
  const [{ initializeElements }, events, sessionStore] = await Promise.all([
    import('../js/ui/elements.js'),
    import('../js/ui/events.js'),
    import('../js/session/session-store.js')
  ]);

  t.is(sessionStore.isPersistenceEnabled(), false, 'restored preference is disabled');

  await sessionStore.exportSession();
  t.is(globalThis.localStorage.getItem('seekdeep-sessions-registry'), null, 'disabled persistence writes no registry entry');

  initializeElements();
  events.setupEventListeners({ chatClient: { api: {} } });
  t.is(dom.window.document.getElementById('persistence-enabled').checked, false, 'checkbox reflects the stored preference');

  sessionStore.setPersistenceEnabled(true);
  await sessionStore.exportSession();
  t.ok(globalThis.localStorage.getItem('seekdeep-sessions-registry'), 'enabled persistence writes the registry');
});
