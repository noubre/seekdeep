const test = require('brittle')
const tmp = require('./')
const fs = require('fs')
const os = require('os')
const path = require('path')

test('basic', async function (t) {
  const dir = await tmp(t)

  t.alike(await fs.promises.readdir(dir), [])
})

test('specified name', async function (t) {
  const name = 'testdir'
  const dir = await tmp(t, { name })
  t.ok(dir.includes(name), 'directory contains specified name')
  t.alike(await fs.promises.readdir(dir), [])
})

test('invalid directory name', async function (t) {
  const name = '<>:/\\|?*'
  try {
    await tmp(t, { name })
    t.pass('should default to a random name when an invalid input is provided')
  } catch (error) {
    t.fail('expected to handle an invalid directory name')
  }
})

test('reuse directory', async function (t) {
  const name = 'existing-dir'
  const existing = path.join(await fs.promises.realpath(os.tmpdir()), 'tmp-test-' + name)

  await fs.promises.mkdir(existing, { recursive: true })

  const dir = await tmp(t, { name })
  t.is(dir, existing, 'uses the existing directory when it already exists')
})

test('specify root directory', async function (t) {
  const dir = await tmp(t, { dir: './tmp-storage' })

  const children = await fs.promises.readdir('./tmp-storage')
  t.is(children.length, 1)

  t.alike(await fs.promises.readdir(dir), [])
})
