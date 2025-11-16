let tmpResolve = null
let tmpReject = null

if (Promise.withResolvers) {
  module.exports = Promise.withResolvers.bind(Promise)
} else {
  module.exports = function resolveRejectPromise () {
    const promise = new Promise(setTmp)
    const result = { promise, resolve: tmpResolve, reject: tmpReject }
    tmpResolve = tmpReject = null
    return result
  }
}

function setTmp (resolve, reject) {
  tmpResolve = resolve
  tmpReject = reject
}
