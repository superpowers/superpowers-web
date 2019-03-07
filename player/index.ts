/// <reference path="../../../SupClient/typings/SupApp.d.ts" />

import * as querystring from "querystring";
const qs: { project: string; build: string; } = querystring.parse(window.location.search.slice(1)) as any;

const indexPath = `/builds/${qs.project}/${qs.build}/files/index.html`;

if ((window as any).SupApp != null) {
  SupApp.openLink(`${window.location.origin}${indexPath}`);
  window.close();
} else {
  window.location.href = indexPath;
}
