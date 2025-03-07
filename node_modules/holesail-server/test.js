const HolesailServer = require('./index.js') // Assuming the server module is in a file named index.js

const server1 = new HolesailServer()

server1.serve(
  {
    port: 9000,
    address: '0.0.0.0',
    buffSeed:
      'd8afd2605893ba587ffdc60044aa51ede164dbb71219d807ef55d624d8d09241',
    udp: true,
    secure: true
  },
  () => {
    console.log('UDP  started on 0.0.0.0:9000 ')
    console.log(server1.getPublicKey())
  }
)
