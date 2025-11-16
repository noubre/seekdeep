module.exports = function generateString (s) {
  return /["']/.test(s) ? JSON.stringify(s) : "'" + s + "'"
}
