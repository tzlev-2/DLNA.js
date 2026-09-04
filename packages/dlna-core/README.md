[English](./README.md) | [עברית](./README.he.md)

---
# DLNA.js

A simple and easy-to-use JavaScript/TypeScript library for interacting with DLNA (Digital Living Network Alliance) and UPnP (Universal Plug and Play) devices on a local network.

This package provides tools for discovering DLNA devices, browsing their content, and basic control over media playback. It is intended for developers who want to integrate DLNA capabilities into their Node.js applications.

> **Early release:** This library is in early development. The API may change between versions.

## Features

*   Discover DLNA/UPnP devices on the network (Media Servers, Media Renderers, etc.).
*   Browse the folders and files of Media Servers.
*   Get detailed metadata for media items.
*   Send basic commands to Media Renderers (e.g., Play, Pause, Stop, SetVolume).
*   Invoke DLNA methods.
*   Low-level access for sending any SOAP command to any UPnP service.

## Installation

The project has been tested with `Bun.js` only. Everything should work correctly with `Node.js` but it has not been thoroughly tested.

```bash
npm install dlna.js
# or
yarn add dlna.js
# or
bun add dlna.js
```

## API Documentation

### 1. Device Discovery

Device discovery can be done in two ways, depending on your needs. The core mechanism is the `ActiveDeviceManager`, which provides continuous, event-based discovery. For simpler, one-off searches, the `discoverSsdpDevicesIterable` function provides a convenient wrapper.

#### `ActiveDeviceManager` (Event-Based, Continuous Discovery)

This class is the primary tool for device discovery. It runs in the background, actively searches for devices, and manages a list of available devices.

**When to use it?**
Use `ActiveDeviceManager` for long-running applications that need to continuously monitor the network, such as servers or persistent desktop applications.

**`new ActiveDeviceManager(options)`**

The constructor accepts an `options` object to customize its behavior:

*   `searchTarget` (string, optional): The type of devices to search for. Defaults to `"ssdp:all"`.
*   `detailLevel` (string, optional): The level of detail to fetch (`'basic'`, `'description'`, `'services'`, `'full'`). Defaults to `'basic'`.
*   `mSearchIntervalMs` (number, optional): How often (in ms) to send a new M-SEARCH discovery request. Defaults to `10000`.
*   `deviceCleanupIntervalMs` (number, optional): How often (in ms) to check for and remove unresponsive devices. Defaults to `30000`.
*   `includeIPv6` (boolean, optional): Whether to also use IPv6 for discovery. Defaults to `false`.
*   `onRawSsdpMessage` (function, optional): A callback function that receives the raw SSDP message buffer and remote info before processing.
*   `networkInterfaces` (string[] | object, optional): Allows restricting discovery to specific network interfaces.

**Events:**

*   `'devicefound' (udn: string, device: ApiDevice)`: Emitted when a new device is discovered and fully processed.
*   `'deviceupdated' (udn: string, device: ApiDevice)`: Emitted when an existing device sends a "heartbeat" or its details are updated.
*   `'devicelost' (udn: string, device: ApiDevice)`: Emitted when a device leaves the network or times out.
*   `'error' (error: Error)`: Emitted on a critical discovery error.

**Main Methods:**

*   `start()`: Starts the discovery process.
*   `stop()`: Stops the discovery process.
*   `getActiveDevices()`: Returns a `Map` of all currently active devices.

**Example:**

