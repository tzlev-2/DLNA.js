// קובץ זה מכיל את כל הגדרות הממשקים והטיפוסים הקשורים ל-UPnP.
import type { ContentDirectory, AVTransport, RenderingControl } from './specificTypes';
import type { RemoteInfo } from 'node:dgram'; // הוספת ייבוא
import * as os from 'os'; // הוספת ייבוא, למרות שכבר היה שימוש ב-import('os') בהמשך

// AbortSignal זמין גלובלית ב-Node.js מודרני, אין צורך בייבוא.

/**
 * @hebrew מידע על הודעת SSDP גולמית שהתקבלה.
 */
export interface RawSsdpMessagePayload {
    /**
     * @hebrew ההודעה הגולמית כפי שהתקבלה מהרשת.
     */
    message: Buffer;
    /**
     * @hebrew מידע על כתובת השולח.
     */
    remoteInfo: RemoteInfo;
    /**
     * @hebrew סוג הסוקט שקלט את ההודעה (למשל, 'ipv4-unicast', 'ipv6-multicast').
     */
    socketType: string;
}

/**
 * @hebrew פונקציית קולבק המופעלת עם קבלת הודעת SSDP גולמית.
 * @param payload - המידע על ההודעה הגולמית.
 */
export type RawSsdpMessageHandler = (payload: RawSsdpMessagePayload) => void;

/**
 * @hebrew אפשרויות עבור פונקציית הגילוי.
 */
export interface DiscoveryOptions {
    /**
     * @hebrew זמן קצוב כולל (במילישניות) לכל תהליך הגילוי.
     * @default 5000
     */
    timeoutMs?: number;
    /**
     * @hebrew ה-ST (Service Type) לחיפוש.
     * @default "ssdp:all"
     */
    searchTarget?: string;
    /**
     * @hebrew זמן קצוב (במילישניות) לחיפוש על כל ממשק רשת בודד.
     * @default 2000
     */
    //discoveryTimeoutPerInterfaceMs?: number;
    /**
     * @hebrew פונקציית קולבק שתוזמן מיד עם קבלת תגובה ייחודית מהתקן SSDP.
     */
    onDeviceFound?: (device: ProcessedDevice) => void; // שים לב: הטיפוס ProcessedDevice יוגדר בשלב מאוחר יותר
    /**
     * @hebrew האם לנסות לבצע גילוי גם על ממשקי IPv6 Link-Local.
     * @default false
     */
    includeIPv6?: boolean;
    // customLogger הוסר כחלק מאיחוד הלוגר
    // /**
    //  * @hebrew מאפשר העברת פונקציית לוגינג מותאמת אישית.
    //  * @default console
    //  */
    // customLogger?: (level: 'debug' | 'warn' | 'error', message: string, ...optionalParams: any[]) => void;
    /**
     * @hebrew רשימת ממשקי רשת ידועה מראש (אופציונלי), במבנה זהה לזה המוחזר מ-`os.networkInterfaces()`.
     * אם לא יסופק, הפונקציה תשתמש ב-`os.networkInterfaces()`.
     */
    networkInterfaces?: NodeJS.Dict<import('os').NetworkInterfaceInfo[]>; // Added import('os') for clarity
    /**
     * @hebrew רמת הפירוט הרצויה עבור כל התקן שיימצא.
     * @default 'full'
     */
    detailLevel?: DiscoveryDetailLevel;
    /**
     * @hebrew אובייקט AbortSignal חיצוני לביטול תהליך הגילוי.
     */
    abortSignal?: AbortSignal;
    /**
     * @hebrew (אופציונלי) פונקציית קולבק שתופעל עבור כל הודעת SSDP גולמית המתקבלת.
     */
    onRawSsdpMessage?: RawSsdpMessageHandler;
}

/**
 * @hebrew רמות פירוט אפשריות לגילוי התקנים.
 * - `basic`: רק מידע בסיסי מ-SSDP.
 * - `description`: כולל ניתוח של קובץ התיאור של ההתקן.
 * - `services`: כולל ניתוח של קבצי התיאור של השירותים (SCPD).
 * - `full`: כולל את כל המידע הנ"ל.
 */
