const fs = require('fs')
const path = require('path')
const fsx = require('fs-native-extensions')
const b4a = require('b4a')
const ReadyResource = require('ready-resource')
const FDLock = require('fd-lock')

const PLATFORM = global.Bare ? global.Bare.platform : global.process.platform
const IS_WIN = PLATFORM === 'win32'
const IS_LINUX = PLATFORM === 'linux'
const MODIFIED_SLACK = 5000
const EMPTY = b4a.alloc(0)
const ATTR = IS_LINUX ? 'user.device-file' : 'device-file'

const nl = IS_WIN ? '\r\n' : '\n'

module.exports = class DeviceFile extends ReadyResource {
  constructor(filename, { create = true, wait = false, lock = wait, data = {} } = {}) {
    super()

    this.filename = filename
    this.data = data
    this.lock = null

    this._create = create
    this._wait = wait
    this._lock = lock
  }

  async _open() {
    if (await verifyDeviceFile(this)) return
    if (!this._create) throw new Error('No device file present')
    await writeDeviceFile(this)
  }

  transfer() {
    return this.lock ? this.lock.transfer() : -1
  }

  async _close() {
    if (this.lock) await this.lock.close()
  }

  async suspend() {
    if (!this.opened) await this.ready()
    if (this.lock) await this.lock.suspend()
  }

  async resume() {
    if (!this.opened) await this.ready()
    if (this.lock) await this.lock.resume()
  }
}

async function writeDeviceFile(device) {
  let s = ''

  for (const [key, value] of Object.entries(device.data)) {
    if (value === null) continue
    s += key + '=' + value + nl
  }

  await fs.promises.mkdir(path.dirname(device.filename), { recursive: true })

  const fd = await open(device.filename, 'w')

  device.lock = device._lock ? new FDLock(fd, { wait: device._wait }) : null

  if (device.lock) {
    try {
      await device.lock.ready()
    } catch (err) {
      await device.lock.close()
      throw err
    }
  }

  const st = await fstat(fd)

  const created = Date.now()

  s += 'device/platform=' + PLATFORM + nl
  s += 'device/inode=' + st.ino + nl
  s += 'device/created=' + created + nl

  if (await setAttr(fd, ATTR, b4a.from('original'))) {
    s += 'device/attribute=original' + nl
  }

  await write(fd, b4a.from(s))

  if (!device.lock) await close(fd)
}

async function verifyDeviceFile(device) {
  let fd = 0

  try {
    fd = await open(device.filename, 'r+')
  } catch (e) {
    fd = 0
  }

  if (fd === 0) return false

  device.lock = device._lock ? new FDLock(fd, { wait: device._wait }) : null

  if (device.lock) {
    try {
      await device.lock.ready()
    } catch (err) {
      await device.lock.close()
      throw err
    }
  }

  const buf = await read(fd)
  const result = {}

  const s = b4a.toString(buf).trim().split('\n')

  let inode = 0
  let created = 0
  let attr = ''
  let platform = ''

  for (const ln of s) {
    const i = ln.indexOf('=')
    if (i === -1) continue

    const k = ln.slice(0, i).trim()
    const v = ln.slice(i + 1).trim()

    switch (k) {
      case 'device/platform':
        platform = v
        break
      case 'device/inode':
        inode = Number(v)
        break
      case 'device/created':
        created = Number(v)
        break
      case 'device/attribute':
        attr = v
        break
      default:
        result[k] = v
        break
    }
  }

  for (const [k, v] of Object.entries(device.data)) {
    if (v === null) continue
    if (result[k] === undefined) continue // allow upserts
    if (result[k] !== '' + v) {
      await teardown()
      throw new Error('Invalid device file, ' + k + ' has changed. Was ' + result[k] + ', is ' + v)
    }
  }

  const st = await fstat(fd)
  const at = await getAttr(fd, ATTR)

  const sameAttr = b4a.toString(at || EMPTY) === attr
  const modified = Math.max(st.mtime.getTime(), st.birthtime.getTime())

  if (platform && platform !== PLATFORM) {
    await teardown()
    throw new Error('Invalid device file, was made on different platform')
  }

  if (!sameAttr) {
    await teardown()
    throw new Error('Invalid device file, was moved unsafely')
  }

  if (st.ino !== inode || (created && Math.abs(modified - created) >= MODIFIED_SLACK)) {
    await teardown()
    throw new Error('Invalid device file, was modified')
  }

  if (!device.lock) await close(fd)

  device.data = result
  return true

  async function teardown () {
    if (device.lock) await device.lock.close()
    else await close(fd)
  }
}

async function getAttr(fd, name) {
  try {
    return await fsx.getAttr(fd, name)
  } catch {
    return null
  }
}

async function setAttr(fd, name, value) {
  try {
    await fsx.setAttr(fd, name, value)
    return true
  } catch {
    return false
  }
}

function fstat(fd) {
  return new Promise((resolve, reject) => {
    fs.fstat(fd, (err, st) => {
      if (err) reject(err)
      resolve(st)
    })
  })
}

function close(fd) {
  return new Promise((resolve, reject) => {
    fs.close(fd, (err, st) => {
      if (err) reject(err)
      resolve(st)
    })
  })
}

function write(fd, buf) {
  return new Promise((resolve, reject) => {
    let offset = 0

    onwrite(null, 0)

    function onwrite(err, wrote) {
      if (err) return reject(err)
      if (offset === buf.byteLength) return resolve()
      offset += wrote
      fs.write(fd, buf, offset, buf.byteLength - offset, offset, onwrite)
    }
  })
}

function read(fd) {
  const buf = b4a.allocUnsafe(4096)

  return new Promise((resolve, reject) => {
    let offset = 0

    fs.read(fd, buf, 0, buf.byteLength, 0, onread)

    function onread(err, read) {
      if (err) return reject(err)
      if (read === 0) return resolve(buf.subarray(0, offset))
      offset += read
      fs.read(fd, buf, offset, buf.byteLength - offset, offset, onread)
    }
  })
}

function open(filename, flags) {
  return new Promise((resolve, reject) => {
    fs.open(filename, flags, (err, fd) => {
      if (err) reject(err)
      resolve(fd)
    })
  })
}
