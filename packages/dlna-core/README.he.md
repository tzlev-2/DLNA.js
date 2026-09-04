[English](./README.md) | [עברית](./README.he.md)

---
# DLNA.js

ספריית JavaScript/TypeScript פשוטה וקלה לשימוש לאינטראקציה עם התקני DLNA (Digital Living Network Alliance) ו-UPnP (Universal Plug and Play) ברשת המקומית.

חבילה זו מספקת כלים לגילוי התקני DLNA, עיון בתוכן שלהם, ושליטה בסיסית על ניגון מדיה. היא מיועדת למפתחים המעוניינים לשלב יכולות DLNA באפליקציות Node.js.

## תכונות

*   גילוי התקני DLNA/UPnP ברשת (שרתי מדיה, נגני מדיה ועוד).
*   עיון בתיקיות וקבצים של שרתי מדיה.
*   קבלת מידע מפורט (metadata) על פריטי מדיה.
*   שליחת פקודות בסיסיות לנגני מדיה (כגון Play, Pause, Stop, SetVolume).
*   הפעלת מתודות DLNA.
*   גישה ברמה נמוכה לשליחת כל פקודת SOAP לכל שירות UPnP.

## התקנה
הפרוייקט נבדק עם `Bun.js` בלבד. הכל אמור לפעול כשורה עם `Node.js` אך לא נבדק היטב.

```bash
npm install dlna.js
# או
yarn add dlna.js
# או
bun add dlna.js
```

## תיעוד API

### 1. גילוי התקנים

ניתן לבצע גילוי התקנים בשתי דרכים, בהתאם לצרכים שלך. המנגנון המרכזי הוא `ActiveDeviceManager`, המספק גילוי רציף מבוסס אירועים. לחיפושים פשוטים וחד-פעמיים, הפונקציה `discoverSsdpDevicesIterable` מספקת מעטפת נוחה.

#### `ActiveDeviceManager` (גילוי רציף מבוסס אירועים)

קלאס זה הוא הכלי העיקרי לגילוי התקנים. הוא רץ ברקע, מחפש באופן פעיל התקנים, ומנהל רשימה של התקנים זמינים.

**מתי להשתמש?**
יש להשתמש ב-`ActiveDeviceManager` עבור אפליקציות הפועלות לאורך זמן וצריכות לעקוב באופן רציף אחר התקנים ברשת, כגון שרתים או אפליקציות שולחניות.

**דוגמה:**
```typescript
import { ActiveDeviceManager } from 'dlna.js';
import type { ApiDevice } from 'dlna.js';

// 1. יצירת מופע של המנהל עם אופציות מפורטות
const deviceManager = new ActiveDeviceManager({
  // searchTarget: סוג ההתקנים לחיפוש.
  // ברירת מחדל: 'ssdp:all'.
  searchTarget: 'urn:schemas-upnp-org:device:MediaServer:1',

  // detailLevel: רמת הפירוט לאחזור עבור כל התקן.
  // - 'basic': מידע בסיסי מהודעת ה-SSDP.
  // - 'description': כולל את תיאור ההתקן מקובץ ה-XML שלו.
  // - 'services': כולל גם את רשימת השירותים של ההתקן.
  // - 'full': כולל את כל המידע, כולל הפעולות של כל שירות.
  // ברירת מחדל: 'basic'.
  detailLevel: 'full',

  // mSearchIntervalMs: כל כמה זמן (במילישניות) לשלוח בקשת גילוי חדשה.
  // ברירת מחדל: 10000 (10 שניות).
  mSearchIntervalMs: 15000,

  // deviceCleanupIntervalMs: כל כמה זמן (במילישניות) לבדוק ולהסיר התקנים לא פעילים.
  // ברירת מחדל: 30000 (30 שניות).
  deviceCleanupIntervalMs: 35000,

  // includeIPv6: האם להשתמש גם ב-IPv6 לגילוי.
  // ברירת מחדל: false.
  includeIPv6: false,
});

// 2. האזנה לאירועים
deviceManager.on('devicefound', (udn: string, device: ApiDevice) => {
  console.log(`[+] התקן נמצא: ${device.friendlyName}`);
});

deviceManager.on('devicelost', (udn: string, device: ApiDevice) => {
  console.log(`[-] התקן אבד: ${device.friendlyName}`);
});

// 3. התחלת תהליך הגילוי
async function runApp() {
  console.log('מתחיל גילוי התקנים רציף...');
  await deviceManager.start();
  console.log('המנהל פועל ומאזין להתקנים...');

  // הדגמה של שימוש ב-getActiveDevices()
  setInterval(() => {
    const activeDevices = deviceManager.getActiveDevices();
    console.log(`\n--- התקנים פעילים כרגע: ${activeDevices.size} ---`);
    activeDevices.forEach(device => {
      console.log(`  - ${device.friendlyName} (UDN: ${device.UDN})`);
    });
  }, 30000);

  // עצירה חיננית של התהליך
  process.on('SIGINT', async () => {
    console.log('\nעוצר את מנהל ההתקנים...');
    await deviceManager.stop();
    process.exit(0);
  });
}

runApp();
```

