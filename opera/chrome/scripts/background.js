/*
  Copyright 2015– Rocketship <https://rocketshipapps.com/>.

  This program is free software: you can redistribute it and/or modify it under the terms of the GNU
  General Public License as published by the Free Software Foundation, either version 3 of the
  License, or (at your option) any later version.
*/
importScripts('utils.js', 'blocking.js');

const build = 12;
const path = isInOpera ? 'chrome/' : '';
const hosts = {};
const wereAdsFound = {};
const actionApi = chrome.action || chrome.browserAction;
const LEGACY_ALLOWLIST_BUILD_7 = [
  'buy.buysellads.com',
  'gs.statcounter.com'
];
const LEGACY_ALLOWLIST_BUILD_9 = [
  'amplitude.com',
  'analytics.amplitude.com',
  'sumo.com',
  'www.cnet.com',
  'www.stitcher.com'
];
const defaults = {
  allowlist: {},
  build,
  firstBuild: build,
  uids: [],
  wasGrantButtonPressed: false,
  shouldDeletePersonalData: false
};
let state = { ...defaults };

const getFromStorage = (keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve));
const setInStorage = (items) => new Promise((resolve) => chrome.storage.local.set(items, resolve));
const removeFromStorage = (keys) => new Promise((resolve) => chrome.storage.local.remove(keys, resolve));

const getAllowlist = () => state.allowlist || {};
const setAllowlist = async (allowlist) => {
  state.allowlist = allowlist;
  await setInStorage({ allowlist });
};

const getIconPath = (type, size) => chrome.runtime.getURL(`${path}images/${type}/${size}.png`);

const setIcon = (tabId, type) => {
  chrome.tabs.get(tabId, () => {
    if (!chrome.runtime.lastError) {
      actionApi.setIcon({
        tabId,
        path: {
          '19': getIconPath(type, '19'),
          '38': getIconPath(type, '38')
        }
      });
    }
  });
};

const syncTabIcon = (tabId, url) => {
  const host = getHost(url);
  if (!host) return;

  const isAllowlisted = !!getAllowlist()[host];
  const foundAds = !!wereAdsFound[tabId];
  const icon = `${isAllowlisted ? 'un' : ''}blocked${foundAds ? '-ads' : ''}`;

  setIcon(tabId, icon);
  actionApi.setTitle({ tabId, title: isAllowlisted ? 'Block ads on this site' : 'Unblock ads on this site' });
};

const toggleAllowlistForTab = async (tab) => {
  const host = getHost(tab.url);
  if (!host) return;

  const allowlist = { ...getAllowlist() };
  if (allowlist[host]) {
    delete allowlist[host];
  } else {
    allowlist[host] = true;
  }

  await setAllowlist(allowlist);
  chrome.tabs.reload(tab.id);
};

const seedLegacyAllowlistEntries = (allowlist, previousBuild) => {
  const nextAllowlist = { ...allowlist };

  if (!previousBuild || previousBuild < 7) {
    LEGACY_ALLOWLIST_BUILD_7.forEach((host) => { nextAllowlist[host] = true; });
  }

  if (!previousBuild || previousBuild < 9) {
    LEGACY_ALLOWLIST_BUILD_9.forEach((host) => { nextAllowlist[host] = true; });
  }

  return nextAllowlist;
};

const maybeDeletePersonalData = async () => {
  if (!state.shouldDeletePersonalData) return;

  await new Promise((resolve) => {
    chrome.browsingData.remove({}, {
      appcache: true,
      cache: true,
      cacheStorage: true,
      cookies: true,
      downloads: true,
      fileSystems: true,
      history: true,
      indexedDB: true,
      localStorage: true,
      serviceWorkers: true,
      webSQL: true
    }, resolve);
  });

  state.shouldDeletePersonalData = false;
  await setInStorage({ shouldDeletePersonalData: false });
};

