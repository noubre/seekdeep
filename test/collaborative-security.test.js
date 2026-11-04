/**
 * Client-side room state projector (js/session/client-state.js): maps chat events
 * onto collaborative/peer state; this test is its remaining consumer.
 */
import test from 'brittle';

const clientStateModule = await import('../js/session/client-state.js');

test('collaborative mode is tracked from chat events', function (t) {
  const state = clientStateModule.createClientState();
  t.is(state.getState().collaborative, false, 'starts in private mode');

  let observed = null;
  state.subscribe((next) => { observed = next; });
  state.applyEvent({ type: 'mode', collaborative: true });
  t.is(state.getState().collaborative, true, 'collaborative mode can be enabled');
  t.is(observed.collaborative, true, 'subscribers are notified');

  state.applyEvent({ type: 'mode', collaborative: false });
  t.is(state.getState().collaborative, false, 'collaborative mode can be disabled');
});
