[English](./README.md) | [עברית](./README.he.md)

---

# DLNA.js

JavaScript/TypeScript library for discovering and controlling DLNA / UPnP devices on a local network (Media Servers, Media Renderers, and related services).

> **Early release:** The API may change between versions. Installed TypeScript declarations (`dist/*.d.ts`) are the authoritative signatures.

**Runtime:** Node.js `>=18` (also works with Bun). Discovery and control require access to the same LAN as the devices (UDP SSDP multicast + HTTP to device description/control URLs).

```bash
npm install dlna.js
# or: yarn add dlna.js / bun add dlna.js
```

```js
const { ActiveDeviceManager, DiscoveryDetailLevel } = require('dlna.js');
```

---

## Important notes

1. **Logging is silent by default.** Call `setLogger(console)` (or a custom `DlnaLogger`) if you want library logs. Leaving the default noop is recommended for CLIs that use interactive prompts.
2. **Services live on `device.serviceList`**, a `Map` keyed by short names such as `'AVTransport'`, `'ContentDirectory'`, `'RenderingControl'`, `'ConnectionManager'`. There is no `device.getService()`.
3. **`detailLevel: 'full'`** (or `DiscoveryDetailLevel.Full`) is required for `action.invoke(...)` helpers. Lower levels may still list services without invokable actions.
4. **Many renderers only accept `http-get` URIs** (not `https:`) for `SetAVTransportURI`. Check the device `ConnectionManager` / `GetProtocolInfo` Sink list. Prefer `http://...` media URLs (or a LAN HTTP facade) when casting.
5. **Official URL playback** on a MediaRenderer is UPnP AV: `SetAVTransportURI` then `Play`. The renderer fetches the URL itself.

---

## Quick start

```js
const {
  ActiveDeviceManager,
  DiscoveryDetailLevel,
  createSingleItemDidlLiteXml,
  setLogger,
} = require('dlna.js');

// Optional: setLogger(console);

const mgr = new ActiveDeviceManager({
  searchTarget: 'urn:schemas-upnp-org:device:MediaRenderer:1',
  detailLevel: DiscoveryDetailLevel.Full,
  mSearchIntervalMs: 5000,
});

mgr.on('devicefound', async (_udn, device) => {
  console.log('Found', device.friendlyName, device.remoteAddress);

  const avt = device.serviceList?.get('AVTransport');
  const setUri = avt?.actionList?.get('SetAVTransportURI');
  const play = avt?.actionList?.get('Play');
  if (!setUri?.invoke || !play?.invoke) return;

  const mediaUrl = 'http://192.168.1.10/media/sample.mp3';
  const didl = createSingleItemDidlLiteXml(
    {
      id: '1',
      parentId: '0',
      title: 'sample',
      class: 'object.item.audioItem.musicTrack',
      restricted: false,
    },
    { uri: mediaUrl, protocolInfo: 'http-get:*:audio/mpeg:*' }
  );

  await setUri.invoke({
    InstanceID: 0,
    CurrentURI: mediaUrl,
    CurrentURIMetaData: didl,
  });
  await play.invoke({ InstanceID: 0, Speed: '1' });
});

mgr.start();
```

Interactive explorer (in the monorepo): `bun examples/cli_device_explorer.ts`.

---

## API reference

All symbols below are exported from the package root (`dlna.js`).

### Discovery

#### `class ActiveDeviceManager extends EventEmitter`

Continuous SSDP discovery and device cache.

```ts
new ActiveDeviceManager(options?: ActiveDeviceManagerOptions)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `searchTarget` | `string` | `'ssdp:all'` | SSDP `ST` value |
| `detailLevel` | `DiscoveryDetailLevel` | `'full'` in types / often `'basic'` if omitted at runtime — pass explicitly | How deep to fetch/parse |
| `mSearchIntervalMs` | `number` | `10000` | M-SEARCH repeat interval |
| `deviceCleanupIntervalMs` | `number` | `60000` | Expired-device cleanup interval |
| `includeIPv6` | `boolean` | `false` | Also use IPv6 |
| `onRawSsdpMessage` | `RawSsdpMessageHandler` | — | Raw SSDP callback |
| `networkInterfaces` | `string[]` | — | Restrict to named interfaces |

**Events**

| Event | Args | When |
|-------|------|------|
| `devicefound` | `(udn: string, device: ApiDevice)` | New device processed |
| `deviceupdated` | `(udn: string, device: ApiDevice)` | Existing device refreshed |
| `devicelost` | `(udn: string, device: ApiDevice)` | Device timed out / left |
| `error` | `(error: Error)` | Critical discovery error |

**Methods**

| Method | Returns | Description |
|--------|---------|-------------|
| `start()` | `Promise<void>` | Begin discovery |
| `stop()` | `Promise<void>` | Stop discovery and close sockets |
| `getActiveDevices()` | `Map<string, ApiDevice>` | Current devices keyed by UDN |

---

#### `discoverSsdpDevicesIterable(options?: DiscoveryOptions): AsyncIterable<ProcessedDevice>`

One-shot timed discovery as an async iterable (`for await...of`).

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `timeoutMs` | `number` | `5000` | Total discovery window |
| `searchTarget` | `string` | `'ssdp:all'` | SSDP `ST` |
| `detailLevel` | `DiscoveryDetailLevel` | `'full'` | Enrichment depth |
| `includeIPv6` | `boolean` | `false` | IPv6 |
| `abortSignal` | `AbortSignal` | — | Cancel discovery |
| `onDeviceFound` | `(device) => void` | — | Per-device callback |
| `onRawSsdpMessage` | `RawSsdpMessageHandler` | — | Raw SSDP |
| `networkInterfaces` | `os.NetworkInterfaces` dict | — | Override interface list |

```js
const { discoverSsdpDevicesIterable, DiscoveryDetailLevel } = require('dlna.js');