export enum DiscoveryDetailLevel {
    /** @hebrew מחזיר רק מידע בסיסי מ-SSDP (כמו USN, location, server). */
    Basic = 'basic',
    /** @hebrew כולל ניתוח של קובץ התיאור של ההתקן (XML), אך לא את פרטי השירותים. */
    Description = 'description',
    /** @hebrew כולל ניתוח של קבצי התיאור של השירותים (SCPD), אך ללא יצירת פונקציות invoke/query. */
    Services = 'services',
    /** @hebrew כולל את כל המידע: תיאור התקן, תיאורי שירותים, ופונקציות invoke/query מוכנות לשימוש. */
    Full = 'full',
}

/**
 * @hebrew מייצג התקן SSDP בסיסי שנמצא.
 */
export interface BasicSsdpDevice {
    /** @hebrew שגיאה אפשרית שקרתה במהלך עיבוד ההתקן ברמה זו. */
    error?: string;
    /** @hebrew רמת הפירוט שהושגה בפועל עבור התקן זה. */
    detailLevelAchieved?: DiscoveryDetailLevel;
    /**
     * @hebrew USN (Unique Service Name) של ההתקן.
     */
    usn: string;
    /**
     * @hebrew UDN (Unique Device Name) של ההתקן, כפי שחולץ מה-USN.
     */
    UDN: string;
    /**
     * @hebrew כתובת ה-URL של קובץ התיאור של ההתקן.
     */
    location: string;
    /**
     * @hebrew מחרוזת השרת של ההתקן.
     */
    server: string;
    /**
     * @hebrew ST (Search Target) או NT (Notification Type) של ההתקן.
     */
    st: string; // Search Target or Notification Type
    /**
     * @hebrew כתובת ה-IP של ההתקן השולח/מגיב.
     */
    remoteAddress: string;
    /**
     * @hebrew הפורט של ההתקן השולח/מגיב.
     */
    remotePort: number;
    /**
     * @hebrew כל הכותרות שפורסרו מהודעת ה-SSDP.
     */
    headers: Record<string, string>;
    /**
     * @hebrew חותמת זמן של קבלת/עיבוד ההודעה.
     */
    timestamp: number;
    /**
     * @hebrew סוג הודעת ה-SSDP (בקשה או תגובה).
     */
    messageType: 'REQUEST' | 'RESPONSE';
    /**
     * @hebrew שיטת ה-HTTP (עבור בקשות כמו NOTIFY, M-SEARCH).
     */
    httpMethod?: string;
    /**
     * @hebrew קוד הסטטוס של HTTP (עבור תגובות).
     */
    httpStatusCode?: number;
    /**
     * @hebrew הודעת הסטטוס של HTTP (עבור תגובות).
     */
    httpStatusMessage?: string;
    /**
     * @hebrew ערך ה-max-age מכותרת ה-Cache-Control, אם קיים.
     */
    cacheControlMaxAge?: number;
    /**
     * @hebrew כותרת NTS (Notification Sub Type), רלוונטית להודעות NOTIFY.
     */
    nts?: string;
    /**
     * @hebrew גרסת ה-HTTP של ההודעה (למשל, "1.1").
     */
    httpVersion?: string;
}

/**
 * @hebrew מייצג אייקון של התקן.
 */
export interface DeviceIcon {
    mimetype?: string;
    width: number;
    height: number;
    depth: number;
    url?: string;
}

/**
 * @hebrew ממשק בסיס לתיאור שירות של התקן.
 */
export interface BaseServiceDescription {
    serviceType: string;
    serviceId: string;
    SCPDURL: string;
    controlURL: string;
    eventSubURL: string;
    /**
     * @hebrew מפת הפעולות הזמינות בשירות (מפתח: שם הפעולה מנורמל).
     * מאוכלס לאחר ניתוח SCPD. בפאזה של `DeviceWithServicesDescription`,
     * הפונקציה `invoke` על כל `Action` עדיין לא תהיה מוגדרת.
     */
    actionList?: Map<string, Action>;
    /**
     * @hebrew מפת משתני המצב של השירות (מפתח: שם משתנה המצב מנורמל).
     * מאוכלס לאחר ניתוח SCPD. בפאזה של `DeviceWithServicesDescription`,
     * הפונקציה `query` על כל `StateVariable` עדיין לא תהיה מוגדרת.
     */
    stateVariableList?: Map<string, StateVariable>;
    /** @hebrew שגיאה אפשרית שקרתה במהלך טעינת או ניתוח ה-SCPD. */
    scpdError?: string;
}


