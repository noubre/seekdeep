#!/usr/bin/env node
// Soak: one real worker, many turns, no UI.
//
// What this is for: the risky part of this app is the long-lived worker — a leak in the
// stream plumbing, a request id that eventually collides, a reply that never terminates.
// Rendering is covered by reducer tests; this covers the process.
//
//   node scripts/soak-worklet.mjs [--turns 200]
//
// Needs a provider at --ollama-url (scripts/fake-ollama.py stands one up in a second).

import { execSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import os from 'node:os'
import process from 'node:process'

const argv = process.argv.slice(2)
const turns = Number(argv.includes('--turns') ? argv[argv.indexOf('--turns') + 1] : 200)
const ollamaURL = process.env.SEEKDEEP_OLLAMA_URL ?? 'http://127.0.0.1:11999'
const storage = `${os.tmpdir()}/seekdeep-soak-${Date.now()}`

const child = spawn(process.execPath, [
  'worklet/dev.js',
  '--stdio',
  `--storage=${storage}`,
  `--ollama-url=${ollamaURL}`
], { stdio: ['pipe', 'pipe', 'inherit'] })

const rssMB = () => Math.round(Number(execSync(`ps -o rss= -p ${child.pid}`).toString().trim()) / 1024)

let buffer = ''
let nextId = 1
const pending = new Map()
const events = []

child.stdout.setEncoding('utf8')
child.stdout.on('data', chunk => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    let frame
    try { frame = JSON.parse(line) } catch { continue }
    // Ids are echoed as numbers by some paths and strings by others; normalise.
    const key = frame.id === undefined || frame.id === null ? null : String(frame.id)
    const waiter = key && pending.get(key)
    if (waiter) {
      pending.delete(key)
      waiter(frame)
    } else if (frame.event === 'chat.event') {
      // Frames are {event, data} on the wire, not JSON-RPC {method, params}.
      events.push(frame.data ?? {})
    }
  }
})

function request (method, params = {}) {
  const id = String(nextId++)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(String(id))
      reject(new Error(`timeout waiting for ${method}`))
    }, 60_000)
    pending.set(String(id), frame => {
      clearTimeout(timer)
      resolve(frame)
    })
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
  })
}

try {
  // No boot handshake: the worker writes nothing until asked, so waiting for first bytes
  // hangs forever. The first request is the handshake.
  process.stdout.write('soak: creating room\n')
  const created = await request('chat.create')
  if (!created.result?.topic) throw new Error('chat.create returned no topic')

  process.stdout.write(`soak: topic=${created.result?.topic?.slice(0, 12)}…\n`)
  // `chat.refreshModels` is registered asParams and does not answer a caller, so the model
  // is named directly. It must exist on the provider: fake-tiny:1b for the fake server.
  const model = process.env.SEEKDEEP_MODEL ?? 'fake-tiny:1b'

  const startRSS = rssMB()
  const started = Date.now()
  let answered = 0
  let empty = 0

  for (let turn = 1; turn <= turns; turn++) {
    const seen = events.length
    await request('chat.send', { prompt: `turn ${turn}`, model })
    const deadline = Date.now() + 60_000
    let text = ''
    while (Date.now() < deadline) {
      // Response frames carry {chunk, done} — there is no cumulative content field.
      const fresh = events.slice(seen).filter(e => e.type === 'response')
      text = fresh.map(e => e.chunk ?? '').join('')
      if (fresh.some(e => e.done)) break
      await new Promise(resolve => setTimeout(resolve, 15))
    }
    if (text) answered++
    else empty++
    if (turn % 25 === 0) {
      process.stdout.write(`  ${turn}/${turns} turns · ${answered} answered · rss ${rssMB()} MB\n`)
    }
  }

  const endRSS = rssMB()
  const growth = endRSS - startRSS
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`\nturns=${turns} answered=${answered} empty=${empty} in ${seconds}s`)
  console.log(`rss start=${startRSS}MB end=${endRSS}MB growth=${growth}MB`)
  const ok = answered === turns && growth < 100
  console.log(ok ? 'SOAK_OK' : 'SOAK_FAIL')

  child.stdin.end()
  const exit = once(child, 'exit')
  child.kill('SIGTERM')
  await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 5_000))])
  process.exit(ok ? 0 : 1)
} catch (error) {
  console.error('soak error:', error.message)
  child.kill('SIGKILL')
  process.exit(1)
}
