// Importing required modules
const HyperDHT = require("hyperdht"); // HyperDHT module for DHT functionality
const net = require("net"); // Net module for creating network clients and servers

const libNet = require("@holesail/hyper-cmd-lib-net"); // Custom network library
const b4a = require("b4a");

class holesailClient {
  constructor(key, secure) {
    // check if secure flag is enabled
    if (secure === "secure") {
      this.secure = true;
      this.peerKey = HyperDHT.keyPair(b4a.from(key, "hex"));
      this.dht = new HyperDHT({ keyPair: this.peerKey });
    } else {
      this.peerKey = key;
      this.dht = new HyperDHT();
    }

    this.stats = {};
    this.proxy;
  }

  connect(options, callback) {
    if (!options.udp) {
      this.handleTCP(options, callback);
    } else {
      this.handleUDP(options, callback);
    }
  } // end connect

  // Handle TCP connections
  handleTCP(options, callback) {
    this.proxy = net.createServer({ allowHalfOpen: true }, (c) => {
      return libNet.connPiper(
        c,
        () => {
          let stream;
          if (this.secure) {
            stream = this.dht.connect(
              Buffer.from(this.peerKey.publicKey, "hex"),
              { reusableSocket: true },
            );
          } else {
            stream = this.dht.connect(Buffer.from(this.peerKey, "hex"), {
              reusableSocket: true,
            });
          }
          return stream;
        },
        { compress: false },
        this.stats,
      );
    });

    const targetHost = options.address || "127.0.0.1";
    this.proxy.listen(options.port, targetHost, () => {
      if (typeof callback === "function") {
        callback();
      }
    });
  }

  // Handle UDP connections
  handleUDP(options, callback) {
    let conn;

    if (this.secure) {
      conn = this.dht.connect(Buffer.from(this.peerKey.publicKey, "hex"));
    } else {
      conn = this.dht.connect(Buffer.from(this.peerKey, "hex"));
    }

    conn.once("open", function () {
      const handleUDP = libNet.udpPiper(conn, () => {
        return libNet.udpConnect({
          port: options.port || 8989,
          host: options.address || "127.0.0.1",
          bind: true,
        });
      });

      if (typeof callback === "function") {
        callback();
      }
    });
  }

  destroy() {
    this.dht.destroy();
    this.proxy.close();
    return 0;
  }
} // end client class

module.exports = holesailClient;