#### `discoverSsdpDevicesIterable` (Async Iterable, חיפוש חד-פעמי)

פונקציה זו היא מעטפת נוחה סביב `ActiveDeviceManager` לביצוע חיפוש יחיד ומוגבל בזמן. היא מחזירה `AsyncIterable`, המאפשר עיבוד קל של התקנים בלולאת `for await...of`.

**מתי להשתמש?**
למקרים פשוטים בהם צריך לקבל רשימה של התקנים נוכחיים ברשת ללא ניטור רציף.

**דוגמה:**
```typescript
import { discoverSsdpDevicesIterable } from 'dlna.js';

async function findMediaServers() {
  console.log('מחפש שרתי מדיה...');
  try {
    const options = {
      searchTarget: 'urn:schemas-upnp-org:device:MediaServer:1',
      timeoutMs: 10000,
    };
    for await (const device of discoverSsdpDevicesIterable(options)) {
      console.log(`נמצא: ${device.friendlyName} בכתובת ${device.baseURL}`);
    }
    console.log('החיפוש הסתיים.');
  } catch (error) {
    console.error('אירעה שגיאה במהלך הגילוי:', error);
  }
}

findMediaServers();
```

### 2. אינטראקציה עם שירותי ההתקן

כאשר מגלים התקן עם `detailLevel: 'full'`, הספרייה מנתחת אוטומטית את שירותי ההתקן ומצמידה מתודת `invoke` נוחה לכל פעולה זמינה. זה מאפשר אינטראקציה ישירה עם יכולות ההתקן.

**גישה לשירותים ופעולות**

1.  **קבלת השירות:** גש למאפיין `device.serviceList` (שהוא `Map`) והשתמש במתודה `get(serviceName)` כדי לקבל את השירות. למשל: `device.serviceList.get('AVTransport')`.
2.  **קבלת הפעולה:** השתמש במתודה `service.actionList.get(actionName)` כדי לקבל פעולה ספציפית.
3.  **הפעלת הפעולה:** קרא למתודת `action.invoke(args)` עם הארגומנטים הנדרשים.

**דוגמה: שליטה בנגן מדיה (Play, Pause, Stop)**
```typescript
import { ActiveDeviceManager, createSingleItemDidlLiteXml } from 'dlna.js';
import type { ApiDevice } from 'dlna.js';

// ... (קוד לאיתור התקן MediaRenderer עם detailLevel: 'full') ...

deviceManager.on('devicefound', async (udn: string, device: ApiDevice) => {
  console.log(`נמצא נגן מדיה: ${device.friendlyName}`);

  // קבלת שירות AVTransport
  const avTransport = device.serviceList.get('AVTransport');
  if (!avTransport?.actionList) {
    console.error('לנגן זה אין שירות AVTransport תקין.');
    return;
  }

  try {
    // קבלת הפעולות מתוך רשימת הפעולות של השירות
    const setUriAction = avTransport.actionList.get('SetAVTransportURI');
    const playAction = avTransport.actionList.get('Play');
    const pauseAction = avTransport.actionList.get('Pause');

    if (!setUriAction || !playAction || !pauseAction) {
      console.error('אחת או יותר מהפעולות הנדרשות חסרות.');
      return;
    }

    const mediaUrl = 'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
    const instanceId = { InstanceID: 0 };
    
    // יצירת מטא-דאטה עבור הפריט
    const item = { 
      id: '1', 
      parentId: '0', 
      title: 'Big Buck Bunny', 
      class: 'object.item.videoItem', 
      restricted: false 
    };
    const resource = { uri: mediaUrl, protocolInfo: 'http-get:*:video/mp4:*' };
    const didlXml = createSingleItemDidlLiteXml(item, resource);

    // 1. הגדרת כתובת המדיה לניגון
    console.log('מגדיר את כתובת המדיה...');
    await setUriAction.invoke({ ...instanceId, CurrentURI: mediaUrl, CurrentURIMetaData: didlXml });

    // 2. שליחת פקודת ניגון
    console.log('שולח פקודת Play...');
    await playAction.invoke({ ...instanceId, Speed: '1' });
    console.log('הניגון החל!');

    // 3. המתנה של 10 שניות ואז השהייה
    setTimeout(async () => {
      console.log('שולח פקודת Pause...');
      await pauseAction.invoke(instanceId);
      console.log('הניגון הושהה.');
    }, 10000);

  } catch (error) {
    console.error(`שגיאה בשליטה על ההתקן ${device.friendlyName}:`, error);
  }
});
```

