module.exports = class RefCounter {
  constructor() {
    this.count = 0

    this._onidle = null
    this._idle = null
  }

  isIdle() {
    return this.count === 0
  }

  idle() {
    if (this.count === 0) return Promise.resolve()
    if (this._idle !== null) return this._idle

    this._idle = new Promise((resolve) => {
      this._onidle = resolve
    })

    return this._idle
  }

  inc() {
    this.count++
  }

  dec() {
    if (--this.count > 0) return

    if (this._onidle !== null) {
      const resolve = this._onidle
      this._idle = null
      this._onidle = null
      resolve()
    }
  }
}
