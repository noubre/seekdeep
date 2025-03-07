'use strict'
const EOL = '\n'
const noop = () => {}
module.exports = {
  command,
  hiddenCommand,
  header,
  footer,
  argv,
  flag,
  hiddenFlag,
  arg,
  rest,
  validate,
  summary,
  description,
  sloppy,
  bail
}

class Parser {
  constructor (argv) {
    this.argv = argv
    this.i = 0
    this.multi = null
  }

  rest () {
    const rest = this.argv.slice(this.i)
    this.lasti = this.i
    this.i = this.argv.length
    return rest
  }

  next () {
    while (true) {
      const r = {
        flag: null,
        rest: null,
        arg: null
      }

      if (this.multi && this.multi.length) {
        const name = this.multi.pop()
        r.flag = { long: false, name, value: '' }
        return r
      }

      this.multi = null

      if (this.i >= this.argv.length) return null
      this.lasti = this.i
      const a = this.argv[this.i++]

      if (a === '--') {
        r.rest = this.rest()
        return r
      }

      if (a.length > 2 && a[0] === '-' && a[1] === '-') {
        let j = a.indexOf('=')
        if (j === -1) j = a.length
        const inverse = a.startsWith('--no-')
        const name = inverse ? a.slice(5, j) : a.slice(2, j)
        const value = a.slice(j + 1)
        r.flag = { long: true, name, value, inverse }
        return r
      }

      if (a.length > 1 && a[0] === '-') {
        this.multi = []
        for (let i = 1; i < a.length; i++) this.multi.push(a[i])
        this.multi.reverse()
        continue
      }

      r.arg = a
      return r
    }
  }
}

class Command {
  constructor (parent, name) {
    this.parent = parent
    this.name = name
    this.hidden = false
    this.description = ''
    this.summary = ''
    this.header = ''
    this.footer = ''

    this.flags = {}
    this.args = {}
    this.positionals = []
    this.rest = null
    this.bailed = null
    this.indices = { flags: {}, args: {}, positionals: [], rest: undefined }

    this.running = null

    this._validators = []
    this._runner = null
    this._onbail = null
    this._indent = ''
    this._strictFlags = true
    this._strictArgs = true
    this._labels = {
      arguments: 'Arguments:',
      flags: 'Flags:',
      commands: 'Commands:'
    }

    this._definedCommands = new Map()
    this._definedFlags = new Map()
    this._definedArgs = []
    this._definedRest = null
  }

  hide () {
    this.hidden = true
    return this
  }

  bail (bail) {
    try {
      this.bailed = { output: this._bail(bail), bail }
    } catch (err) {
      this.bailed = { error: err, bail }
      throw err
    }
    return this.bailed
  }

  overview ({ full = false } = {}) {
    let s = ''
    if (this.header) s += this.header + EOL + EOL

    for (const [name, command] of this._definedCommands) {
      if (command.hidden) continue
      if (full) {
        command._indent = this.header ? '  ' : ''
        s += command._indent + command._oneliner(false) + EOL + command._aligned() + EOL
        command._indent = ''
      } else s += '  ' + this.name + ' ' + name + ' ~ ' + command.summary + EOL
    }

    if (this.footer) s += EOL + (Object.hasOwn(this.footer, 'overview') ? this.footer.overview : this.footer) + EOL

    return s
  }

  help (...args) {
    let s = ''

    if (this.header) s += this.header + EOL + EOL
    this._indent = this.header ? '  ' : ''
    s += this.usage(...args)
    this._indent = ''

    if (this.footer) s += EOL + (Object.hasOwn(this.footer, 'help') ? this.footer.help : this.footer) + EOL

    return s
  }

  usage (subcommand, ...args) {
    if (subcommand) {
      const sub = this._definedCommands.get(subcommand)
      if (!sub) return this.bail(createBail(this, 'UNKNOWN_ARG', null, { value: subcommand }))
      sub.parent = this
      const str = sub.usage(...args)
      return str
    }
    let s = this._indent + this._oneliner(false) + EOL
    s += this._aligned()

    return s
  }

