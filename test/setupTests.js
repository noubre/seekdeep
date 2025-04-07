// Setup file for brittle tests
import { TextEncoder, TextDecoder } from 'util';
import { Buffer } from 'buffer';
import fetch from 'node-fetch';

// Set up browser environment globals not provided by jsdom
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;

// Set up fetch for Node.js environment
globalThis.fetch = globalThis.fetch || fetch;

// Set up Buffer for binary data handling
globalThis.Buffer = globalThis.Buffer || Buffer;

// Set up Electron mock
globalThis.electron = {
  ipcRenderer: {
    on: function(channel, callback) {},
    send: function(channel, ...args) {},
    invoke: function(channel, ...args) {}
  }
};

// Clean up function to run after tests
process.on('exit', () => {
  // Clean up any resources that need to be released
});

// Helper function to wait for a specified time
globalThis.wait = function(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
};

// Helper function to create a mock connection
globalThis.createMockConnection = function() {
  return {
    remotePublicKey: Buffer.from('mock-public-key'),
    on: function(event, callback) {
      this[`${event}Callback`] = callback;
    },
    write: function(data) {
      this.lastWrittenData = data;
    },
    // For testing
    triggerData: function(data) {
      if (this.dataCallback) this.dataCallback(data);
    },
    triggerClose: function() {
      if (this.closeCallback) this.closeCallback();
    },
    triggerError: function(err) {
      if (this.errorCallback) this.errorCallback(err);
    }
  };
};

// Helper function to create a mock swarm
globalThis.createMockSwarm = function() {
  return {
    on: function(event, callback) {
      this[`${event}Callback`] = callback;
    },
    join: function(topic) {
      this.joinedTopic = topic;
    },
    leave: function(topic) {
      this.leftTopic = topic;
    },
    destroy: function() {
      this.destroyed = true;
    },
    // For testing
    emit: function(event, ...args) {
      if (this[`${event}Callback`]) this[`${event}Callback`](...args);
    },
    keyPair: {
      publicKey: Buffer.from('mock-public-key'),
      secretKey: Buffer.from('mock-secret-key')
    }
  };
};

// Make sure document and window are defined for DOM testing
if (typeof document === 'undefined') {
  globalThis.document = {
    body: {
      innerHTML: ''
    },
    createElement: function() {
      return {};
    },
    getElementById: function() {
      return {};
    }
  };
}

if (typeof window === 'undefined') {
  globalThis.window = {
    addEventListener: function() {}
  };
}
