/// <reference path="../../../../typings/tsd.d.ts" />
/// <reference path="../../../../SupClient/typings/SupApp.d.ts" />

import * as querystring from "querystring";
let qs: { project: string; build: string; } = querystring.parse(window.location.search.slice(1));

if ((window as any).SupApp != null) {
  SupApp.openLink(`${window.location.origin}/builds/${qs.project}/${qs.build}/index.html`);
  window.close();
} else {
  window.location.href = `/builds/${qs.project}/${qs.build}/index.html`;
}