  parse (input = argv(), opts = {}) {
    const { sync = false } = opts
    const p = new Parser(input)

    let c = this._reset()
    let bail = null

    const visited = [c]

    while (bail === null) {
      if (c._definedRest !== null && c.positionals.length === c._definedArgs.length && c._definedArgs.length > 0) {
        bail = c._onrest(p.rest(), p)
        break
      }

      const n = p.next()
      if (n === null) break

      if (n.flag) {
        bail = c._onflag(n.flag, p)
        continue
      }

      if (n.arg && c._definedArgs.length > 0) {
        bail = c._onarg(n.arg, p)
        continue
      }

      if (c._definedCommands.size > 0) {
        const cmd = c._getCommand(n.arg)

        if (cmd !== null) {
          c = cmd._reset()
          visited.push(c)
          continue
        }
      }

      p.i--
      bail = c._onrest(p.rest(), p)
    }

    if (!bail) {
      if (c !== this && !c.parent) c.parent = this
      if (c.flags.help) {
        if (!opts.silent) console.log(c.help())
        return null
      }
      for (const v of c._validators) {
        runValidation(v, c)
      }
      if (c._runner !== null) {
        if (sync) runSync(c)
        else c.running = runAsync(c)
      }
      return c
    }

    c.bail(bail)
    return null
  }

  _oneliner (short, relative) {
    const stack = [this]
    if (!relative) {
      while (stack[stack.length - 1].parent) stack.push(stack[stack.length - 1].parent)
    }

    const run = stack.reverse().map(c => c.name || 'app')

    if (!short) {
      if (this._definedFlags.size > 0) run.push('[flags]')
      for (const arg of this._definedArgs) run.push(arg.help)
      if (this._definedCommands.size > 0) run.push('[command]')
      if (this._definedRest !== null) run.push(this._definedRest.help)
    }

    return run.join(' ')
  }

  _aligned (padding = 0, color = false) {
    const l = []
    const visited = new Set()
    const indent = this._indent
    if (this.summary) {
      l.push(['', ''])
      l.push(...this.summary.split(EOL).map((line) => [this._indent + line, '']))
    }
    if (this.description) {
      l.push(['', ''])
      l.push(...this.description.split(EOL).map((line) => [this._indent + line, '']))
    }

    if (this._definedArgs.length > 0 || this._definedRest !== null) {
      l.push(['', ''])
      l.push([indent + this._labels.arguments, ''])
      for (const arg of this._definedArgs) {
        l.push([indent + '  ' + arg.help, arg.usage()])
      }
    }

    if (this._definedRest) {
      l.push([indent + '  ' + this._definedRest.help, this._definedRest.description])
    }

    if (this._definedFlags.size) {
      l.push(['', ''])
      l.push([indent + this._labels.flags, ''])
      for (const flag of this._definedFlags.values()) {
        if (visited.has(flag)) continue
        visited.add(flag)
        if (!flag.hidden) l.push([indent + '  ' + flag.help, flag.description])
      }
    }

    if (this._definedCommands.size) {
      l.push(['', ''])
      l.push([indent + this._labels.commands, ''])
      for (const c of this._definedCommands.values()) {
        if (c.hidden) continue
        l.push([indent + '  ' + c._oneliner(true, true), c.summary || c.description])
      }
    }

    if (padding === 0) {
      for (const [left, right] of l) {
        if (!right) continue
        if (left.length > padding) padding = left.length
      }
    }

    if (color === false) {
      return this._aligned(padding, true)
    }

    let s = ''
    for (const [left, right] of l) {
      s += (left.padEnd(padding, ' ') + '   ' + right).trimEnd() + EOL
    }

    s = s.trimEnd()

    return s ? s + EOL : ''
  }

  _addCommand (c) {
    if (!c.header) c.header = this.header
    if (!c.footer) c.footer = this.footer
    if (!c.parent) c.parent = this
    this._definedCommands.set(c.name, c)
  }

