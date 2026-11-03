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
