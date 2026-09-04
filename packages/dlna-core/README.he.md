[English](./README.md) | [עברית](./README.he.md)

---

# DLNA.js

ספריית JavaScript/TypeScript לגילוי ושליטה בהתקני DLNA / UPnP ברשת מקומית (Media Servers, Media Renderers ושירותים קשורים).

> **גרסה מוקדמת:** ה-API עשוי להשתנות בין גרסאות. קבצי הטיפוסים המותקנים (`dist/*.d.ts`) הם מקור האמת לחתימות.

**סביבת ריצה:** Node.js `>=18` (עובד גם עם Bun). גילוי ושליטה דורשים גישה לאותה רשת LAN כמו ההתקנים (SSDP multicast ב-UDP + HTTP לכתובות תיאור/שליטה).

```bash
npm install dlna.js
# או: yarn add dlna.js / bun add dlna.js
```

```js
const { ActiveDeviceManager, DiscoveryDetailLevel } = require('dlna.js');
```

---

## הערות חשובות

1. **הלוג שקט כברירת מחדל.** השתמשו ב-`setLogger(console)` (או `DlnaLogger` מותאם) אם רוצים לוגים מהספרייה. ב-CLI אינטראקטיבי עדיף להשאיר noop.
2. **שירותים נמצאים ב-`device.serviceList`** — זה `Map` עם מפתחות קצרים כמו `'AVTransport'`, `'ContentDirectory'`, `'RenderingControl'`, `'ConnectionManager'`. אין `device.getService()`.
3. **`detailLevel: 'full'`** (או `DiscoveryDetailLevel.Full`) נדרש ל-`action.invoke(...)`. ברמות נמוכות יותר ייתכן שתראו שירותים בלי פעולות מוכנות להפעלה.
4. **רנדרירים רבים מקבלים רק URI מסוג `http-get`** (לא `https:`) ב-`SetAVTransportURI`. בדקו את Sink ב-`GetProtocolInfo`. העדיפו כתובות `http://...` (או חזית HTTP ברשת המקומית) בהזרמה.
5. **ניגון מ-URL** במכשיר MediaRenderer הוא UPnP AV רשמי: `SetAVTransportURI` ואז `Play`. הרנדריר מושך את ה-URL בעצמו.

---

## התחלה מהירה

