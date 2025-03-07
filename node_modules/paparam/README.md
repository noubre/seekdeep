# paparam

Strict and fair parameter papa

```
npm install paparam
```

## Usage

Use `paparam` exports to compose commands together:

``` js
const { header, footer, command, flag, arg, summary, description, rest, validate } = require('paparam')
const run = command(
  'run',
  summary('Run an app from a link'),
  description('Run an app from a file link (or path) or from a pear link.\nOptionally supply store for custom store path'),
  flag('--store|-s [path]', 'store path'),
  flag('--tmp-store', 'use tmp store path'),
  arg('<link>', 'link to run'),
  rest('[...app-args]'),
  validate(({ flags }) => !(flags.store && flags.tmpStore), '--store and --tmp-store cannot be used together'),
  () => console.log('ACTION ->', 'run', run.args.link, 'with store', run.flags.store)
)
const cmd = command('pear', summary('pear cli'), header('Welcome to the IoP'), footer('holepunch.to | pears.com | keet.io'), run)
cmd.parse(['--help']) // print pear help
cmd.parse(['run', '-h']) // print run help
cmd.parse(['run', '-s', '/path/to/store', 'pear://link']) // exec run command
cmd.parse(['run', '--tmp-store', 'pear://link']) // exec run command
cmd.parse(['run', '-s', '/path/to/store', '--tmp-store', 'pear://link']) // error
```

This should output:

```
Welcome to the IoP

  pear [flags] [command]

  pear cli

  Flags:
    --help|-h   print help

  Commands:
    run         Run an app from a link

holepunch.to | pears.com | keet.io

Welcome to the IoP

  run [flags] <link> [...app-args]

  Run an app from a link

  Run an app from a file link (or path) or from a pear link.
  Optionally supply store for custom store path

  Arguments:
    <link>              link to run
  [...app-args]

  Flags:
    --store|-s [path]   store path
    --help|-h           print help

holepunch.to | pears.com | keet.io

ACTION -> run pear://link with store /path/to/store
```

## API

### `command(name, ...args)`

Defines a command with a specific behavior based on the supplied modifiers such as flags, arguments, and descriptions. This function is used to create the command object.

- **Arguments**:
  - `name` `<String>`: The name of the command.
  - `...args` `<Modifier> | <Command> | <Function>`: Supply modifiers and subcommands as arguments. Supply a single function argument as the command runner.

- **Returns**:
  - `cmd` `<Command>`: The command object capable of parsing CLI arguments and executing associated actions.
  - `cmd.hide()` to hide the command from help.

#### `cmd.parse(argv = process.argv.slice(2), opts)`

Parses an array of command line arguments and executes the command based on the provided definition. Automatically handles '--help' or '-h' flags to display help information.

- **Arguments**:
  - `argv` `<String[]>`: An array of strings representing the command line arguments. Defaults to program arguments `process.argv.slice(2)` if unspecified. If the `-h` or `--help` flag is supplied help for the related command will be shown.
  - `opts` `<Object>`: Parse options
    - `sync` `<Boolean>`: Synchronous parse, only use this with synchronous function runners. Default `false`.
    - `silent` `<Boolean>`: Suppress the help display, even if `-h` or `--help` is provided.
- **Returns**:
  - `null` if the parsing leads to an error (with an error output) or the command object if the command executes without errors.

#### `cmd.help(...subcommands)`

Generates and returns help text for the command. Can take subcommand names as arguments to generate help for a specific subcommand path. When calling `cmd.parse(argv)`, if the `-h` or `--help` flag is supplied, this method is automatically called and output.

#### `cmd.usage(...subcommands)`

Returns help text without header or footer. Can take subcommand names as arguments to generate help for a specific subcommand path.

#### `cmd.overview({ full = false })`

Returns a string with a command overview. Set `full` to `true` to include detailed usage for each command.

- **Arguments**:
  - `full` `<Boolean>`: Whether to display a full overview that includes details of all defined sub-commands and flags.

#### `cmd.running` `<Promise> | null`

Either `null` if the command is not running or a promise that resolves when the command has completed running.

#### `cmd.bailed` `<Object> | null`

Either `null` if the command did not bail or an object descibing the bail. The object can be `{ bail <Object>, error <Error>?, output <String>? }`. If the object has an `error` property it failed to create the bail output (which could happen with a user defined bail function),
otherwise the object has an `output` property which explains the reason for the bail. The `bail` property of the `bailed` object has the following shape: `{ reason <String>, flag <Flag>, arg <Arg>, err <Error>}`. When present, `err` property on the `bail` objects would have been thrown from the runner, whereas the `bailed.error` property holds errors that occur during bailing.

#### `cmd.flags` `<Object>`

After `cmd.parse` has been called, contains parsed flag values.

#### `cmd.args` `<Object>`

After `cmd.parse` has been called, contains parsed arguments.

#### `cmd.positionals` `<Array>`

After `cmd.parse` has been called, contains original arguments in isolation.

#### `cmd.rest` `<Object>`

