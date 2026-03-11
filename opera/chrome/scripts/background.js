/*
  Copyright 2015– Rocketship <https://rocketshipapps.com/>.

  This program is free software: you can redistribute it and/or modify it under the terms of the GNU
  General Public License as published by the Free Software Foundation, either version 3 of the
  License, or (at your option) any later version.
*/
importScripts('utils.js', 'blocking.js');

const build = 11;
const path = isInOpera ? 'chrome/' : '';
const hosts = {};
const wereAdsFound = {};
const actionApi = chrome.action || chrome.browserAction;
const defaults = {
  allowlist: {},
  build,
  firstBuild: build,
  wasGrantButtonPressed: false
};
let state = { ...defaults };

const getFromStorage = (keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve));
const setInStorage = (items) => new Promise((resolve) => chrome.storage.local.set(items, resolve));

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

const initialize = async () => {
  const stored = await getFromStorage(['allowlist', 'build', 'firstBuild', 'wasGrantButtonPressed']);
  state = { ...defaults, ...stored };

  if (!stored.build) {
    chrome.tabs.create({ url: `${path}markup/firstrun.html` });
    await setInStorage({ build, firstBuild: build });
  } else if (stored.build < build) {
    await setInStorage({ build });
  }

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
  if (info.menuItemId !== 'adblockfast-toggle-element') return;
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

  if (message.wereAdsFound && tab) {
    wereAdsFound[tab.id] = true;
    syncTabIcon(tab.id, tab.url);
  }

  sendResponse({});
});

actionApi.onClicked.addListener((tab) => {
  toggleAllowlistForTab(tab);
});

initialize();