  _addFlag (f) {
    this._definedFlags.set(f.name, f)
    for (const alias of f.aliases) {
      if (alias !== f.name) {
        this._definedFlags.set(alias, f)
      }
    }
  }

  _addArg (a) {
    this._definedArgs.push(a)
  }

  _addRest (a) {
    this._definedRest = a
  }

  _addData (d) {
    switch (d.type) {
      case 'bail': {
        if (this._onbail !== null) throw new Error('onbail already set')
        this._onbail = d.value
        break
      }
      case 'name': {
        this.name = d.value
        break
      }
      case 'summary': {
        this.summary = d.value
        break
      }
      case 'description': {
        this.description = d.value
        break
      }
      case 'header': {
        this.header = unindent(d.value)
        break
      }
      case 'footer': {
        this.footer = (d.value !== null && typeof d.value === 'object')
          ? { help: unindent(d.value.help || ''), overview: d.value.overview }
          : unindent(d.value)
        break
      }
      case 'sloppy': {
        this._strictFlags = !(d.value?.flags)
        this._strictArgs = !(d.value?.args)
        break
      }
    }
  }

  _addValidation (_validator) {
    this._validators.push(_validator)
  }

  _addRunner (_runner) {
    this._runner = _runner
  }

  _reset () {
    this.flags = {}
    this.args = {}
    this.positionals = []
    this.rest = null
    this.indices = { flags: {}, args: {}, positionals: [], rest: undefined }
    this.running = null

    for (const [name, { value }] of this._definedFlags) {
      if (name === snakeToCamel(name)) {
        this.flags[name] = value
      }
    }
    return this
  }

  _getFlag (name, flag) {
    let f = this._definedFlags.get(name)
    if (f && flag.long && f.aliases.indexOf(name) > 0) f = undefined
    if (f === undefined && this._strictFlags === false) f = defaultFlag(name)
    return f || null
  }

  _getCommand (name) {
    return this._definedCommands.get(name) || null
  }

  _onflag (flag, parser) {
    const def = this._getFlag(flag.name, flag)
    if (def === null) return createBail(this, 'UNKNOWN_FLAG', flag, null)

    if (def.boolean === true) {
      if (flag.value) return createBail(this, 'INVALID_FLAG', flag, null)
      this.flags[def.name] = !flag.inverse
      if (def.aliases[1]) this.flags[def.aliases[1]] = this.flags[def.name]
      this.indices.flags[def.name] = parser.lasti
      return null
    }

    if (def.boolean === false) {
      if (flag.value) {
        if (def.valueChoices && !def.valueChoices.includes(flag.value)) {
          return createBail(this, 'INVALID_FLAG', flag, null)
        }

        const value = def.multi ? (this.flags[def.name] || []).concat(flag.value) : flag.value
        this.flags[def.name] = value
        if (def.aliases[1]) this.flags[def.aliases[1]] = value
        this.indices.flags[def.name] = parser.lasti
        return null
      }

      const next = parser.next()
      const argless = next === null || !next.arg
      if (def.valueRequired && argless && !def.hasDefault) {
        return createBail(this, 'INVALID_FLAG', flag, null)
      }

      const nextValue = !next?.arg && def.hasDefault ? def.value : next?.arg
      if (def.valueChoices && !def.valueChoices.includes(nextValue)) {
        return createBail(this, 'INVALID_FLAG', flag, null)
      }
      const value = def.multi ? (this.flags[def.name] || []).concat(nextValue) : (nextValue)
      this.flags[def.name] = value
      if (def.aliases[1]) this.flags[def.aliases[1]] = value
      this.indices.flags[def.name] = parser.lasti
    }

    return null
  }