/**
 * @hebrew מייצג תיאור שירות של התקן, יכול להיות גנרי או ספציפי.
 */
export type ServiceDescription =
    | ContentDirectory.SpecificService
    | AVTransport.SpecificService
    | RenderingControl.SpecificService
    | BaseServiceDescription; // BaseServiceDescription חייב להיות אחרון כ-fallback

// =======================================================================
// הממשקים הבאים קשורים לפרטי SCPD (Service Control Protocol Description)
// =======================================================================

/**
 * @hebrew מייצג ארגומנט של פעולה (Action) בשירות UPnP.
 */
export interface ActionArgument {
    /** @hebrew שם הארגומנט. */
    name: string;
    /** @hebrew כיוון הארגומנט (קלט או פלט). */
    direction: 'in' | 'out';
    /** @hebrew שם משתנה המצב (StateVariable) הקשור לארגומנט זה. */
    relatedStateVariable: string;
    // שדה אפשרי עבור ערך ברירת מחדל או ערכים מותרים, אם רלוונטי וזמין
    // defaultValue?: string;
    // allowedValueList?: string[];
}

/**
 * @hebrew מייצג פעולה (Action) שניתן לבצע על שירות UPnP.
 */
export interface Action {
    /** @hebrew שם הפעולה. */
    name: string;
    /** @hebrew רשימת הארגומנטים של הפעולה (אופציונלי). */
    arguments?: ActionArgument[];
    /**
     * @hebrew פונקציה להפעלת הפעולה ישירות.
     * @param args - אובייקט המכיל את הארגומנטים הנדרשים לפעולה (שם ארגומנט: ערך).
     * @returns הבטחה שתתממש עם אובייקט המכיל את תוצאות הפעולה (ארגומנטים מסוג 'out').
     */
    invoke?: (args: Record<string, any>) => Promise<Record<string, any>>;
}

/**
 * @hebrew מייצג משתנה מצב (State Variable) של שירות UPnP.
 */
export interface StateVariable {
    /** @hebrew שם משתנה המצב. */
    name: string;
    /** @hebrew טיפוס הנתונים של המשתנה (למשל, 'string', 'ui4', 'boolean'). */
    dataType: string;
    /** @hebrew ערך ברירת המחדל של המשתנה (אופציונלי). */
    defaultValue?: string;
    /** @hebrew רשימת ערכים מותרים למשתנה (אופציונלי). */
    allowedValueList?: string[];
    /**
     * @hebrew מציין האם המשתנה שולח אירועים. הערכים האפשריים הם "yes" או "no".
     */
    sendEvents?: "yes" | "no";
    /**
     * @hebrew פונקציה לשאילתת ערך משתנה המצב (אם נתמך על ידי השירות).
     * @returns הבטחה שתתממש עם ערך משתנה המצב.
     */
    query?: () => Promise<any>;
    // שדות אופציונליים נוספים לפי הצורך, כגון:
    // min?: string; // ערך מינימלי, אם רלוונטי
    // max?: string; // ערך מקסימלי, אם רלוונטי
    // step?: string; // צעד, אם רלוונטי
}

/**
 * @hebrew מייצג תיאור מלא של התקן (מניתוח XML).
 */
