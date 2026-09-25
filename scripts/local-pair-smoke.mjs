import DHT from 'hyperdht';
import Hyperswarm from 'hyperswarm';
import crypto from 'hypercore-crypto';
import b4a from 'b4a';

const PORT = 41003;
const bootstrapNode = DHT.bootstrapper(PORT, '127.0.0.1');
await bootstrapNode.ready();
console.log('bootstrapper ready on 127.0.0.1:' + PORT);

const bootstrap = [{ host: '127.0.0.1', port: PORT }];
const a = new Hyperswarm({ bootstrap });
const b = new Hyperswarm({ bootstrap });

const topic = crypto.randomBytes(32);
let aConn = null;
let bConn = null;
a.on('connection', (c) => { aConn = c; console.log('A connected', b4a.toString(c.remotePublicKey, 'hex').slice(0, 12)); });
b.on('connection', (c) => { bConn = c; console.log('B connected', b4a.toString(c.remotePublicKey, 'hex').slice(0, 12)); });

const discovery = a.join(topic, { server: true, client: false });
try { await discovery.flushed(); console.log('A announce flushed'); } catch (e) { console.log('A flushed error:', e.message); }
b.join(topic, { server: false, client: true });

try {
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('NO CONNECTION within 20s')), 20000);
    const poll = () => { if (aConn && bConn) { clearTimeout(t); resolve(); } else setTimeout(poll, 250); };
    poll();
  });
  console.log('RESULT: CONNECTED');
} catch (e) {
  console.log('RESULT:', e.message);
} finally {
  for (const s of [a, b]) { try { await s.destroy(); } catch {} }
  try { await bootstrapNode.destroy(); } catch {}
}
process.exit(0);