```typescript
import { ActiveDeviceManager } from 'dlna.js';
import type { ApiDevice } from 'dlna.js';

// 1. Create an instance of the manager with detailed options.
const deviceManager = new ActiveDeviceManager({
  // searchTarget: The type of devices to search for.
  // Defaults to 'ssdp:all'.
  searchTarget: 'urn:schemas-upnp-org:device:MediaServer:1',

  // detailLevel: The level of detail to fetch for each device.
  // Can be 'basic', 'description', 'services', or 'full'.
  // Defaults to 'basic'.
  detailLevel: 'full',

  // mSearchIntervalMs: How often (in ms) to send a new discovery request.
  // Defaults to 10000 (10 seconds).
  mSearchIntervalMs: 15000,

  // deviceCleanupIntervalMs: How often (in ms) to check for unresponsive devices.
  // Defaults to 30000 (30 seconds).
  deviceCleanupIntervalMs: 35000,

  // includeIPv6: Whether to also use IPv6 for discovery.
  // Defaults to false.
  includeIPv6: false,
});

// 2. Listen for events.
// 'devicefound' is emitted when a new device is discovered and processed.
deviceManager.on('devicefound', (udn: string, device: ApiDevice) => {
  console.log(`[+] Device Found: ${device.friendlyName}`);
  // You can now interact with the 'device' object, e.g., browse its content.
});

// 'devicelost' is emitted when a device leaves the network or times out.
deviceManager.on('devicelost', (udn: string, device: ApiDevice) => {
  console.log(`[-] Device Lost: ${device.friendlyName}`);
});

// 'error' is emitted if a critical error occurs.
deviceManager.on('error', (err: Error) => {
  console.error('!! A critical error occurred in the device manager:', err);
});

// 3. Start the discovery process.
async function runApp() {
  // The start() method begins the discovery process.
  console.log('Starting continuous device discovery...');
  await deviceManager.start();
  console.log('Manager is running. Listening for devices...');

  // Example of using getActiveDevices() to periodically list devices.
  setInterval(() => {
    const activeDevices = deviceManager.getActiveDevices();
    console.log(`\n--- Currently Active Devices: ${activeDevices.size} ---`);
    activeDevices.forEach(device => {
      console.log(`  - ${device.friendlyName} (UDN: ${device.UDN})`);
    });
    console.log('--------------------------------------\n');
  }, 30000); // List devices every 30 seconds

  // The stop() method gracefully stops the discovery.
  // We'll call it when the user presses Ctrl+C.
  process.on('SIGINT', async () => {
    console.log('\nGracefully stopping device manager...');
    await deviceManager.stop();
    console.log('Manager stopped.');
    process.exit(0);
  });
}

runApp();
```

#### `discoverSsdpDevicesIterable` (Async Iterable, One-off Search)

This function is a convenient wrapper around `ActiveDeviceManager` for performing a single, time-limited search. It returns an `AsyncIterable`, which allows you to easily process devices in a `for await...of` loop.

**When to use it?**
Use this for simple cases where you just need to get a list of devices currently on the network without continuous monitoring.

**Parameters (`options`):**

*   `timeoutMs` (number, optional): How long the discovery will run. Defaults to `5000`.
*   `searchTarget` (string, optional): The type of devices to search for. Defaults to `"ssdp:all"`.
*   `detailLevel` (string, optional): The level of detail to fetch for each device (`'basic'`, `'description'`, `'services'`, `'full'`). Defaults to `'full'`.
*   `abortSignal` (AbortSignal, optional): Allows canceling the discovery process.

**Example:**

```typescript
import { discoverSsdpDevicesIterable } from 'dlna.js';

async function findMediaServers() {
  console.log('Searching for Media Servers...');
  try {
    const options = {
      searchTarget: 'urn:schemas-upnp-org:device:MediaServer:1',
      timeoutMs: 10000,
    };
    for await (const device of discoverSsdpDevicesIterable(options)) {
      console.log(`Found: ${device.friendlyName} at ${device.baseURL}`);
    }
    console.log('Search finished.');
  } catch (error) {
    console.error('An error occurred during discovery:', error);
  }
}

findMediaServers();
```

### 2. Interacting with Device Services

When you discover a device with `detailLevel: 'full'`, the library automatically parses the device's services and attaches a convenient `invoke` method to each available action. This allows for direct interaction with the device's capabilities.

**Accessing Services and Actions**

1.  **Get the service:** Use `device.serviceList.get(serviceName)` where `serviceName` is the short service key (e.g., `'AVTransport'`, `'ContentDirectory'`).
2.  **Get the action:** Use the `service.actionList.get(actionName)` method to get a specific action.
3.  **Invoke the action:** Call the `action.invoke(args)` method with the required arguments.

**Example: Controlling a Media Renderer (Play, Pause, Stop)**