### 3. עיון בתוכן (`ContentDirectoryService`)

לאחר גילוי שרת מדיה, ניתן להשתמש בקלאס `ContentDirectoryService` לעיון בתוכן שלו.

**דוגמה:**
```typescript
import { ContentDirectoryService } from 'dlna.js';
import type { DeviceDescription } from 'dlna.js';

async function browseAndSearchContent(device: DeviceDescription) {
  const cdsServiceInfo = device.serviceList.get('ContentDirectory');
  if (!cdsServiceInfo) return;

  const cds = new ContentDirectoryService(cdsServiceInfo);

  try {
    // דוגמה ל-browse
    const browseResult = await cds.browse('0', 'BrowseDirectChildren');
    console.log(`נמצאו ${browseResult.totalMatches} פריטים בתיקיית השורש.`);

    // דוגמה ל-search
    const searchResult = await cds.search('0', 'dc:title contains "Vacation"');
    console.log(`נמצאו ${searchResult.totalMatches} פריטים התואמים לחיפוש.`);

  } catch (error) {
    console.error('שגיאה באינטראקציה עם ContentDirectory:', error);
  }
}
```

### 4. שליחת פקודות ברמה נמוכה (`sendUpnpCommand`)

לשליטה מתקדמת, או לעבודה עם שירותים שהספרייה לא מספקת להם ממשק נוח, ניתן להשתמש בפונקציה `sendUpnpCommand` לשליחת פקודות SOAP גנריות.

**דוגמה: קבלת עוצמת השמע הנוכחית מנגן מדיה**
```typescript
import { sendUpnpCommand } from 'dlna.js';
import type { DeviceDescription } from 'dlna.js';

async function getVolume(device: DeviceDescription) {
  const rcService = device.serviceList.get('RenderingControl');
  if (!rcService) {
    console.log('לא נמצא שירות RenderingControl.');
    return;
  }

  try {
    const result = await sendUpnpCommand(
      rcService.controlURL,
      rcService.serviceType,
      'GetVolume',
      {
        InstanceID: 0,
        Channel: 'Master'
      }
    );
    console.log(`עוצמת השמע הנוכחית היא: ${result.CurrentVolume}`);
  } catch (error) {
    console.error('שגיאה בקבלת עוצמת השמע:', error);
  }
}
```

### 5. כלי עזר מתקדמים

#### `createSingleItemDidlLiteXml(item, resource)`
פונקציה זו יוצרת מחרוזת XML של DIDL-Lite עבור פריט מדיה בודד. שימושי בעיקר כאשר רוצים לספק מטא-דאטה לנגן מדיה.

**דוגמה:**
```typescript
import { createSingleItemDidlLiteXml } from 'dlna.js';

const item = { 
	id: 'item1', 
	parentId: '0', 
	title: 'My Song', 
	class: 'object.item.audioItem.musicTrack', 
	restricted: false 
};

const resource = { uri: 'http://192.168.1.10/song.mp3', protocolInfo: 'http-get:*:audio/mpeg:*' };
const xmlMetadata = createSingleItemDidlLiteXml(item, resource);
console.log(xmlMetadata);
```

#### `processUpnpDeviceFromUrl(locationUrl, detailLevel, abortSignal?)`
פונקציה ברמה נמוכה המאפשרת לעבד התקן ישירות מכתובת ה-URL של קובץ ה-XML שלו.

**דוגמה:**
```typescript
import { processUpnpDeviceFromUrl, DiscoveryDetailLevel } from 'dlna.js';

async function getDeviceDetails(url: string) {
  console.log(`מאחזר פרטים מלאים עבור התקן בכתובת: ${url}`);
  try {
    const device = await processUpnpDeviceFromUrl(url, DiscoveryDetailLevel.Full);
    if (device) {
      console.log(`העיבוד הצליח: ${device.friendlyName}`);
    } else {
      console.log('לא ניתן היה לעבד את פרטי ההתקן.');
    }
  } catch (error) {
    console.error('שגיאה בעיבוד ההתקן מהכתובת:', error);
  }
}

// יש להחליף בכתובת אמיתית מהרשת שלך
const deviceXmlUrl = 'http://192.168.1.1:12345/device.xml';
getDeviceDetails(deviceXmlUrl);
```

## באגים

אני לא יודע האם אוכל לטפל בבאגים, אם ימצאו.
אבל אפשר לנסות...

## בקשת קרדיט

אם אתם משתמשים ב-DLNA.js בפרויקט שלכם, נודה לכם על מתן קרדיט עם קישור ל[מאגר ב-GitHub](https://github.com/MusiCode1/DLNA.js) בדף ה"אודות" או בתיעוד של הפרויקט.

## רישיון

פרויקט זה תחת רישיון MIT. ראו קובץ `LICENSE` לפרטים.