for await (const device of discoverSsdpDevicesIterable({
  timeoutMs: 8000,
  detailLevel: DiscoveryDetailLevel.Full,
  searchTarget: 'urn:schemas-upnp-org:device:MediaServer:1',
})) {
  console.log(device.friendlyName, device.location);
}
```

---

#### `processUpnpDevice(basicDevice, detailLevel, abortSignal?)`

Enrich a `BasicSsdpDevice` to the requested `DiscoveryDetailLevel`. Returns `ProcessedDevice`.

#### `processUpnpDeviceFromUrl(locationUrl, detailLevel, abortSignal?)`

Same enrichment starting from a device description URL (e.g. `http://192.168.1.105:1997/`).

---

### Enums & constants

#### `enum DiscoveryDetailLevel`

| Value | Meaning |
|-------|---------|
| `Basic` (`'basic'`) | SSDP fields only |
| `Description` (`'description'`) | + device description XML |
| `Services` (`'services'`) | + SCPD parse (no `invoke`) |
| `Full` (`'full'`) | + `action.invoke` / state helpers |

#### `enum BrowseFlag`

| Value | Meaning |
|-------|---------|
| `BrowseMetadata` | Metadata for the given object id |
| `BrowseDirectChildren` | Children of a container |

#### URN helpers & constants

```ts
UPNP_ORG_SERVICE_SCHEMA  // 'urn:schemas-upnp-org:service'
UPNP_ORG_DEVICE_SCHEMA   // 'urn:schemas-upnp-org:device'

buildUpnpServiceTypeIdentifier(serviceType: string, version?: number): string
buildUpnpDeviceTypeIdentifier(deviceType: string, version?: number): string

AVTRANSPORT_SERVICE          // ...:AVTransport:1
CONTENT_DIRECTORY_SERVICE    // ...:ContentDirectory:1
CONNECTION_MANAGER_SERVICE   // ...:ConnectionManager:1
RENDERING_CONTROL_SERVICE    // ...:RenderingControl:1
MEDIA_SERVER_DEVICE          // ...:MediaServer:1
MEDIA_RENDERER_DEVICE        // ...:MediaRenderer:1
```

---

### Device services & actions

After `Full` discovery, each entry in `device.serviceList` is a `ServiceDescription` with:

- `serviceType`, `serviceId`, `controlURL`, `SCPDURL`, …
- `actionList: Map<string, Action>` — keys are action names (`'Play'`, `'Browse'`, …)
- On `Full`, actions typically expose **`invoke(args) => Promise<...>`**

```js
const cds = device.serviceList.get('ContentDirectory');
const browse = cds.actionList.get('Browse');
const result = await browse.invoke({
  ObjectID: '0',
  BrowseFlag: 'BrowseDirectChildren',
  Filter: '*',
  StartingIndex: 0,
  RequestedCount: 10,
  SortCriteria: '',
});
```

Common renderer actions: `SetAVTransportURI`, `Play`, `Pause`, `Stop`, `GetTransportInfo`, `GetPositionInfo`, `GetVolume`, `SetVolume`.

---

### `class ContentDirectoryService`

Convenience wrapper around a ContentDirectory `ServiceDescription`.

```ts
new ContentDirectoryService(serviceInfo: ServiceDescription)
```

| Method | Signature | Description |
|--------|-----------|-------------|
| `browse` | `(objectId, browseFlag, filter?, startingIndex?, requestedCount?, sortCriteria?) => Promise<BrowseResult>` | CDS Browse |
| `search` | `(containerId, searchCriteria, filter?, startingIndex?, requestedCount?, sortCriteria?) => Promise<BrowseResult>` | CDS Search |