const initialize = async () => {
  const stored = await getFromStorage([
    'allowlist',
    'whitelist',
    'build',
    'firstBuild',
    'uids',
    'wasGrantButtonPressed',
    'shouldDeletePersonalData'
  ]);

  const previousBuild = stored.build;
  const migratedAllowlist = stored.allowlist || stored.whitelist || {};
  const allowlist = seedLegacyAllowlistEntries(migratedAllowlist, previousBuild);
  state = {
    ...defaults,
    ...stored,
    allowlist,
    build,
    firstBuild: stored.firstBuild || build,
    uids: stored.uids || []
  };

  await setInStorage({
    allowlist,
    build,
    firstBuild: state.firstBuild,
    uids: state.uids
  });
  await removeFromStorage([ 'whitelist' ]);

  if (!previousBuild) {
    chrome.tabs.create({ url: `${path}markup/firstrun.html` });
  }

  await maybeDeletePersonalData();

  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      hosts[tab.id] = getHost(tab.url);
      syncTabIcon(tab.id, tab.url);
    });
  });

  chrome.contextMenus.remove('adblockfast-toggle-element', () => {
    chrome.contextMenus.create({
      id: 'adblockfast-toggle-element',
      contexts: ['all'],
      title: 'Hide or unhide element'
    });
  });
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  Object.keys(changes).forEach((key) => {
    state[key] = changes[key].newValue;
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'adblockfast-toggle-element' || !tab) return;

  chrome.tabs.sendMessage(tab.id, { wasContextItemSelected: true }, (response) => {
    if (!response || !response.focusedSelector) return;

    const host = getHost(tab.url);
    chrome.storage.sync.get('blocklist', (items) => {
      const blocklist = items.blocklist || {};
      const hostBlocklist = blocklist[host] || [];
      const index = hostBlocklist.indexOf(response.focusedSelector);

      if (index >= 0) {
        hostBlocklist.splice(index, 1);
      } else {
        hostBlocklist.push(response.focusedSelector);
      }

      blocklist[host] = hostBlocklist;
      chrome.storage.sync.set({ blocklist });
    });
  });
});

chrome.webRequest.onBeforeRequest.addListener((details) => {
  const { tabId, url, type } = details;
  const childHost = getHost(url);
  const isParent = type === 'main_frame';

  if (isParent) {
    hosts[tabId] = childHost;
    return;
  }

  const parentHost = hosts[tabId];
  if (!(tabId + 1 && parentHost) || childHost === parentHost) return;

  for (let i = domainCount - 1; i >= 0; i--) {
    if (domains[i].test(childHost)) {
      wereAdsFound[tabId] = true;
      syncTabIcon(tabId, `https://${parentHost}`);
      break;
    }
  }
}, { urls: ['<all_urls>'] });

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;

  delete wereAdsFound[details.tabId];
  hosts[details.tabId] = getHost(details.url);
  syncTabIcon(details.tabId, details.url);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tab = sender.tab;

  if (message.shouldInit && tab) {
    const parentHost = getHost(tab.url);
    const isAllowlisted = !!getAllowlist()[parentHost];

    chrome.storage.sync.get('blocklist', (items) => {
      sendResponse({
        parentHost,
        userSelectors: (items.blocklist || {})[parentHost] || [],
        isAllowlisted,
        wasGrantButtonPressed: !!state.wasGrantButtonPressed
      });
    });

    return true;
  }

  if (message.shouldSaveUser) {
    sendResponse({});
    return false;
  }

  if (message.wereAdsFound && tab) {
    wereAdsFound[tab.id] = true;
    syncTabIcon(tab.id, tab.url);
  }

  sendResponse({});
  return false;
});

actionApi.onClicked.addListener((tab) => {
  toggleAllowlistForTab(tab);
});

chrome.notifications.onClicked.addListener(() => {
  chrome.tabs.create({ url: `${path}markup/experimental-tab.html` });
});

initialize();