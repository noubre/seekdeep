'use strict'

const { Session } = require('inspector')
const fs = require('fs')
const path = require('path')
const Transformer = require('./lib/transformer')

module.exports = async function setupCoverage (opts = {}) {
  const session = new Session()
  session.connect()

  const sessionPost = (...args) => new Promise((resolve, reject) =>
    session.post(...args, (err, result) => err ? reject(err) : resolve(result))
  )

  await sessionPost('Profiler.enable')
  await sessionPost('Profiler.startPreciseCoverage', { callCount: true, detailed: true })

  process.once('beforeExit', async () => {
    const v8Report = await sessionPost('Profiler.takePreciseCoverage')
    session.disconnect()

    if (opts.skipRawDump !== true) {
      const dir = opts.dir ?? 'coverage'
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'v8-coverage.json'), JSON.stringify(v8Report))
    }

    const transformer = new Transformer(opts)
    const coverageMap = await transformer.transformToCoverageMap(v8Report)
    transformer.report(coverageMap)
  })
}
