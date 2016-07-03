/// <reference path="./WebBuildSettings.d.ts" />

import WebBuildSettingsEditor from "./WebBuildSettingsEditor";
import buildWeb from "./buildWeb";

SupClient.registerPlugin<SupClient.BuildPlugin>("build", "web", {
  settingsEditor: WebBuildSettingsEditor,
  build: buildWeb
});