After `cmd.parse` has been called, contains rest arguments, if any, on `cmd.rest.restName` where `restName` is defined
by `rest(spec)` where `spec` is `[..rest-name]`.

#### `cmd.parent` `<Command>`

Command parent

#### `cmd.name` `<String>`

Command name

#### `cmd.description` `<String>`

Command description

#### `cmd.summary` `<String>`

Command summary

#### `cmd.header` `<String>`

Command header

#### `cmd.footer` `<String> | <Object>`

Command footer

#### `cmd.indices.flags` `<Object>`

After `cmd.parse` has been called, contains the index of each flag in the original array.

#### `cmd.indices.args` `<Object>`

After `cmd.parse` has been called, contains the index of each parsed argument in the original array.

#### `cmd.indices.positionals` `<Array>`

After `cmd.parse` has been called, contains the indexes of each positional argument in the original array.

#### `cmd.indices.rest` `<Number>`

After `cmd.parse` has been called, contains the index of the first rest argument in the positional array.


### `flag(spec, description)`

Defines a flag for a command. Flags can be simple boolean switches or can expect a value.

- **Arguments**:
  - `spec` `<String>`: `--long|-l (<value> | [value])?` , e.g., `--boolean-flag|-b`, `--string-flag [optional-value]`, `--string-flag <required-value>`
  - `description` `<String>`: A description of what the flag does.

- **Returns**:
  - `flag` `<Flag>`: A modifier that configures the command to recognize and handle the specified flag.
  - `flag.hide()` to hide the flag from help.
  - `flag.multiple()` to make this flag into an array of all passed values instead of the latest one only.

### `arg(spec, description)`

Defines a positional argument for a command.

- **Arguments**:
  - `spec` `<String>`: `[arg] | <arg>` where arg is the placeholder name for the argument, e.g. `<name>`, (required) `[dir]` (optional)
  - `description` `<String>`: A description of what the argument is for.

- **Returns**:
  - `<Arg>`: A modifier that configures the command to accept and process the specified argument.

### `rest(spec, description)`

Defines rest arguments that are captured after all flags and named arguments.

- **Arguments**:
  - `spec` `<String>`: `[...rest-name]`. The name to collect rest arguments under, e.g. `[...app-args]` array will be stored at `cmd.rest.appArgs`.
  - `description` `<String>`: Description of what these rest arguments represent.

- **Returns**:
  - `<Rest>`: A modifier that configures the command to capture additional arguments not explicitly defined.

### `validate(validator, description)`

Defines a validation function for the command. This function is used to enforce custom validation logic on the command after parsing, such as checking the relationship of flags, arguments, rest arguments, etc.

- **Arguments**:
  - `validator` `<Function>`: A function that takes the parsed command object and returns a boolean indicating whether the validation passed. If the validation fails, the function should throw an error or return a string describing the validation error.
    - **Parameters**:
      - `args` `<Object>`: An object containing the parsed arguments.
      - `flags` `<Object>`: An object containing the parsed flags.
      - `positionals` `<Array>`: An array containing the positional arguments.
      - `rest` `<Object>`: An object containing the rest arguments.
      - `indices` `<Object>`: An object containing the indices of flags, arguments, positionals, and rest.
        - `flags` `<Object>`: An object containing the indices of the flags.
        - `args` `<Object>`: An object containing the indices of the arguments.
        - `positionals` `<Array>`: An array containing the indices of the positional arguments.
        - `rest` `<Number>`: The index of the rest arguments.
      - `command` `<Command>`: The command object being validated.
    - **Returns**:
      - `<Boolean>`: The validator function should return true if the validation passes, indicating that the command is valid. If the validation fails, it should return false or throw an error. Returning false indicates that the command is invalid.

- **Returns**:
  - `<Validation>`: A modifier that configures the command to use the specified validation function.

### `summary(text)`

Defines a brief summary of the command's functionality.

- **Arguments**:
  - `text` `<String>`: Summary of the command's purpose.

- **Returns**:
  - `<Data>`: A modifier containing the summary information.

### `` description(text) | description`text` ``

Defines a detailed description of the command's functionality.
When used as a tagged template function, `description` automatically dedents the text.

- **Arguments**:
  - `text` `<String>`: Detailed information about the command.

- **Returns**:
  - `<Data>`: A modifier containing the description information.

### `header(text)`

Define a header for the command's help output.

- **Arguments**:
  - `text` `<String>`: Text to display at the top of the output.

- **Returns**:
  - `<Data>`: A modifier that configures the header text.

### `footer(text | { overview: text, help: text })`

Define a footer for the command's help & overview output.

- **Arguments**:
  - `text` `<String> | { overview: text <String>, help: text <String> }`| : Text to display at the bottom of the help and/or overview output.

- **Returns**:
  - `<Data>`: A modifier that configures the footer text.

### `bail(fn)`

Set the bail handler to `fn`.

### `sloppy(opts)`

Configures the command to be non-strict when parsing unknown flags or arguments.

## License

Apache-2.0