```typescript
import { ActiveDeviceManager, createSingleItemDidlLiteXml } from 'dlna.js';
import type { ApiDevice } from 'dlna.js';

const deviceManager = new ActiveDeviceManager({
  searchTarget: 'urn:schemas-upnp-org:device:MediaRenderer:1',
  detailLevel: 'full' // 'full' is required to get invokable actions
});

deviceManager.on('devicefound', async (udn: string, device: ApiDevice) => {
  console.log(`Found a Media Renderer: ${device.friendlyName}`);

  // Get the AVTransport service
  const avTransport = device.serviceList.get('AVTransport');
  if (!avTransport || !avTransport.actionList) {
    console.error('This renderer does not have a usable AVTransport service.');
    return;
  }

  try {
    // Get the actions from the service's actionList
    const setUriAction = avTransport.actionList.get('SetAVTransportURI');
    const playAction = avTransport.actionList.get('Play');
    const pauseAction = avTransport.actionList.get('Pause');
    const stopAction = avTransport.actionList.get('Stop');

    if (!setUriAction || !playAction || !pauseAction || !stopAction) {
      console.error('One or more required actions (SetAVTransportURI, Play, Pause, Stop) are missing.');
      return;
    }

    const mediaUrl = 'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
    const instanceId = { InstanceID: 0 };

    // 1. Set the media URL to play, including DIDL-Lite metadata
    console.log('Setting media URL with metadata...');

    // Create metadata for the item we want to play
    const item = {
      id: 'video-item-1',
      parentId: '0', // Or the actual parent ID if known
      title: 'Big Buck Bunny',
      class: 'object.item.videoItem', // Standard UPnP class for a video
      restricted: false,
    };
    const resource = {
      uri: mediaUrl,
      protocolInfo: 'http-get:*:video/mp4:*', // Protocol info for the media
    };
    const didlXml = createSingleItemDidlLiteXml(item, resource);

    await setUriAction.invoke({
      ...instanceId,
      CurrentURI: mediaUrl,
      CurrentURIMetaData: didlXml
    });

    // 2. Send the Play command
    console.log('Sending Play command...');
    await playAction.invoke({ ...instanceId, Speed: '1' });

    // 3. Wait for a bit, then pause
    setTimeout(async () => {
      console.log('Sending Pause command...');
      await pauseAction.invoke(instanceId);
    }, 10000); // Pause after 10 seconds

  } catch (error) {
    console.error(`Error controlling device ${device.friendlyName}:`, error);
  }
});

deviceManager.start();
```

### 3. Browsing Content

Once you have discovered a Media Server (either via `discoverSsdpDevicesIterable` or `ActiveDeviceManager`), you can use the `ContentDirectoryService` class to browse its content.

**`ContentDirectoryService`**

To create an instance, you need the service description object, which you get from the discovery process (when `detailLevel` is `'services'` or `'full'`).

**Main Methods:**

*   **`browse(objectId, browseFlag, ...)`**: The primary method for browsing content.
    *   `objectId` (string): The ID of the container (folder) you want to browse. Use `'0'` to start from the root directory.
    *   `browseFlag` (string): Determines what is returned.
        *   `'BrowseMetadata'`: Returns only the metadata for the `objectId` itself.
        *   `'BrowseDirectChildren'`: Returns the direct children of the `objectId` (the content of the folder).
    *   **Returns:** A `Promise<BrowseResult>` containing an array of `items`, `numberReturned`, and `totalMatches`.

*   **`search(containerId, searchCriteria, ...)`**: Allows performing an advanced search within a container.

**Example:**

```typescript
import { discoverSsdpDevicesIterable, ContentDirectoryService } from 'dlna.js';
import type { DeviceDescription } from 'dlna.js';

// Assuming 'device' is a discovered Media Server device object
async function browseAndSearchContent(device: DeviceDescription) {
  const cdsServiceInfo = device.serviceList.get('ContentDirectory');
  if (!cdsServiceInfo) {
      console.error('ContentDirectory service not found on this device.');
      return;
  }

  const cds = new ContentDirectoryService(cdsServiceInfo);

  try {
    // Example for browse()
    console.log('Browsing root directory...');
    const browseResult = await cds.browse('0', 'BrowseDirectChildren');
    console.log(`Found ${browseResult.totalMatches} items in root.`);
    for (const item of browseResult.items) {
      console.log(`  - ${item.isContainer ? '[Folder]' : '[File]'} ${item.title}`);
    }

    // Example for search()
    // This searches for all items with "Vacation" in their title.
    console.log('\nSearching for items with "Vacation" in the title...');
    const searchCriteria = 'dc:title contains "Vacation"';
    const searchResult = await cds.search('0', searchCriteria); // '0' means search the whole library
    console.log(`Found ${searchResult.totalMatches} items matching the search.`);
    for (const item of searchResult.items) {
      console.log(`  - [Found] ${item.title}`);
    }

  } catch (error) {
    console.error('Error interacting with ContentDirectory service:', error);
  }
}
```

### 4. Sending Low-Level Commands

For advanced control or to interact with services not explicitly wrapped by this library, you can use the `sendUpnpCommand` function.

**`sendUpnpCommand(controlURL, serviceType, actionName, args)`**

This function builds, sends, and parses a generic SOAP request.

**Parameters:**