```js
const {
  ActiveDeviceManager,
  DiscoveryDetailLevel,
  createSingleItemDidlLiteXml,
  setLogger,
} = require('dlna.js');

// אופציונלי: setLogger(console);

const mgr = new ActiveDeviceManager({
  searchTarget: 'urn:schemas-upnp-org:device:MediaRenderer:1',
  detailLevel: DiscoveryDetailLevel.Full,
  mSearchIntervalMs: 5000,
});

mgr.on('devicefound', async (_udn, device) => {
  console.log('נמצא', device.friendlyName, device.remoteAddress);

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

סייר אינטראקטיבי (במונוריפו): `bun examples/cli_device_explorer.ts`.

---

## ייחוס API

כל הסימנים למטה מיוצאים משורש החבילה (`dlna.js`).

### גילוי

#### `class ActiveDeviceManager extends EventEmitter`

גילוי SSDP רציף ומטמון התקנים.

```ts
new ActiveDeviceManager(options?: ActiveDeviceManagerOptions)
```

| אפשרות | טיפוס | ברירת מחדל | תיאור |
|--------|------|------------|--------|
| `searchTarget` | `string` | `'ssdp:all'` | ערך `ST` ב-SSDP |
| `detailLevel` | `DiscoveryDetailLevel` | העדיפו להעביר במפורש | עומק משיכה/ניתוח |
| `mSearchIntervalMs` | `number` | `10000` | מרווח בין M-SEARCH |
| `deviceCleanupIntervalMs` | `number` | `60000` | ניקוי התקנים שפג תוקפם |
| `includeIPv6` | `boolean` | `false` | גם IPv6 |
| `onRawSsdpMessage` | `RawSsdpMessageHandler` | — | קולבק להודעת SSDP גולמית |
| `networkInterfaces` | `string[]` | — | הגבלה לממשקים בשם |

**אירועים**

| אירוע | ארגומנטים | מתי |
|-------|-----------|-----|
| `devicefound` | `(udn, device: ApiDevice)` | התקן חדש עובד |
| `deviceupdated` | `(udn, device: ApiDevice)` | התקן קיים עודכן |
| `devicelost` | `(udn, device: ApiDevice)` | התקן נעלם / פג תוקף |
| `error` | `(error: Error)` | שגיאה קריטית |

**מתודות**

| מתודה | מחזיר | תיאור |
|-------|--------|--------|
| `start()` | `Promise<void>` | מתחיל גילוי |
| `stop()` | `Promise<void>` | עוצר וסוגר sockets |
| `getActiveDevices()` | `Map<string, ApiDevice>` | התקנים פעילים לפי UDN |

---

#### `discoverSsdpDevicesIterable(options?: DiscoveryOptions): AsyncIterable<ProcessedDevice>`

גילוי חד-פעמי מוגבל בזמן כ-iterable (`for await...of`).

| אפשרות | טיפוס | ברירת מחדל | תיאור |
|--------|------|------------|--------|
| `timeoutMs` | `number` | `5000` | חלון הגילוי הכולל |
| `searchTarget` | `string` | `'ssdp:all'` | `ST` |
| `detailLevel` | `DiscoveryDetailLevel` | `'full'` | עומק העשרה |
| `includeIPv6` | `boolean` | `false` | IPv6 |
| `abortSignal` | `AbortSignal` | — | ביטול |
| `onDeviceFound` | `(device) => void` | — | קולבק לכל התקן |
| `onRawSsdpMessage` | `RawSsdpMessageHandler` | — | SSDP גולמי |
| `networkInterfaces` | מילון ממשקים כמו `os.networkInterfaces()` | — | דריסת רשימת ממשקים |

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

מעשיר `BasicSsdpDevice` לרמת הפירוט המבוקשת. מחזיר `ProcessedDevice`.

#### `processUpnpDeviceFromUrl(locationUrl, detailLevel, abortSignal?)`

אותה העשרה מכתובת XML של תיאור התקן.

---

### Enums וקבועים

#### `enum DiscoveryDetailLevel`

| ערך | משמעות |
|-----|--------|
| `Basic` (`'basic'`) | שדות SSDP בלבד |
| `Description` (`'description'`) | + תיאור התקן |
| `Services` (`'services'`) | + SCPD (בלי `invoke`) |
| `Full` (`'full'`) | + `action.invoke` |

#### `enum BrowseFlag`

| ערך | משמעות |
|-----|--------|
| `BrowseMetadata` | מטא-דאטה לאובייקט |
| `BrowseDirectChildren` | ילדים של קונטיינר |

#### עזרי URN וקבועים

```ts
UPNP_ORG_SERVICE_SCHEMA
UPNP_ORG_DEVICE_SCHEMA

buildUpnpServiceTypeIdentifier(serviceType: string, version?: number): string
buildUpnpDeviceTypeIdentifier(deviceType: string, version?: number): string

AVTRANSPORT_SERVICE
CONTENT_DIRECTORY_SERVICE
CONNECTION_MANAGER_SERVICE
RENDERING_CONTROL_SERVICE
MEDIA_SERVER_DEVICE
MEDIA_RENDERER_DEVICE
```

---

### שירותים ופעולות על התקן

אחרי גילוי ב-`Full`, כל ערך ב-`device.serviceList` הוא `ServiceDescription` עם:

- `serviceType`, `serviceId`, `controlURL`, `SCPDURL`, …
- `actionList: Map<string, Action>` — מפתחות שמות פעולות (`'Play'`, `'Browse'`, …)
- ב-`Full`, לפעולות יש בדרך כלל **`invoke(args) => Promise<...>`**

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

פעולות נפוצות ברנדריר: `SetAVTransportURI`, `Play`, `Pause`, `Stop`, `GetTransportInfo`, `GetPositionInfo`, `GetVolume`, `SetVolume`.

---

### `class ContentDirectoryService`

עטיפה נוחה לשירות ContentDirectory.

```ts
new ContentDirectoryService(serviceInfo: ServiceDescription)
```

| מתודה | חתימה | תיאור |
|-------|--------|--------|
| `browse` | `(objectId, browseFlag, filter?, startingIndex?, requestedCount?, sortCriteria?) => Promise<BrowseResult>` | Browse |
| `search` | `(containerId, searchCriteria, filter?, startingIndex?, requestedCount?, sortCriteria?) => Promise<BrowseResult>` | Search |

`browseFlag` צריך להיות ערך מ-`BrowseFlag`. ב-`BrowseResult`: `items`, `numberReturned`, `totalMatches`, ואופציונלי `updateID`.

```js
const { ContentDirectoryService, BrowseFlag } = require('dlna.js');