  _onarg (arg, parser) {
    const info = { index: this.positionals.length, value: arg }
    if (this._definedArgs.length <= this.positionals.length) {
      if (this._strictArgs === false) {
        this.positionals.push(arg)
        this.indices.positionals.push(parser.lasti)
        return null
      }

      return createBail(this, 'UNKNOWN_ARG', null, info)
    }

    const def = this._definedArgs[this.positionals.length]
    this.positionals.push(arg)
    this.indices.positionals.push(parser.lasti)
    this.args[def.name] = arg
    this.indices.args[def.name] = parser.lasti

    return null
  }

  _onrest (rest, parser) {
    if (this._definedRest === null && this._strictArgs) {
      return createBail(this, 'UNKNOWN_ARG', null, { index: this.positionals.length, value: rest.join(' ') })
    }

    this.rest = rest
    this.indices.rest = parser.lasti
    return null
  }

  _bail (bail) {
    if (typeof this._onbail === 'function') return this._onbail(bail)
    if (this.parent) return this.parent._bail(bail)
    if (bail.flag) throw new Bail(bail.reason + ': ' + bail.flag.name)
    if (bail.arg) throw new Bail(bail.reason + ': ' + bail.arg.value)
    throw new Bail(bail.reason)
  }
}

class Flag {
  constructor (spec, description = '') {
    const { longName, shortName, aliases, boolean, help, value, valueRequired } = parseFlag(spec)
    this.name = snakeToCamel(longName || shortName)
    this.aliases = aliases
    this.boolean = boolean
    this.help = help
    this.description = description
    this.hidden = false
    this.multi = false
    this.valueChoices = undefined
    this.hasDefault = false
    this.value = value
    this.valueRequired = valueRequired
  }

  default (val) {
    this.hasDefault = true
    this.value = val
    this.description += ` (default: ${val})`
    return this
  }

  multiple () {
    this.multi = true
    return this
  }

  choices (valueChoices) {
    this.valueChoices = valueChoices
    this.description += ` (choices: ${valueChoices.join(', ')})`
    return this
  }

  hide () {
    this.hidden = true
    return this
  }
}

class Arg {
  constructor (help, description = '') {
    this.optional = help.startsWith('[')
    this.name = snakeToCamel(help)
    this.help = help
    this.description = description
    this.hidden = false
  }

  hide () {
    this.hidden = true
    return this
  }

  usage () {
    if (!this.optional) return this.description
    const first = this.description.slice(0, 1)
    return (this.description && first.toLowerCase() === first ? 'optional. ' : 'Optional. ') + this.description
  }
}

class Rest {
  constructor (help, description = '') {
    this.help = help
    this.description = description
  }
}

class Data {
  constructor (type, value) {
    this.type = type
    this.value = value
  }
}

class Validation {
  constructor (validator, description = 'INVALID') {
    this.validator = validator
    this.description = description
  }
}

function argv () {
  return typeof process === 'undefined' ? global.Bare.argv.slice(2) : process.argv.slice(2)
}

function command (name, ...args) {
  const c = new Command(null, name)
  for (const a of args) {
    if (a instanceof Command) {
      c._addCommand(a)
    } else if (a instanceof Flag) {
      c._addFlag(a)
    } else if (a instanceof Arg) {
      c._addArg(a)
    } else if (a instanceof Rest) {
      c._addRest(a)
    } else if (a instanceof Data) {
      c._addData(a)
    } else if (a instanceof Validation) {
      c._addValidation(a)
    } else if (typeof a === 'function') {
      c._addRunner(a)
    } else {
      throw new Error('Unknown arg: ' + a)
    }
  }
  c._addFlag(new Flag('--help|-h', 'Show help'))
  if (!c._runner) c._addRunner(noop)
  return c
}

// deprecated, removed soon, use.hide()
function hiddenCommand (name, ...args) {
  return command(name, ...args).hide()
}

function bail (fn) {
  return new Data('bail', fn)
}

function sloppy (opts) {
  return new Data('sloppy', opts)
}

function summary (desc) {
  return new Data('summary', desc)
}

function description (desc, ...values) {
  if (Array.isArray(desc)) return description(dedent(desc, values))
  return new Data('description', desc)
}

