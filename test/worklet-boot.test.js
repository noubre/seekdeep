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
        if (!line) continue
        const parsed = JSON.parse(line)
        // Startup harness.plugin notifications precede the chat.status reply.
        if (parsed.id === '1') resolve(parsed)
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
