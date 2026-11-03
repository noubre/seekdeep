#!/usr/bin/env node
/**
 * Drives `worklet/dev.js` over stdio and prints what happens, so the streaming path can be
 * checked without a UI: room creation, model list, a prompt, and the streamed reply.
 *
 *   node scripts/e2e-worklet.mjs --ollama-url=http://127.0.0.1:11999
 */
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'

const args = process.argv.slice(2)
const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'seekdeep-e2e-'))
const child = spawn(process.execPath, ['worklet/dev.js', '--stdio', `--storage=${storage}`, ...args], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'inherit']
})

let buffer = ''
const waiting = new Map()
const streamed = []
let done = null
const finished = new Promise((resolve) => { done = resolve })

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString()
  let index
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (!line.trim()) continue
    let frame
    try { frame = JSON.parse(line) } catch { continue }

    if (frame.event) {
      const data = frame.data || {}
      if (data.type === 'response') {
        streamed.push(data.chunk)
        if (data.error) console.log('[stream] error:', data.error)
        if (data.done) done()
      }
      if (data.type === 'status') console.log('[status]', JSON.stringify(data))
      if (data.type === 'models') console.log('[models]', JSON.stringify(data.models?.map((m) => m.id)))
      if (data.type === 'message') console.log('[message]', data.message?.type, '-', data.message?.content)
      continue
    }
    if (frame.id) waiting.get(frame.id)?.(frame)
  }
})

let id = 0
function request (method, params = {}) {
  id += 1
  const requestId = String(id)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 20000)
    waiting.set(requestId, (frame) => {
      clearTimeout(timer)
      waiting.delete(requestId)
      if (frame.ok) resolve(frame.result)
      else reject(new Error(typeof frame.error === 'string' ? frame.error : frame.error?.message))
    })
    child.stdin.write(`${JSON.stringify({ id: requestId, method, params })}\n`)
  })
}

try {
  const created = await request('chat.create')
  console.log('[room]', created.topic?.slice(0, 12) + '…', 'role=' + created.role)

  await request('chat.refreshModels')
  await new Promise((resolve) => setTimeout(resolve, 1200))

  const status = await request('chat.status')
  console.log('[status.provider]', status.provider, 'initialized=' + status.initialized)

  await request('chat.send', { prompt: 'say hi', model: 'fake-tiny:1b' })
  await Promise.race([finished, new Promise((_, reject) => setTimeout(() => reject(new Error('stream never finished')), 20000))])
  console.log('[reply]', JSON.stringify(streamed.join('')))
  console.log('[verify]', streamed.join('').includes('SeekDeep') ? 'STREAM_OK' : 'STREAM_EMPTY')
} catch (error) {
  console.error('[e2e] failed:', error.message)
  process.exitCode = 1
} finally {
  child.stdin.end()
  await new Promise((resolve) => child.once('exit', resolve))
  await fs.rm(storage, { recursive: true, force: true })
}
