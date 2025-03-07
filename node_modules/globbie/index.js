const fs = require('fs')
const path = require('path')
const picomatch = require('picomatch')

class Globbie {
  constructor (pattern, { sync = false } = {}) {
    this._isMatch = picomatch(pattern, { windows: process.platform === 'win32' })
    this._sync = sync
  }

  match (dir = '.') {
    return this._sync ? this.#matchSync(dir) : this.#matchAsync(dir)
  }

  #matchSync (dir = '.') {
    const matches = []
    for (const file of fs.readdirSync(dir)) {
      const filePath = path.join(dir, file)
      if (fs.lstatSync(filePath).isDirectory()) matches.push(...this.match(filePath))
      else if (this._isMatch(filePath)) matches.push(filePath)
    }

    return matches
  }

  async #matchAsync (dir = '.') {
    const files = await fs.promises.readdir(dir)

    const matches = []
    const promises = files.map(async (file) => {
      const filePath = path.join(dir, file)

      if ((await fs.promises.lstat(filePath)).isDirectory()) matches.push(...(await this.#matchAsync(filePath)))
      else if (this._isMatch(filePath)) matches.push(filePath)
    })

    for (const promise of promises) promise.catch(() => {})

    const results = await Promise.allSettled(promises)
    const error = results.find(({ status }) => status === 'rejected')?.reason
    if (error) throw error

    return matches
  }
}

module.exports = Globbie