const cds = new ContentDirectoryService(device.serviceList.get('ContentDirectory'));
const root = await cds.browse('0', BrowseFlag.BrowseDirectChildren);
for (const item of root.items) {
  console.log(item.title, item.id, item.class);
}
```

---

### SOAP ו-DIDL

#### `sendUpnpCommand(controlURL, serviceType, actionName, args?)`

קריאת SOAP ברמה נמוכה. מחזיר אובייקט של ארגומנטי פלט.

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

בונה XML של DIDL-Lite עבור `CurrentURIMetaData` וכדומה.

- `item`: דמוי `DidlLiteObject` (`id`, `parentId`, `title`, `class`, `restricted`, …)
- `resource`: דמוי `Resource` (`uri`, `protocolInfo`, אופציונלי `size`, `duration`)

---

### לוגינג

| ייצוא | תיאור |
|-------|--------|
| `setLogger(logger \| null)` | לוגר אחד לכל המודולים (`null` → noop) |
| `setLoggerFactory(factory \| null)` | מפעל לוגרים לפי שם מודול |
| `createModuleLogger` / `createLogger` | לוגר לפי ה-factory הנוכחי (noop כברירת מחדל) |

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

ניסיונות חוזרים לפונקציה אסינכרונית.

| אפשרות | ברירת מחדל | תיאור |
|--------|------------|--------|
| `retries` | `3` | מספר ניסיונות |
| `delayMs` | `1000` | המתנה בין ניסיונות |
| `logger` | לוגר המודול | אופציונלי |
| `onRetry` | — | `(error, attempt) => void` |

---

## טיפוסים עיקריים (TypeScript)

מיוצאים מהחבילה (ראו `dist/index.d.ts` לשדות המלאים):

| טיפוס | תפקיד |
|-------|--------|
| `ApiDevice` / `ServerApiDevice` | התקן כפי שמנוהל ב-`ActiveDeviceManager` |
| `BasicSsdpDevice` | SSDP בלבד |
| `DeviceDescription` | + שדות מתיאור ההתקן |
| `DeviceWithServicesDescription` | + `serviceList` |
| `FullDeviceDescription` | + פעולות מוכנות ל-invoke |
| `ProcessedDevice` | איחוד לפי רמת פירוט |
| `ServiceDescription` | שירות UPnP אחד |
| `Action` / `ActionArgument` / `StateVariable` | מודל SCPD |
| `ActiveDeviceManagerOptions` | אפשרויות המנהל |
| `DiscoveryOptions` | אפשרויות ל-iterable |
| `BrowseResult` / `DidlLiteObject` / `DidlLiteContainer` / `Resource` | CDS / DIDL |
| `RawSsdpMessagePayload` / `RawSsdpMessageHandler` | וו ל-SSDP גולמי |

---

## רשימת ייצוא

מיוצאים מ-`dlna.js`:

- **גילוי:** `ActiveDeviceManager`, `discoverSsdpDevicesIterable`, `processUpnpDevice`, `processUpnpDeviceFromUrl`
- **עזר CDS:** `ContentDirectoryService`, `BrowseFlag`
- **SOAP / DIDL:** `sendUpnpCommand`, `createSingleItemDidlLiteXml`
- **לוגינג:** `setLogger`, `setLoggerFactory`, `createLogger`, `createModuleLogger`, `DlnaLogger`, `LoggerFactory`
- **עזרים:** `retry`
- **Enums / URN:** `DiscoveryDetailLevel`, קבועי השירותים/התקנים ופונקציות ה-`buildUpnp*Identifier`
- **טיפוסים:** `ApiDevice`, `ServerApiDevice`, ושאר הטיפוסים מ-`./types`

---

## באגים

פתחו issues ב-[github.com/tzlev-2/DLNA.js/issues](https://github.com/tzlev-2/DLNA.js/issues).

## קרדיט

אם אתם משתמשים ב-DLNA.js, נודה על קרדיט עם קישור ל[מאגר ב-GitHub](https://github.com/tzlev-2/DLNA.js).

## רישיון

MIT. ראו `LICENSE`.
