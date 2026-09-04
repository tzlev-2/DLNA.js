// קובץ: examples/play_on_renderer_example.ts
// סקריפט זה מדגים הערת התקן רינדור, גישה לשרת מדיה,
// דפדוף בתיקייה והשמעת קבצים מהשרת על גבי הרינדור.

import express from 'express'; // הוספת ייבוא ל-Express
import { URL } from 'node:url';
import { sendWakeOnLan, checkPingWithRetries } from 'wake-on-lan'; // ייבוא מהחבילה החדשה עם שמות נכונים
import {
    processUpnpDeviceFromUrl,
    createLogger, // שם הפונקציה עודכן
    setLogger,
    DiscoveryDetailLevel,
    BrowseFlag,
    ContentDirectoryService,
    createSingleItemDidlLiteXml, // ייבוא הפונקציה החדשה
    // טיפוסים
    type FullDeviceDescription,
    type ServiceDescription,
    type Action,
    type DidlLiteObject,
    type DidlLiteContainer,
    type Resource,
} from 'dlna.js';
setLogger(console);

const logger = createLogger('PlayOnRendererExample'); // שימוש ב-createLogger


const settingsList = {
    myHome:
    {
        mediaServer: {
            docUrl: 'http://10.100.102.106:7879/rootDesc.xml',
            directoryID: '%2F%D7%9E%D7%90%D7%A9%D7%94+%D7%95%D7%94%D7%93%D7%95%D7%91'
        },
        mediaRender: {
            docUrl: 'http://10.100.102.106:1473/',
            macAddress: 'AC:5A:F0:E5:8C:25'
        }
    },

    moishy: {
        mediaServer: {
            docUrl: 'http://192.168.1.102:7879/rootDesc.xml',
            directoryID: '%2F%D7%A1%D7%A8%D7%98%D7%95%D7%A0%D7' +
                '%99+%D7%96%D7%9E%D7%9F+%D7%A4%D7%A0%D7%90%D7%' +
                '99%2F%D7%9E%D7%90%D7%A9%D7%94+%D7%95%D7%94%D7%93%D7%95%D7%91'
        },
        mediaRender: {
            docUrl: 'http://192.168.1.41:1216/',
            macAddress: 'AC:5A:F0:E5:8C:25',
            wakeOnLanAddress: '192.168.1.255'
        }
    },
};

const settings = settingsList.moishy;

// --- הגדרות קבועות ---
const MEDIA_SERVER_URL = settings.mediaServer.docUrl;
const RENDERER_DEVICE_XML_URL = settings.mediaRender.docUrl; // לפי אישור המשתמש, זו כתובת ה-XML
const RENDERER_MAC_ADDRESS = settings.mediaRender.macAddress;
const RENDERER_IP_ADDRESS = (new URL(settings.mediaRender.docUrl)).hostname; // נגזר מה-URL של הרינדור
const TARGET_BROWSE_DIRECTORY_ID = settings.mediaServer.directoryID; // התיקייה הראשית בשרת המדיה
const WAKE_ON_LAN_ADDRESS = settings.mediaRender.wakeOnLanAddress;

// --- פונקציות עזר ---

/**
 * מוצא שירות ספציפי מתוך התקן שעבר עיבוד מלא.
 * @param device - התקן שעבר עיבוד מלא.
 * @param serviceTypeOrId - סוג השירות (למשל, "urn:schemas-upnp-org:service:ContentDirectory:1") או ID השירות.
 * @returns השירות שנמצא, או undefined אם לא נמצא.
 */
function findService(
    device: FullDeviceDescription,
    serviceTypeOrId: string
): ServiceDescription | undefined {
    if (!device.serviceList) {
        logger.warn(`Device ${device.friendlyName} has no service list.`);
        return undefined;
    }
    return Array.from(device.serviceList.values()).find( // המרה ל-Array והוספת טיפוס
        (s: ServiceDescription) => s.serviceType === serviceTypeOrId || s.serviceId === serviceTypeOrId
    );
}

/**
 * מוצא פעולה ספציפית מתוך שירות.
 * @param service - השירות.
 * @param actionName - שם הפעולה.
 * @returns הפעולה שנמצאה, או undefined אם לא נמצאה.
 */
