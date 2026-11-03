#!/usr/bin/env node
// Two native peers, one room, no UI — the check the plan called "2 native instances".
//
//   node scripts/two-peer-worklet.mjs
//
// Boots a loopback DHT, then two worklets (host + peer) over stdio. The host sends a
// prompt; the peer must see the user message and the streamed answer. This is the only
// script that exercises cross-process room semantics — `npm run native:soak` is one
// process, and the reducer tests never touch the wire.

import { execSync, spawn } from 'node:child_process'
import os from 'node:os'
import process from 'node:process'

const PORT = process.env.SEEKDEEP_DHT_PORT ?? '40001'
const OLLAMA = process.env.SEEKDEEP_OLLAMA_URL ?? 'http://127.0.0.1:11999'
const MODEL = process.env.SEEKDEEP_MODEL ?? 'fake-tiny:1b'

const dht = spawn(process.execPath, ['scripts/local-dht.mjs', PORT], { stdio: 'ignore' })

class Peer {
  constructor (name, extra = []) {
    this.name = name
    this.events = []
    this.pending = new Map()
    this.nextId = 1
    this.buffer = ''
    this.child = spawn(process.execPath, [
      'worklet/dev.js',
      '--stdio',
      `--storage=${os.tmpdir()}/seekdeep-2peer-${name}-${Date.now()}`,
      `--local-dht=${PORT}`,
      `--ollama-url=${OLLAMA}`,
      ...extra
    ], { stdio: ['pipe', 'pipe', 'inherit'] })

    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', chunk => {
      this.buffer += chunk
      let index
      while ((index = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, index).trim()
        this.buffer = this.buffer.slice(index + 1)
        if (!line) continue
        let frame
        try { frame = JSON.parse(line) } catch { continue }
        const key = frame.id == null ? null : String(frame.id)
        const waiter = key && this.pending.get(key)
        if (waiter) {
          this.pending.delete(key)
          waiter(frame)
        } else if (frame.event === 'chat.event') {
          const data = frame.data ?? {}
          if (data.type === 'response') {
            // Responses arrive per chunk; fold them the way the reducer does.
            const existing = this.events.find(e => e.type === 'response')
            if (existing) {
              existing.chunk += data.chunk ?? ''
              existing.done = existing.done || Boolean(data.done)
            } else {
              this.events.push({ type: 'response', chunk: data.chunk ?? '', done: Boolean(data.done) })
            }
          } else {
            this.events.push(data)
          }
        }
      }
    })
  }

  request (method, params = {}) {
    const id = String(this.nextId++)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${this.name}: timeout waiting for ${method}`))
      }, 45_000)
      this.pending.set(id, frame => {
        clearTimeout(timer)
        frame.ok === false ? reject(new Error(`${this.name}: ${method} failed: ${frame.error}`)) : resolve(frame.result ?? {})
      })
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
    })
  }

  waitFor (predicate, ms = 30_000) {
    const deadline = Date.now() + ms
    return (async () => {
      while (Date.now() < deadline) {
        const hit = this.events.find(predicate)
        if (hit) return hit
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      return null
    })()
  }

  kill () {
    this.child.stdin.end()
    this.child.kill('SIGTERM')
  }
}

const host = new Peer('host')
const peer = new Peer('peer')

function fail (message) {
  console.error('TWO_PEER_FAIL:', message)
  host.kill()
  peer.kill()
  dht.kill('SIGKILL')
  process.exit(1)
}

try {
  await new Promise(resolve => setTimeout(resolve, 1500)) // let the DHT come up
  const created = await host.request('chat.create')
  const topic = created.topic
  if (!topic || topic.length !== 64) fail(`host topic is not 64 hex chars: ${topic}`)
  console.log(`topic=${topic}`)

  await host.request('chat.setMode', { collaborative: true })
  console.log('host: collaborative mode on')
  await new Promise(resolve => setTimeout(resolve, 1500))

  await peer.request('chat.join', { topic })
  console.log('peer: joined')

  const connected = await host.waitFor(e => e.type === 'status' && e.peerCount > 0, 40_000)
  if (!connected) fail('host never reported a peer')
  console.log(`host: sees ${connected.peerCount} peer(s), role=${connected.role}`)

  // The peer reconnects once while the swarm settles (its DHT announcement lands after the
  // first connection), and a broadcast during that window is lost. Wait for the peer to
  // have received the mode change *and* the model list before sending.
  const peerReady = await peer.waitFor(
    e => (e.type === 'models' && Array.isArray(e.models)) || (e.type === 'mode' && e.collaborative === true),
    40_000
  )
  if (!peerReady) fail('peer never finished its handshake with the host')
  await new Promise(resolve => setTimeout(resolve, 2500))

  // Send, and retry a couple of times: a broadcast during a reconnect window is simply
  // lost (no ack, no queue), so the harness has to be tolerant or it reports a phantom bug.
  let userSeen = null
  for (let attempt = 1; attempt <= 3 && !userSeen; attempt++) {
    const hostStatus = [...host.events].reverse().find(e => e.type === 'status')
    console.log(`send attempt ${attempt}: host peerCount=${hostStatus?.peerCount}, collaborative=${hostStatus?.collaborative}`)
    await host.request('chat.send', { prompt: `two-peer hello ${attempt}`, model: MODEL })
    userSeen = await peer.waitFor(
      e => e.type === 'message' && String(e.message?.content ?? '').includes('two-peer'),
      12_000
    )
  }
  if (!userSeen) {
    // Known open defect (see .hermes/plans, "Open defect: collaborative mode reverts"):
    // with a second peer connected, the host's `collaborative` flag is false again by the
    // time `send()` runs, so the prompt is never broadcast and no error is raised. A solo
    // host keeps the flag, so this is specific to having a live connection.
    console.error('peer event types:', peer.events.map(e => e.type).join(','))
    console.error('peer messages:', peer.events.filter(e => e.type === 'message').map(e => e.message?.content).join(' | '))
    fail('peer never saw the prompt — host reported collaborative=true but sent nothing')
  }
  console.log('peer: received the prompt in the shared room')

  const answer = await peer.waitFor(e => e.type === 'response' && e.done && e.chunk.trim().length > 0, 40_000)
  if (!answer) fail('peer saw no streamed answer')
  console.log(`peer: streamed answer "${answer.chunk.trim().slice(0, 48)}"`)

  console.log('TWO_PEER_OK')
  host.kill()
  peer.kill()
  dht.kill('SIGTERM')
  await new Promise(resolve => setTimeout(resolve, 500))
  const leftover = execSync('pgrep -f "worklet/dev.js" | wc -l').toString().trim()
  console.log(`leftover workers: ${leftover}`)
  process.exit(0)
} catch (error) {
  fail(error.message)
}
