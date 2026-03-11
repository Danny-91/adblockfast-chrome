/*
  Copyright 2015– Rocketship <https://rocketshipapps.com/>.

  This program is free software: you can redistribute it and/or modify it under the terms of the GNU
  General Public License as published by the Free Software Foundation, either version 3 of the
  License, or (at your option) any later version.
*/
const userAgent       = typeof navigator != 'undefined' ? navigator.userAgent : '';
const isInOpera       = userAgent.indexOf('OPR') + 1;
const browser         = isInOpera ? 'opera' : 'chrome';
const domain          = `${ browser }.adblockfast.com`;
const baseUrl         = `https://${ domain }/`;
const deserializeData = (data) => { return typeof data == 'string' ? JSON.parse(data) : data; };
const getHost         = (url) => {
  try {
    return (new URL(url)).host;
  } catch {
    return '';
  }
};
const injectPlausible = (path) => {
  if (typeof document == 'undefined') return;

  const script = document.createElement('script');
  script.src = `${ path }plausible.js`;
  script.setAttribute('data-api', 'https://plausible.adblockfast.com/api/event');
  script.setAttribute('data-domain', domain);
  document.body.prepend(script);
};
const onPageReady     = (callback) => {
  if (typeof document == 'undefined' || document.readyState == 'complete') {
    callback();
  } else {
    addEventListener('load', callback);
  }
};
      plausible       = (...args) => {
                          plausible.q = plausible.q || [];

                          plausible.q.push(args);
                        };
