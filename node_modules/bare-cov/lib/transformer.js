'use strict'

const { isAbsolute } = require('path')
const { fileURLToPath } = require('url')
const libCoverage = require('istanbul-lib-coverage')
const defaultExclude = require('@istanbuljs/schema/default-exclude')
const defaultExtension = require('@istanbuljs/schema/default-extension')
const libReport = require('istanbul-lib-report')
const v8ToIstanbul = require('v8-to-istanbul')
const reports = require('istanbul-reports')
const TestExclude = require('./test-exclude')

class Transformer {
  constructor (opts = {}) {
    this.includeRelative = opts.includeRelative ?? false
    this.exclude = new TestExclude({
      exclude: defaultExclude,
      include: [],
      extension: defaultExtension,
      relativePath: true,
      excludeNodeModules: true
    })
    this.dir = opts.dir ?? 'coverage'
    this.reporters = opts.reporters ?? ['text', 'json']
    this.reporterOptions = opts.reporterOptions ?? {}

    this.includedUrlCache = new Map()
  }

  normalizeUrl (v8ReportResult) {
    if (/^node:/.test(v8ReportResult.url)) {
      v8ReportResult.url = `${v8ReportResult.url.replace(/^node:/, '')}.js`
    }

    if (/^file:\/\//.test(v8ReportResult.url)) {
      v8ReportResult.url = fileURLToPath(v8ReportResult.url)
    }

    return v8ReportResult
  }

  isResultUrlIncluded (url) {
    const cacheResult = this.includedUrlCache.get(url)
    if (cacheResult !== undefined) return cacheResult

    const result = (this.includeRelative || isAbsolute(url)) && this.exclude.shouldInstrument(url)
    this.includedUrlCache.set(url, result)
    return result
  }

  async transformToCoverageMap (rawV8Report) {
    const v8Report = {
      result: rawV8Report.result
        .map(v8ReportResult => this.normalizeUrl(v8ReportResult))
        .filter(v8ReportResult => this.isResultUrlIncluded(v8ReportResult.url))
    }

    const coverageMap = libCoverage.createCoverageMap()
    for (const v8ReportResult of v8Report.result) {
      const converter = v8ToIstanbul(v8ReportResult.url)
      await converter.load()
      converter.applyCoverage(v8ReportResult.functions)
      coverageMap.merge(converter.toIstanbul())
    }

    return coverageMap
  }

  report (coverageMap) {
    const context = libReport.createContext({ dir: this.dir, coverageMap })

    for (const reporter of this.reporters) {
      reports.create(reporter, {
        skipEmpty: false,
        skipFull: false,
        maxCols: process.stdout.columns || 100,
        ...this.reporterOptions[reporter]
      }).execute(context)
    }
  }
}

module.exports = Transformer