export interface DeviceDescription extends BasicSsdpDevice {
    // error ו-detailLevelAchieved כבר מוגדרים ב-BasicSsdpDevice
    deviceType: string;
    friendlyName: string;
    manufacturer: string;
    manufacturerURL?: string;
    modelDescription?: string;
    modelName: string;
    modelNumber?: string | number;
    modelURL?: string;
    serialNumber?: string | number;
    UDN: string; // Unique Device Name
    presentationURL?: string;
    iconList?: DeviceIcon[];
    /**
     * @hebrew מפת השירותים של ההתקן (מפתח: serviceType מנורמל).
     */
    serviceList?: Map<string, ServiceDescription>;
    deviceList?: DeviceDescription[]; // התקנים משוננים (נשאר כמערך)
    // שדות שנוספו כדי לשמר מידע מהגילוי הראשוני או מה-location URL
    baseURL?: string; // כתובת הבסיס של ההתקן (נגזר מ-locationUrl)
    URLBase?: string; // כתובת בסיס נוספת מה-XML לפתרון URL-ים יחסיים
    // שדות נוספים אפשריים מה-XML
    UPC?: string; // Universal Product Code

    macAddress?: string; // כתובת MAC של ההתקן, אם זמינה
}

// =======================================================================

/**
 * @hebrew מייצג תיאור התקן שבו פרטי ה-SCPD של שירותיו נטענו.
 * בשלב זה, `actionList` ו-`stateVariableList` של כל שירות מאוכלסים,
 * אך הפונקציות הדינמיות (`Action.invoke`, `StateVariable.query`) עדיין לא נוצרו.
 */
export interface DeviceWithServicesDescription extends DeviceDescription {
    // error ו-detailLevelAchieved כבר מוגדרים ב-BasicSsdpDevice

    /**
     * @hebrew רשימת השירותים של ההתקן, לאחר טעינת וניתוח פרטי ה-SCPD שלהם.
     * כל `ServiceDescription` ברשימה זו יכיל `actionList` ו-`stateVariableList`
     * עם הנתונים שפורסרו מה-SCPD, אך הפונקציות `invoke`/`query` בתוך
     * ה-`Action`ים וה-`StateVariable`ים יהיו `undefined`.
     */
    // השדות שהיו כאן זהים לאלו שב-DeviceDescription ולכן הוסרו בעקבות ההרחבה.
    // ההבדל העיקרי הוא בתיאור הסמנטי של serviceList.
    /**
     * @hebrew מפת השירותים של ההתקן, לאחר טעינת וניתוח פרטי ה-SCPD שלהם.
     * כל `ServiceDescription` במפה זו יכיל `actionList` ו-`stateVariableList`
     * עם הנתונים שפורסרו מה-SCPD, אך הפונקציות `invoke`/`query` בתוך
     * ה-`Action`ים וה-`StateVariable`ים יהיו `undefined`.
     */
    serviceList: Map<string, ServiceDescription>; // serviceList כבר מוגדר ב-DeviceDescription, אך כאן הוא צפוי להיות מאוכלס יותר.
}

/**
 * @hebrew מייצג תיאור התקן מלא, כולל שירותים עם פונקציונליות מלאה.
 * בשלב זה, הפונקציות `invoke` על `Action` ו-`query` על `StateVariable`
 * צפויות להיות מוגדרות וזמינות לשימוש.
 */
export interface FullDeviceDescription extends DeviceWithServicesDescription {
    // error ו-detailLevelAchieved כבר מוגדרים ב-BasicSsdpDevice

    /**
     * @hebrew רשימת השירותים של ההתקן, לאחר טעינת וניתוח פרטי ה-SCPD שלהם,
     * ועם פונקציות `invoke` ו-`query` מוגדרות וזמינות לשימוש.
     * בשונה מ-`DeviceWithServicesDescription`, כאן הפונקציות הללו צפויות להיות מאוכלסות.
     */
    // השדות שהיו כאן זהים לאלו שב-DeviceWithServicesDescription ולכן הוסרו בעקבות ההרחבה.
    // ההבדל העיקרי הוא בציפייה שהפונקציות invoke/query יהיו מאוכלסות.
    /**
     * @hebrew מפת השירותים של ההתקן, לאחר טעינת וניתוח פרטי ה-SCPD שלהם,
     * ועם פונקציות `invoke` ו-`query` מוגדרות וזמינות לשימוש.
     * בשונה מ-`DeviceWithServicesDescription`, כאן הפונקציות הללו צפויות להיות מאוכלסות.
     */
    serviceList: Map<string, ServiceDescription>; // serviceList כבר מוגדר, אך כאן הוא צפוי להיות מאוכלס במלואו.
}