function findAction(
    service: ServiceDescription,
    actionName: string
): Action | undefined {
    if (!service.actionList) {
        logger.warn(`Service ${service.serviceId} has no action list.`);
        return undefined;
    }
    return Array.from(service.actionList.values()).find((a: Action) => a.name === actionName); // המרה ל-Array והוספת טיפוס
}

// --- פונקציה ראשית ---
async function main() {
    logger.info('Starting play on renderer example script...');

    // שלב 1: הערת התקן הרינדור והמתנה להתעוררותו
    logger.info(`Attempting to wake renderer device ${RENDERER_IP_ADDRESS} (MAC: ${RENDERER_MAC_ADDRESS})...`);
    try {
        // שלב 1.1: שליחת חבילת Wake on LAN
        await sendWakeOnLan(
            RENDERER_MAC_ADDRESS,
            WAKE_ON_LAN_ADDRESS, // broadcast address
            9 // wol port
        );
        logger.info(`Wake-on-LAN packet sent to ${RENDERER_MAC_ADDRESS} via ${WAKE_ON_LAN_ADDRESS}:${9}.`);

        // שלב 1.2: בדיקת זמינות ההתקן באמצעות פינג
        logger.info(`Waiting for renderer ${RENDERER_IP_ADDRESS} to become available...`);
        const isAwake = await checkPingWithRetries( // שימוש ב-checkPingWithRetries
            RENDERER_IP_ADDRESS,
            90 * 1000, // ping total timeout ms (מותאם להתקנים שלוקח להם זמן לעלות)
            3 * 1000,  // ping interval ms
            5 * 1000   // ping single timeout ms
        );

        if (isAwake) {
            logger.info(`Renderer device ${RENDERER_IP_ADDRESS} is awake and responsive.`);
        } else {
            logger.error(`Renderer device ${RENDERER_IP_ADDRESS} did not respond to pings after WoL. Aborting script.`);
            return;
        }
    } catch (error) {
        logger.error(`Failed to wake or verify renderer device ${RENDERER_IP_ADDRESS}. Aborting script.`, error);
        return;
    }

    // שלב 2: עיבוד התקן שרת המדיה
    logger.info(`Processing media server at ${MEDIA_SERVER_URL}...`);
    let mediaServerDevice: FullDeviceDescription | null = null;
    try {
        const processedServer = await processUpnpDeviceFromUrl(
            MEDIA_SERVER_URL,
            DiscoveryDetailLevel.Full
        );
        if (processedServer && processedServer.detailLevelAchieved === DiscoveryDetailLevel.Full) {
            mediaServerDevice = processedServer as FullDeviceDescription;
            logger.info(`Successfully processed media server: ${mediaServerDevice.friendlyName}`);
        } else {
            logger.error('Failed to fully process media server or detail level was not Full.');
            if (processedServer && processedServer.error) {
                logger.error(`Server processing error: ${processedServer.error}`);
            }
            return;
        }
    } catch (error) {
        logger.error(`Error processing media server at ${MEDIA_SERVER_URL}. Aborting script.`, error);
        return;
    }

    // שלב 3: עיבוד התקן הרינדור
    logger.info(`Processing renderer device at ${RENDERER_DEVICE_XML_URL}...`);
    let rendererDevice: FullDeviceDescription | null = null;
    try {
        const processedRenderer = await processUpnpDeviceFromUrl(
            RENDERER_DEVICE_XML_URL,
            DiscoveryDetailLevel.Full
        );
        if (processedRenderer && processedRenderer.detailLevelAchieved === DiscoveryDetailLevel.Full) {
            rendererDevice = processedRenderer as FullDeviceDescription;
            logger.info(`Successfully processed renderer device: ${rendererDevice.friendlyName}`);
        } else {
            logger.error('Failed to fully process renderer device or detail level was not Full.');
            if (processedRenderer && processedRenderer.error) {
                logger.error(`Renderer processing error: ${processedRenderer.error}`);
            }
            return;
        }
    } catch (error) {
        logger.error(`Error processing renderer device at ${RENDERER_DEVICE_XML_URL}. Aborting script.`, error);
        return;
    }

    // שלב 4: דפדוף בתיקייה בשרת המדיה
    logger.info(`Browsing directory ID "${TARGET_BROWSE_DIRECTORY_ID}" on media server "${mediaServerDevice.friendlyName}"...`);
    const cdsServiceInfo = findService(mediaServerDevice, 'urn:schemas-upnp-org:service:ContentDirectory:1');
    if (!cdsServiceInfo) {
        logger.error(`ContentDirectory service not found on media server ${mediaServerDevice.friendlyName}. Aborting.`);
        return;
    }

    let mediaItems: DidlLiteObject[] = [];
    try {
        // יצירת מופע של ContentDirectoryService
        const cds = new ContentDirectoryService(cdsServiceInfo);

        logger.debug(`Attempting to browse directory ID "${TARGET_BROWSE_DIRECTORY_ID}" using ContentDirectoryService.`);
        const browseResult = await cds.browse(
            TARGET_BROWSE_DIRECTORY_ID,
            BrowseFlag.BrowseDirectChildren,
            '*', // Filter
            0,   // StartingIndex
            0,   // RequestedCount (0 for all)
            ''   // SortCriteria
        );
        logger.debug('Browse action successful using ContentDirectoryService. Result:', browseResult);

        if (browseResult && browseResult.items) {
            mediaItems = browseResult.items.filter(
                (item: DidlLiteContainer | DidlLiteObject): item is DidlLiteObject =>
                    item.class.startsWith('object.item.audioItem') || item.class.startsWith('object.item.videoItem')
            );
        }

        if (mediaItems.length === 0) {
            logger.info(`No media items (audio/video) found in directory "${TARGET_BROWSE_DIRECTORY_ID}" or parsing failed.`);
        } else {
            logger.info(`Found ${mediaItems.length} media item(s) in directory "${TARGET_BROWSE_DIRECTORY_ID}".`);
        }

    } catch (error) {
        logger.error(`Error browsing ContentDirectory on ${mediaServerDevice.friendlyName} using ContentDirectoryService. Aborting.`, error);
        return;
    }

    // אם אין פריטים, אין טעם להמשיך לשלב הניגון.
    if (mediaItems.length === 0) {
        logger.info('No media items to play. Exiting playback stage.');
        // אפשר לסיים את הסקריפט כאן אם רוצים
        // logger.info('Play on renderer example script finished (no items to play).');
        // return;
        // נמשיך כדי להדגים את שאר הלוגיקה, אך היא לא תעשה כלום
    }

    // שלב 5: השמעת הקבצים על הרינדור
    logger.info(`Preparing to play media on renderer "${rendererDevice.friendlyName}"...`);
    const avTransportService = findService(rendererDevice, 'urn:schemas-upnp-org:service:AVTransport:1');
    if (!avTransportService) {
        logger.error(`AVTransport service not found on renderer ${rendererDevice.friendlyName}. Aborting.`);
        return;
    }

    const setAvTransportUriAction = findAction(avTransportService, 'SetAVTransportURI');
    const setNextAvTransportUriAction = findAction(avTransportService, 'SetNextAVTransportURI');
    const playAction = findAction(avTransportService, 'Play');

    if (!setAvTransportUriAction || !setAvTransportUriAction.invoke) {
        logger.error(`SetAVTransportURI action not found or not invokable on AVTransport service of ${rendererDevice.friendlyName}. Aborting.`);
        return;
    }
    if (!playAction || !playAction.invoke) {
        logger.error(`Play action not found or not invokable on AVTransport service of ${rendererDevice.friendlyName}. Aborting.`);
        return;
    }
    if (!setNextAvTransportUriAction || !setNextAvTransportUriAction.invoke) {
        logger.warn(`SetNextAVTransportURI action not found or not invokable on AVTransport service of ${rendererDevice.friendlyName}. Will only play the first item.`);
        // אין צורך לבטל, פשוט נגן רק את הפריט הראשון
    }

    for (let i = 0; i < mediaItems.length; i++) {
        const item = mediaItems[i];
        if (!item.resources || item.resources.length === 0) {
            logger.warn(`Media item "${item.title}" (ID: ${item.id}) has no resources. Skipping.`);
            continue;
        }
        const resource = item.resources[0]; // בדרך כלל ניקח את המשאב הראשון
        const mediaUrl = resource.uri;

        try {
            if (i === 0) {
                // פריט ראשון: השתמש ב-SetAVTransportURI והפעל
                logger.info(`Setting current media: "${item.title}" (URL: ${mediaUrl}) on ${rendererDevice.friendlyName}`);
                const setUriArgs = {
                    InstanceID: 0,
                    CurrentURI: mediaUrl,
                    CurrentURIMetaData: createSingleItemDidlLiteXml(item, resource),
                };
                logger.debug('Invoking SetAVTransportURI with args:', setUriArgs);
                await setAvTransportUriAction.invoke(setUriArgs);
                logger.info(`SetAVTransportURI successful for "${item.title}".`);

                // המתנה קצרה לפני הפעלה
                await new Promise(resolve => setTimeout(resolve, 1000));

                logger.info(`Attempting to play: "${item.title}"`);
                const playArgs = {
                    InstanceID: 0,
                    Speed: '1',
                };
                logger.debug('Invoking Play with args:', playArgs);
                await playAction.invoke(playArgs);
                logger.info(`Play command sent for "${item.title}".`);
                logger.info(`Playback of "${item.title}" initiated. This example does not wait for completion.`);

            } else if (setNextAvTransportUriAction && setNextAvTransportUriAction.invoke) {
                // פריטים הבאים: השתמש ב-SetNextAVTransportURI
                logger.info(`Adding to queue: "${item.title}" (URL: ${mediaUrl}) on ${rendererDevice.friendlyName}`);
                const setNextUriArgs = {
                    InstanceID: 0,
                    NextURI: mediaUrl,
                    NextURIMetaData: createSingleItemDidlLiteXml(item, resource),
                };
                logger.debug('Invoking SetNextAVTransportURI with args:', setNextUriArgs);
                await setNextAvTransportUriAction.invoke(setNextUriArgs);
                logger.info(`SetNextAVTransportURI successful for "${item.title}". Item added to queue.`);
                // אין צורך לקרוא ל-Play שוב, הנגן אמור לעבור לפריט הבא אוטומטית
            } else {
                // אם אין SetNextAVTransportURI, לא ניתן להוסיף פריטים נוספים לתור
                logger.warn(`Cannot add "${item.title}" to queue as SetNextAVTransportURI is not available. Only the first item will be played.`);
                break; // צא מהלולאה כי אין טעם להמשיך
            }

            // המתנה בין פריטים (אופציונלי, אם רוצים שהוספה לתור לא תהיה מהירה מדי)
            // אם זה לא הפריט האחרון והוספנו לתור
            if (i < mediaItems.length - 1 && i > 0) {
                // logger.info('Waiting a bit before adding the next item to the queue...');
                // await new Promise(resolve => setTimeout(resolve, 500));
            } else if (i === 0 && mediaItems.length > 1) {
                // אם זה הפריט הראשון ויש עוד, אולי נרצה להמתין קצת לפני שמוסיפים את הבא
                // logger.info('Waiting a bit before adding the first item to the queue...');
                // await new Promise(resolve => setTimeout(resolve, 500));
            }


        } catch (error) {
            logger.error(`Error during playback/queuing of "${item.title}" (URL: ${mediaUrl}) on ${rendererDevice.friendlyName}.`, error);
        }
    }

    logger.info('Play on renderer example script finished.');
}