function header (desc) {
  return new Data('header', desc)
}

function footer (desc) {
  return new Data('footer', desc)
}

// deprecated, removed soon, use .hide()
function hiddenFlag (help, description) {
  return flag(help, description).hide()
}

function flag (help, description) {
  return new Flag(help, description)
}

function rest (help, description) {
  return new Rest(help, description)
}

function arg (help, description) {
  return new Arg(help, description)
}

function validate (validator, description) {
  return new Validation(validator, description)
}

function unindent (info) {
  const lines = info.split('\n').filter(trimLine)
  if (!lines.length) return ''
  const indent = lines[0].match(/^(\s*)/)[1]

  let s = ''
  for (const line of lines) s += line.slice(indent.length).trimEnd() + '\n'
  return s.trimEnd()
}

function trimLine (line) {
  return line.trim()
}

function snakeToCamel (name) {
  const parts = name.match(/([a-zA-Z0-9-]+)/)[1].split(/-+/)
  for (let i = 1; i < parts.length; i++) parts[i] = parts[i].slice(0, 1).toUpperCase() + parts[i].slice(1)
  return parts.join('')
}

function parseFlag (help) {
  const parts = help.split(/[| ]/)
  const result = { longName: null, shortName: null, aliases: [], boolean: true, help, value: null, inverse: false, valueRequired: false }
  for (const p of parts) {
    result.inverse = p.startsWith('--no-')
    if (p.startsWith('--')) {
      const name = result.inverse ? trimFlag(p).slice(3) : trimFlag(p)
      if (result.longName === null) result.longName = name
      result.value = result.inverse
      result.aliases.push(name)
      continue
    }

    if (p.startsWith('-')) {
      const name = trimFlag(p)
      if (result.shortName === null) result.shortName = name
      result.value = false
      result.aliases.push(name)
      continue
    }

    const valueRequired = p.startsWith('<')
    const stringFlag = p.startsWith('[') || valueRequired
    if (stringFlag) {
      result.boolean = false
      result.value = undefined
      result.valueRequired = valueRequired
    }
  }

  return result
}

function trimFlag (s) {
  return s.replace(/(^[^0-9\w]+)|([^0-9\w]+$)/g, '')
}

function createBail (command, reason, flag, arg, err) {
  return { command, reason, flag, arg, err }
}

function defaultFlag (name) {
  return {
    name,
    aliases: [name],
    boolean: false,
    help: '',
    description: '',
    value: ''
  }
}

function dedent (strings, values) {
  const raw = String.raw(strings, ...values)
  const lines = raw.split('\n')

  let minIndent = Infinity
  for (const line of lines) {
    let i = 0
    while (i < line.length && line[i] === ' ') i++
    if (i < line.length) minIndent = Math.min(minIndent, i)
  }

  if (minIndent === Infinity) return raw.trim()

  let result = ''
  for (const line of lines) {
    result += line.length >= minIndent ? line.slice(minIndent) + '\n' : '\n'
  }

  return result.trim()
}

function runValidation (v, c) {
  try {
    const isValid = v.validator({ args: c.args, flags: c.flags, positionals: c.positionals, rest: c.rest, indices: c.indices, command: c })
    if (!isValid) throw new Error(v.description)
  } catch (err) {
    c.bail(createBail(c, err.stack, null, null, err))
  }
}

function runSync (c) {
  try {
    c._runner({ args: c.args, flags: c.flags, positionals: c.positionals, rest: c.rest, indices: c.indices, command: c })
  } catch (err) {
    c.bail(createBail(c, err.stack, null, null, err))
  }
}

async function runAsync (c) {
  try {
    await c._runner({ args: c.args, flags: c.flags, positionals: c.positionals, rest: c.rest, indices: c.indices, command: c })
  } catch (err) {
    c.bail(createBail(c, err.stack, null, null, err))
  }
}

class Bail extends Error { name = 'Bail' }