// =======================================================================
// Types for ContentDirectoryService
// =======================================================================

/**
 * @enum BrowseFlag
 * @description דגלים עבור פעולת Browse של ContentDirectory.
 * @hebrew דגלים עבור פעולת Browse של ContentDirectory.
 */
export enum BrowseFlag {
    BrowseMetadata = "BrowseMetadata",
    BrowseDirectChildren = "BrowseDirectChildren"
}


export type ParsedProtocolInfo = {
    protocol: string;
    network: string;
    contentFormat: string;
    dlnaParameters: DlnaParameters;
};

export type DlnaParameters = {
    // כל הפרמטרים המקוריים בצורה גולמית (key=value)
    rawDlnaParams: Record<string, string>;

    // DLNA.ORG_OP — תיאור התמיכה בפעולות חיפוש:
    operation?: {
        // תמיכה בקפיצה לפי זמן (Time Seek) — מאפשר לקפוץ לנקודת זמן בסרטון
        timeSeekSupported: boolean;

        // תמיכה בטווחים (Range Seek) — מאפשר להוריד חלקים מהקובץ לפי טווח בייטים
        rangeSeekSupported: boolean;
    };

    // DLNA.ORG_CI — האם התוכן עבר המרה (Transcoded) או שהוא מקורי
    // ערך אפשרי: "Original — הזרמה בפורמט המקורי" או "Transcoded — הזרמה הומרה על ידי השרת"
    conversionIndication?: string;

    // DLNA.ORG_FLAGS — הגדרות נוספות (32 סיביות)
    flags?: {
        // הערך הגולמי של השדה (32 תווים, הקסדצימלי)
        raw: string;

        // השרת שולט בקצב השידור (Sender Paced)
        senderPaced: boolean;

        // תמיכה בתקן DLNA 1.5
        dlnaV1_5: boolean;

        // תמיכה בתכנים אינטראקטיביים (Interactive)
        interactive: boolean;

        // תמיכה ב־PlayContainer — הזרמת רשימות השמעה
        playContainer: boolean;

        // תמיכה בקפיצה לפי זמן (Time-Based Seek)
        timeBasedSeek: boolean;

        // תמיכה בקפיצה לפי מיקום בבייטים (Byte-Based Seek)
        byteBasedSeek: boolean;

        // סדר קבצים עולה (S0 Increasing) — סדר יציב של פריטים
        s0Increasing: boolean;
    };
};

/**
 * @interface Resource
 * @description מייצג משאב של פריט DIDL-Lite (למשל, קובץ מדיה).
 * @hebrew מייצג משאב של פריט DIDL-Lite (למשל, קובץ מדיה).
 */
export interface Resource {
    uri: string;
    protocolInfo?: string;
    parsedProtocolInfo?: ParsedProtocolInfo;
    size?: number;
    duration?: string;
    bitrate?: number;
    sampleFrequency?: number;
    bitsPerSample?: number;
    nrAudioChannels?: number;
    resolution?: string;
    colorDepth?: number;
    protection?: string;
    importUri?: string;
    dlnaManaged?: string; // e.g., "01", "10"
    additionalInfo?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any - לתכונות נוספות אפשריות
}

/**
 * @interface DidlLiteItemBase
 * @description ממשק בסיס לפריט DIDL-Lite (יכול להיות container או object).
 * @hebrew ממשק בסיס לפריט DIDL-Lite (יכול להיות container או object).
 */