// --- פונקציית השרת ---
async function startExpressServer() {
    const app = express();
    const port = 8080;

    app.get('/play', async (req, res) => {
        logger.info('Webhook /play (GET) received, initiating main function...');
        try {
            // הפעלת main באופן אסינכרוני כדי לא לחסום את תגובת השרת
            main().catch(err => {
                logger.error('Error during main() execution triggered by webhook:', err);
                // כאן לא נשלח תגובת שגיאה ללקוח כי הבקשה המקורית כבר נענתה
            });
            res.status(200).send('Playback initiated via GET to /play. Check logs for details.');
        } catch (error) {
            logger.error('Failed to initiate main function from webhook:', error);
            res.status(500).send('Error initiating playback.');
        }
    });

    // טיפול בנתיבים לא קיימים (404)
    app.use((req, res) => {
        res.status(404).send("Sorry, can't find that!");
    });

    app.listen(port, () => {
        logger.info(`Express server listening on port ${port}, accessible at http://localhost:${port}/play`);
    });
}

// הרצת השרת אם הקובץ מורץ ישירות
if (require.main === module) {
    // main().catch(error => { // קריאה ישנה לפונקציה main
    //     logger.error("An unexpected error occurred in the main execution:", error);
    // });
    startExpressServer(); // קריאה לפונקציית השרת החדשה
}