*   `controlURL` (string): The control URL of the service.
*   `serviceType` (string): The URN of the service (e.g., `"urn:schemas-upnp-org:service:AVTransport:1"`).
*   `actionName` (string): The exact name of the action to perform (e.g., `"Play"`, `"Pause"`).
*   `args` (object, optional): An object containing the arguments for the action.

**Returns:** A `Promise<Record<string, any>>` that resolves with the output values of the action.

**Example (Sending a `Play` command):**

```typescript
import { sendUpnpCommand } from 'dlna.js';
import type { DeviceDescription } from 'dlna.js';

// Assuming 'rendererDevice' is a discovered Media Renderer
// and 'mediaUrl' is the URL of the media to play
async function playMedia(rendererDevice: DeviceDescription, mediaUrl: string) {
  const avtService = rendererDevice.serviceList.get('AVTransport');
  if (!avtService) {
    console.error('AVTransport service not found.');
    return;
  }

  const { controlURL, serviceType } = avtService;

  try {
    // Step 1: Set the media URL
    await sendUpnpCommand(controlURL, serviceType, 'SetAVTransportURI', {
      InstanceID: 0,
      CurrentURI: mediaUrl,
      CurrentURIMetaData: '' // DIDL-Lite XML can go here
    });
    console.log('Media URL set successfully.');

    // Step 2: Send the Play command
    await sendUpnpCommand(controlURL, serviceType, 'Play', {
      InstanceID: 0,
      Speed: '1'
    });
    console.log('Play command sent!');

  } catch (error) {
    console.error('Error sending command:', error.message);
    if (error.soapFault) {
      console.error('  -> SOAP Fault details:', error.soapFault);
    }
  }
}
```

## 5. Advanced Usage / Utilities

### `createSingleItemDidlLiteXml(item, resource)`

This utility function creates a DIDL-Lite XML string for a single media item. This is primarily useful when you need to provide metadata to a Media Renderer using the `SetAVTransportURI` action. The `CurrentURIMetaData` parameter of that action accepts this XML format.

```typescript
import { createSingleItemDidlLiteXml } from 'dlna.js';

const item = {
  id: 'my-video-1',
  parentId: '0',
  title: 'My Awesome Vacation Video',
  class: 'object.item.videoItem',
  restricted: false,
};

const resource = {
  uri: 'http://192.168.1.100:8080/stream/my-video.mp4',
  protocolInfo: 'http-get:*:video/mp4:*',
  duration: '00:15:30.000', // HH:MM:SS.mmm
  size: 123456789, // in bytes
};

const didlXml = createSingleItemDidlLiteXml(item, resource);
// Now you can pass didlXml to the SetAVTransportURI command.
```

### `processUpnpDevice(basicDevice, detailLevel, abortSignal?)` and `processUpnpDeviceFromUrl(locationUrl, detailLevel, abortSignal?)`

These are lower-level functions used internally by the discovery process to fetch and parse the full details of a device. You would typically not need to call them directly.

*   **`processUpnpDevice`**: Takes a `BasicSsdpDevice` object (from an initial discovery) and enriches it with full details according to the specified `detailLevel` (`DiscoveryDetailLevel` enum).
*   **`processUpnpDeviceFromUrl`**: Does the same, but starts from just the device's XML location URL.

**When to use them?**
If you have a device's basic information or URL from another source and want to get its full capabilities using this library's processing logic.

**Example:**
```typescript
import { processUpnpDeviceFromUrl, DiscoveryDetailLevel } from 'dlna.js';

async function getDeviceDetails(url: string) {
  console.log(`Fetching full details for device at: ${url}`);
  try {
    const device = await processUpnpDeviceFromUrl(url, DiscoveryDetailLevel.Full);
    if (device) {
      console.log(`Successfully processed: ${device.friendlyName}`);
      // You can now access all device properties, services, and actions
      const avTransport = device.serviceList?.get('AVTransport');
      if (avTransport) {
        console.log('AVTransport service is available.');
      }
    } else {
      console.log('Could not process device details.');
    }
  } catch (error) {
    console.error('Error processing device from URL:', error);
  }
}

// Replace with a real device description URL from your network
const deviceXmlUrl = 'http://192.168.1.1:12345/device.xml';
getDeviceDetails(deviceXmlUrl);
```

## Bugs

I don't know if I'll be able to handle bugs, if any are found.
But we can try...

## Acknowledgment Request

If you use DLNA.js in your project, a credit with a link to the [GitHub repository](https://github.com/MusiCode1/DLNA.js) in your project's "About" page or documentation would be greatly appreciated.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.