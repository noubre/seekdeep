const fs = require('fs')
const fsx = require('fs-native-extensions')
const onexit = require('resource-on-exit')
const ReadyResource = require('ready-resource')

module.exports = class FDLock extends ReadyResource {
  constructor(fd, opts = {}) {
    const { wait = false } = opts

    super()

    this._fd = fd
    this._wait = wait
    this._locked = false

    onexit.add(this, closeSync)
  }

  async _open() {
    try {
      await this._resume()
    } catch (err) {
      onexit.remove(this)
      await close(this)
      throw err
    }
  }

  async _close() {
    onexit.remove(this)
    await close(this)
  }

  transfer() {
    const fd = this._fd
    if (fd === -1) throw new Error('Lock has already been transferred')
    this._fd = -1
    onexit.remove(this)
    return fd
  }

  async suspend() {
    if (!this.opened) await this.ready()
    return this._suspend()
  }

  async _suspend() {
    if (this._fd === -1 || this._locked === false) return
    fsx.unlock(this._fd)
    this._locked = false
  }

  async resume() {
    if (!this.opened) await this.ready()
    return this._resume()
  }

  async _resume() {
    if (this._fd === -1 || this._locked === true) return
    if (this._wait) await fsx.waitForLock(this._fd)
    else if (!fsx.tryLock(this._fd)) {
      throw new Error('File descriptor could not be locked')
    }
    this._locked = true
  }
}

function close(lock) {
  const fd = lock._fd
  if (fd === -1) return
  lock._fd = -1
  return new Promise((resolve) => fs.close(fd, () => resolve()))
}

function closeSync(lock) {
  const fd = lock._fd
  if (fd === -1) return
  lock._fd = -1
  try {
    fs.closeSync(fd)
  } catch {}
}
