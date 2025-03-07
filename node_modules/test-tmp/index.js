const os = require('os')
const path = require('path')
const fs = require('fs')

module.exports = tmp

async function tmp (t, { dir = null, name = null, order = Infinity, force = true } = {}) {
  if (!valid(name)) name = Math.random().toString(16).slice(2)

  if (dir) {
    await fs.promises.mkdir(dir, { recursive: true })
  }

  const tmpdir = path.join(await fs.promises.realpath(dir || os.tmpdir()), 'tmp-test-' + name)

  try {
    await gc(tmpdir)
  } catch {}

  await fs.promises.mkdir(tmpdir, { recursive: true })

  if (t) t.teardown(gc, { order, force })
  return tmpdir

  async function gc () {
    await fs.promises.rm(tmpdir, { recursive: true })
  }

  function valid (name) {
    if (typeof name !== 'string') return false

    const chars = /[<>:/\\|?*]/
    const max = 64

    return !chars.test(name) && name.length <= max
  }
}
