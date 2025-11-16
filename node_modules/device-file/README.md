# device-file

Device only file

```
npm install device-file
```

Stores some metadata about the device and complains if it thinks its been modified

## Usage

```js
const DeviceFile = require('device-file')

const d = new DeviceFile('DEVICE', { data: { appId: 'my-app-id' }})

// throws if DEVICE was modified or user data doesnt match or if it looks like an unsafe backup
await d.ready()
```

## License

Apache-2.0
