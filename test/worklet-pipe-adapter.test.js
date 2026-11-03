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

test('frames and end that arrive before subscribe are still delivered', async (t) => {
  const ipc = new FakeIpc()
  const pipe = createPipeAdapter(ipc)
  ipc.emit('data', Buffer.from('early'))
  ipc.emit('end')

  const seen = []
  const ended = new Promise((resolve) => pipe.once('end', resolve))
  pipe.on('data', (chunk) => seen.push(Buffer.from(chunk).toString()))
  await ended
  t.alike(seen, ['early'])
  t.is(pipe.writableEnded, true)
})