export interface DidlLiteItemBase {
    id: string;
    parentId: string;
    title: string;
    class: string; // upnp:class
    restricted: boolean;
    writeStatus?: string; // upnp:writeStatus
    [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any - לתכונות נוספות אפשריות
}

/**
 * @interface DidlLiteContainer
 * @description מייצג קונטיינר (תיקייה) ב-DIDL-Lite.
 * @extends DidlLiteItemBase
 * @hebrew מייצג קונטיינר (תיקייה) ב-DIDL-Lite.
 */
export interface DidlLiteContainer extends DidlLiteItemBase {
    childCount?: number;
    searchable?: boolean;
    createClass?: string; // upnp:createClass
    searchClass?: string; // upnp:searchClass
}

/**
 * @interface DidlLiteObject
 * @description מייצג אובייקט (פריט מדיה) ב-DIDL-Lite.
 * @extends DidlLiteItemBase
 * @hebrew מייצג אובייקט (פריט מדיה) ב-DIDL-Lite.
 */
export interface DidlLiteObject extends DidlLiteItemBase {
    resources?: Resource[];
    albumArtURI?: string; // upnp:albumArtURI
    artist?: string; // dc:creator or upnp:artist
    album?: string; // upnp:album
    genre?: string; // upnp:genre
    date?: string; // dc:date
    originalTrackNumber?: number; // upnp:originalTrackNumber
    // ניתן להוסיף כאן עוד שדות ספציפיים לסוגי מדיה שונים
}

/**
 * @interface BrowseResult
 * @description מייצג את התוצאה של פעולת Browse או Search.
 * @hebrew מייצג את התוצאה של פעולת Browse או Search.
 */
export interface BrowseResult {
    items: (DidlLiteContainer | DidlLiteObject)[];
    numberReturned: number;
    totalMatches: number;
    updateID?: string;
    rawResponse?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}





/**
 * @interface SoapResponsePayload
 * @description מייצג את המטען (payload) של תגובת SOAP מוצלחת.
 */
export interface SoapResponsePayload {
    /**
     * @property {object} actionResponse - התוכן הספציפי של <actionNameResponse>.
     */
    actionResponse: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    /**
     * @property {object} raw - כל גוף תגובת ה-SOAP המנותח.
     */
    raw: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/**
 * @interface SoapFault
 * @description מייצג שגיאת SOAP.
 */
export interface SoapFault {
    /**
     * @property {string} faultCode - קוד השגיאה של SOAP.
     */
    faultCode: string;
    /**
     * @property {string} faultString - תיאור השגיאה של SOAP.
     */
    faultString: string;
    /**
     * @property {string} [detail] - פרטים נוספים על השגיאה.
     */
    detail?: string;
    /**
     * @property {number} [upnpErrorCode] - קוד שגיאה ספציפי ל-UPnP.
     */
    upnpErrorCode?: number;
    /**
     * @property {string} [upnpErrorDescription] - תיאור שגיאה ספציפי ל-UPnP.
     */
    upnpErrorDescription?: string;
}

/**
 * @interface SoapResponse
 * @description מייצג את התגובה המלאה מבקשת SOAP, יכולה להיות הצלחה או שגיאה.
 */
export interface SoapResponse {
    /**
     * @property {boolean} success - האם הבקשה הצליחה.
     */
    success: boolean;
    /**
     * @property {SoapResponsePayload} [data] - המטען של התגובה אם הבקשה הצליחה.
     */
    data?: SoapResponsePayload;
    /**
     * @property {SoapFault} [fault] - פרטי השגיאה אם הבקשה נכשלה.
     */
    fault?: SoapFault;
}

// =======================================================================
// UPnP Schema Constants and Builders (from upnpDiscoveryService.ts)
// =======================================================================

const UPNP_ORG_SCHEMA = "urn:schemas-upnp-org";
export const UPNP_ORG_SERVICE_SCHEMA = UPNP_ORG_SCHEMA + ":service";
export const UPNP_ORG_DEVICE_SCHEMA = UPNP_ORG_SCHEMA + ":device";

export function buildUpnpServiceTypeIdentifier(serviceType: string, version: number = 1): string {
    return `${UPNP_ORG_SERVICE_SCHEMA}:${serviceType}:${version}`;
}

export function buildUpnpDeviceTypeIdentifier(deviceType: string, version: number = 1): string {
    return `${UPNP_ORG_DEVICE_SCHEMA}:${deviceType}:${version}`;
}

export const AVTRANSPORT_SERVICE = buildUpnpServiceTypeIdentifier("AVTransport", 1);
export const CONTENT_DIRECTORY_SERVICE = buildUpnpServiceTypeIdentifier("ContentDirectory", 1);
export const CONNECTION_MANAGER_SERVICE = buildUpnpServiceTypeIdentifier("ConnectionManager", 1);
export const RENDERING_CONTROL_SERVICE = buildUpnpServiceTypeIdentifier("RenderingControl", 1);

export const MEDIA_SERVER_DEVICE = buildUpnpDeviceTypeIdentifier("MediaServer", 1);
export const MEDIA_RENDERER_DEVICE = buildUpnpDeviceTypeIdentifier("MediaRenderer", 1);


/**
 * @hebrew טיפוס מאוחד המייצג התקן בכל אחד משלבי העיבוד האפשריים שלו,
 * בהתאם לרמת הפירוט (`DiscoveryDetailLevel`) שנדרשה או הושגה.
 *
 * - אם `detailLevel` הוא 'basic', הטיפוס יהיה {@link BasicSsdpDevice}.
 * - אם `detailLevel` הוא 'description', הטיפוס יהיה {@link DeviceDescription}.
 * - אם `detailLevel` הוא 'services', הטיפוס יהיה {@link DeviceWithServicesDescription}.
 * - אם `detailLevel` הוא 'full', הטיפוס יהיה {@link FullDeviceDescription}.
 */
export type ProcessedDevice =
    | BasicSsdpDevice
    | DeviceDescription
    | DeviceWithServicesDescription
    | FullDeviceDescription;
// =======================================================================
// === טיפוסים עבור ActiveDeviceManager ===
// =======================================================================

/**
 * @hebrew מייצג התקן כפי שהוא מנוהל על ידי ה-ActiveDeviceManager.
 */
export interface ServerApiDevice extends FullDeviceDescription {
    /** @hebrew חותמת זמן של הפעם האחרונה שההתקן נראה (במילישניות מאז ה-epoch). */
    lastSeen: number;
    /** @hebrew חותמת זמן של מתי ההתקן יפוג תוקף ויסולק (במילישניות מאז ה-epoch). */
    expiresAt: number;
    /** @hebrew רמת הפירוט שהושגה בפועל עבור התקן זה. */
    detailLevelAchieved: DiscoveryDetailLevel;
    // כל המידע מ-FullDeviceDescription כבר כלול בזכות ההרחבה.
}

export type ApiDevice = ServerApiDevice;

/**
 * @hebrew אפשרויות עבור ה-ActiveDeviceManager.
 */
export interface ActiveDeviceManagerOptions {
    /**
     * @hebrew ה-ST (Service Type) לחיפוש.
     * @default "ssdp:all"
     */
    searchTarget?: string;
    /**
     * @hebrew מרווח הזמן (במילישניות) בין שליחות הודעות M-SEARCH.
     * @default 10000 (10 שניות)
     */
    mSearchIntervalMs?: number;
    /**
     * @hebrew מרווח הזמן (במילישניות) לבדיקה וניקוי התקנים שפג תוקפם.
     * @default 60000 (דקה)
     */
    deviceCleanupIntervalMs?: number;
    /**
     * @hebrew האם לכלול ממשקי IPv6 בתהליך הגילוי.
     * @default false
     */
    includeIPv6?: boolean;
    /**
     * @hebrew רמת הפירוט הרצויה עבור כל התקן שיימצא.
     * @default 'full'
     */
    detailLevel?: DiscoveryDetailLevel;
    /**
     * @hebrew (אופציונלי) פונקציית קולבק שתופעל עבור כל הודעת SSDP גולמית המתקבלת.
     * @param msg - ההודעה הגולמית.
     * @param rinfo - מידע על השולח.
     */
    onRawSsdpMessage?: RawSsdpMessageHandler;
    /**
     * @hebrew רשימת שמות של ממשקי רשת ספציפיים לשימוש (למשל, ['eth0', 'wlan0']).
     * אם לא יסופק, ישתמש בכל הממשקים הזמינים.
     */
    networkInterfaces?: string[];
}