const Holesailclient = require("./index.js");

const test1 = new Holesailclient(
  "d8afd2605893ba587ffdc60044aa51ede164dbb71219d807ef55d624d8d09241",
  "secure",
);
test1.connect({ port: 10000, address: "0.0.0.0", udp: true }, () => {
  console.log("Connected UDP");
  console.log("Running on 0.0.0.0:10000");
});

