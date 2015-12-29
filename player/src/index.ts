/// <reference path="../../../../typings/tsd.d.ts" />

import * as querystring from "querystring";

let qs: { project: string; build: string; } = querystring.parse(window.location.search.slice(1));
let indexPath = (qs.project != null) ? `/builds/${qs.project}/${qs.build}/assets/index.html` : "./assets/index.html";
window.location.href = indexPath;
