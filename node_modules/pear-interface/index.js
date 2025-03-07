'use strict'
/** 
 * @typedef {import('bare-pipe')} Pipe
/* @typedef {import('streamx').Readable} StreamxReadable 
*/

/**
 * @typedef {Object} PearConfig
 * @property {?Buffer} key - Application key as a buffer, can be null .
 * @property {?string} alias - Alias, can be null.
 * @property {?string} checkpoint - Checkpoint, can be null.
 * @property {string[]} links - Application-trusted pear:// and http(s):// links.
 * @property {boolean} dev - Development mode.
 * @property {string} storage - Path to the application storage.
 * @property {string} name - Name of the application.
 * @property {string} main - Main entry file.
 * @property {string[]} args - Application arguments
 * @property {string} channel - Application channel name.
 * @property {string} applink - Application link, just protocol and key.
 * @property {?string} fragment - Link fragment, can be null.
 * @property {string} link - Full application link, including pathname and fragment.
 * @property {string} entrypoint - Application entrypoint path.
 * @property {string} dir - Application directory.
 * @property {string} pearDir - Pear platform folder.
 * @property {Object} options - package.json pear field parsed configuration.
 * @property {Object} flags - Runtime flags.
 */

/**
 * @typedef {Object} PearIdentity
 * @property {function(Buffer): Promise<Buffer>} request - Requests sub-identity publicKey using identity root publicKey.
 * @property {function({ publicKey: Buffer, attestation: Buffer }): Promise<void>} share - Grant identity usage to platform.
 * @property {function(): Promise<void>} clear - Clears the granted identity.
 */

/**
 * @typedef {Object} PearWorker
 * @property {function(string): (Pipe)} run - Runs a link and returns a pipe.
 * @property {function(): (Pipe|null)} pipe - Returns worker pipe or null if not a worker.
 */

/**
 * @typedef {Object} Pear
 * @property {PearConfig} config - Application configuration object.
 * @property {PearIdentity} identity - Manages identity.
 * @property {PearWorker} worker - Manages worker.
 * @property {function(string): Promise<void>} message - Sends a message.
 * @property {function((Object|function(Object)), function(Object)=): StreamxReadable} messages - Subscribes to messages.
 * @property {function(Object): Promise<void>} checkpoint - Sets Pear.config.checkpoint state.
 * @property {function(): Promise<{ app: string, platform: string }>} versions - Retrieves version information for platform and application.
 * @property {function({ platform: boolean }=): (Promise<void>)} restart - Restarts application or platform.
 * @property {function({ platform: boolean }=): (Promise<void>)} reload - Reloads application or platform.
 * @property {function(function(Object)): StreamxReadable} updates - Subscribes to updates.
 * @property {function(function(Object)): StreamxReadable} wakeups - Subscribes to wakeups.
 * @property {function(function()): Promise<void>} teardown - Registers a teardown function.
 * @property {function(number=): void} exit - Exits the application with optional exit code, default 0.
 */

/**
 * @typedef {Object} PearGUI
 * @extends Pear
 * @property {Object} media - Manages media access and status.
 * @property {Object} media.status - Media access status methods.
 * @property {function(): Promise<string>} media.status.microphone - Checks microphone access status.
 * @property {function(): Promise<string>} media.status.camera - Checks camera access status.
 * @property {function(): Promise<string>} media.status.screen - Checks screen access status.
 * @property {Object} media.access - Methods to request media access.
 * @property {function(): Promise<boolean>} media.access.microphone - Requests microphone access.
 * @property {function(): Promise<boolean>} media.access.camera - Requests camera access.
 * @property {function(): Promise<boolean>} media.access.screen - Requests screen access.
 * @property {function(Object=): Promise<Array>} media.desktopSources - Retrieves desktop sources.
 * @property {PearWindow} PearWindow - Pear.Window control class.
 * @property {PearView} PearView - Pear.View control class.
 */

/**
 * @typedef {Object} PearWindow
 * @extends GuiCtrl
 * @property {function({show: boolean, height: number, width: number}=): void} open - Opens the window.
 * @property {function(): Promise<boolean>} close - Closes the window.
 * @property {function(): Promise<boolean>} show - Shows the window.
 * @property {function(): Promise<boolean>} hide - Hides the window.
 * @property {function({steal: boolean}=): Promise<boolean>} focus - Focuses the window.
 * @property {function(): Promise<boolean>} blur - Blurs the window.
 * @property {function(): Promise<boolean>} show - Shows the window.
 * @property {function(): Promise<boolean>} hide - Hides the window.
 * @property {function(): Promise<boolean>} minimize - Minimizes the window.
 * @property {function(): Promise<boolean>} maximize - Maximizes the window.
 * @property {function(): Promise<boolean>} fullscreen - Fullscreens the window.
 * @property {function(): Promise<boolean>} isMinimized - Checks if the window is minimized.
 * @property {function(): Promise<boolean>} isMaximized - Checks if the window is maximized.
 * @property {function(): Promise<boolean>} isFullscreen - Checks if the window is fullscreen.
 */

/**
 * @typedef {Object} PearView
 * @extends GuiCtrl
 * @property {function({ height: number, width: number }=): void} open - Opens the view.
 * @property {function(): Promise<boolean>} close - Closes the view.
 * @property {function(): Promise<boolean>} show - Shows the view.
 * @property {function(): Promise<boolean>} hide - Hides the view.
 */

/**
 * @typedef {Object} GuiCtrl
 * @property {function(string, ...*): void} send - Sends a message between windows/views.
 * @property {function(): Promise<boolean>} restore - Restores the window/view.
 * @property {function(): Promise<string>} getMediaSourceId - Gets the media source ID.
 * @property {function({x: number, y: number, width: number, height: number, animate: boolean, position: string}=): Promise<void|{x: number, y: number, width: number, height: number}>} dimensions - Sets or gets dimensions of the window/view.
 * @property {function(): Promise<boolean>} isVisible - Checks if the window/view is visible.
 * @property {function(): Promise<boolean>} isClosed - Checks if the window/view is closed.
 */

/**
 * @global
 * @type {Pear}
 **/

const Pear = global.Pear