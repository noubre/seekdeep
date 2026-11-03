/**
 * Shared test helper: build the production slash runtime from the p2p-core
 * plugin so slash tests keep exercising the real command definitions.
 */
import {
  createSlashRuntime,
  freezeDefinition,
  dispatchSlashTagWithCommands,
  formatAllHelp,
  formatCommandHelp,
  createCommandMap,
  publicEntries
} from '../../js/slash/registry.js';
import p2pCore from '../../plugins/p2p-core/index.js';

const runtime = createSlashRuntime(p2pCore.commands);

function listSlashTags() {
  return runtime.list();
}

function dispatchSlashTag(text, ctx, services) {
  return runtime.dispatch(text, ctx, services);
}

const slashRegistry = Object.freeze(runtime.definitions.map(({
  handler: _handler,
  aliasArguments: _aliasArguments,
  ...entry
}) => Object.freeze(entry)));

const slashTagList = runtime.list();

function helpServices() {
  return {
    harness: {
      allHelp: () => formatAllHelp(runtime.definitions),
      commandHelp: (target) => formatCommandHelp(target, runtime.definitions)
    }
  };
}

export {
  runtime,
  slashRegistry,
  slashTagList,
  listSlashTags,
  dispatchSlashTag,
  dispatchSlashTagWithCommands,
  createSlashRuntime,
  freezeDefinition,
  formatAllHelp,
  formatCommandHelp,
  createCommandMap,
  publicEntries,
  helpServices
};
