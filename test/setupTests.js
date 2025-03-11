// Setup file for Jest

// Mock the browser environment globals not provided by jsdom
global.TextEncoder = require('util').TextEncoder;
global.TextDecoder = require('util').TextDecoder;

// Mock Electron
global.electron = {
  ipcRenderer: {
    on: jest.fn(),
    send: jest.fn(),
    invoke: jest.fn()
  }
};

// Mock hyperswarm and related dependencies since they require node environment
jest.mock('hyperswarm', () => {
  return jest.fn().mockImplementation(() => {
    return {
      on: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
      keyPair: {
        publicKey: Buffer.from('mock-public-key'),
        secretKey: Buffer.from('mock-secret-key')
      }
    };
  });
});

jest.mock('b4a', () => {
  return {
    from: jest.fn(() => Buffer.from('mock-buffer')),
    toString: jest.fn(() => 'mock-string')
  };
});

jest.mock('hypercore-crypto', () => {
  return {
    discoveryKey: jest.fn(() => Buffer.from('mock-discovery-key')),
    keyPair: jest.fn(() => ({
      publicKey: Buffer.from('mock-public-key'),
      secretKey: Buffer.from('mock-secret-key')
    })),
    randomBytes: jest.fn(() => Buffer.from('mock-random-bytes'))
  };
});

// Mock fetch API
global.fetch = jest.fn();

// Clean up all mocks after each test
afterEach(() => {
  jest.clearAllMocks();
});