`browseFlag` should be a `BrowseFlag` enum value. `BrowseResult` includes `items`, `numberReturned`, `totalMatches`, optional `updateID`.

```js
const { ContentDirectoryService, BrowseFlag } = require('dlna.js');

const cds = new ContentDirectoryService(device.serviceList.get('ContentDirectory'));
const root = await cds.browse('0', BrowseFlag.BrowseDirectChildren);
for (const item of root.items) {
  console.log(item.title, item.id, item.class);
}
```

---

### SOAP & DIDL utilities

#### `sendUpnpCommand(controlURL, serviceType, actionName, args?)`

Low-level SOAP call. Returns a plain object of output arguments.

```js
const { sendUpnpCommand, AVTRANSPORT_SERVICE } = require('dlna.js');

await sendUpnpCommand(
  'http://192.168.1.105:1997/AVTransport/.../control.xml',
  AVTRANSPORT_SERVICE,
  'Play',
  { InstanceID: 0, Speed: '1' }
);
```

#### `createSingleItemDidlLiteXml(item, resource)`

Builds DIDL-Lite XML for `CurrentURIMetaData` / similar.

- `item`: `DidlLiteObject`-like (`id`, `parentId`, `title`, `class`, `restricted`, …)
- `resource`: `Resource`-like (`uri`, `protocolInfo`, optional `size`, `duration`)

---

### Logging

| Export | Description |
|--------|-------------|
| `setLogger(logger \| null)` | Use one logger for all modules (`null` → noop) |
| `setLoggerFactory(factory \| null)` | Per-module logger factory `(moduleName) => DlnaLogger` |
| `createModuleLogger(moduleName)` / `createLogger` | Logger bound to current factory (noop by default) |

```ts
interface DlnaLogger {
  error(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  debug(message: string, ...meta: unknown[]): void;
}
type LoggerFactory = (moduleName: string) => DlnaLogger;
```

---

### `retry(fn, options?)`

Retry an async function.

| Option | Default | Description |
|--------|---------|-------------|
| `retries` | `3` | Attempts |
| `delayMs` | `1000` | Delay between attempts |
| `logger` | module logger | Optional |
| `onRetry` | — | `(error, attempt) => void` |

---

## Key types (TypeScript)

Exported from the package (see `dist/index.d.ts` for full fields):

| Type | Role |
|------|------|
| `ApiDevice` / `ServerApiDevice` | Device as tracked by `ActiveDeviceManager` |
| `BasicSsdpDevice` | SSDP-only device |
| `DeviceDescription` | + description XML fields (`friendlyName`, `deviceType`, …) |
| `DeviceWithServicesDescription` | + `serviceList` |
| `FullDeviceDescription` | + invokable actions |
| `ProcessedDevice` | Union of the above by detail level |
| `ServiceDescription` | One UPnP service |
| `Action` / `ActionArgument` / `StateVariable` | SCPD model |
| `ActiveDeviceManagerOptions` | Manager options |
| `DiscoveryOptions` | Iterable discovery options |
| `BrowseResult` / `DidlLiteObject` / `DidlLiteContainer` / `Resource` | CDS / DIDL |
| `RawSsdpMessagePayload` / `RawSsdpMessageHandler` | Raw SSDP hook |

---

## Export checklist

Runtime / type exports from `dlna.js`:

- **Discovery:** `ActiveDeviceManager`, `discoverSsdpDevicesIterable`, `processUpnpDevice`, `processUpnpDeviceFromUrl`
- **CDS helper:** `ContentDirectoryService`, `BrowseFlag`
- **SOAP / DIDL:** `sendUpnpCommand`, `createSingleItemDidlLiteXml`
- **Logging:** `setLogger`, `setLoggerFactory`, `createLogger`, `createModuleLogger`, `DlnaLogger`, `LoggerFactory`
- **Utils:** `retry`
- **Enums / URNs:** `DiscoveryDetailLevel`, `AVTRANSPORT_SERVICE`, `CONTENT_DIRECTORY_SERVICE`, `CONNECTION_MANAGER_SERVICE`, `RENDERING_CONTROL_SERVICE`, `MEDIA_SERVER_DEVICE`, `MEDIA_RENDERER_DEVICE`, `UPNP_ORG_SERVICE_SCHEMA`, `UPNP_ORG_DEVICE_SCHEMA`, `buildUpnpServiceTypeIdentifier`, `buildUpnpDeviceTypeIdentifier`
- **Types:** `ApiDevice`, `ServerApiDevice`, and other types re-exported from `./types`

---

## Bugs

Please open issues at [github.com/tzlev-2/DLNA.js/issues](https://github.com/tzlev-2/DLNA.js/issues).

## Acknowledgment

If you use DLNA.js, a credit with a link to the [GitHub repository](https://github.com/tzlev-2/DLNA.js) is appreciated.

## License

MIT. See `LICENSE`.
