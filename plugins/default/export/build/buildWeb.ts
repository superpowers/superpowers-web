import * as async from "async";
import * as querystring from "querystring";
import supFetch from "../../../../../../SupClient/fetch";
import * as path from "path";

const qs = querystring.parse(window.location.search.slice(1));

let settings: WebBuildSettings;
let projectWindowId: number;

const progress = { index: 0, total: 0, errors: 0 };
const statusElt = document.querySelector(".status");
const progressElt = document.querySelector("progress") as HTMLProgressElement;
const detailsListElt = document.querySelector(".details ol") as HTMLOListElement;

export default function build(socket: SocketIOClient.Socket, theSettings: WebBuildSettings, theProjectWindowId: number, buildPort: number) {
  settings = theSettings;
  projectWindowId = theProjectWindowId;

  socket.emit("build:project", (err: string, buildId: string) => {
    const buildPath = `${window.location.protocol}//${window.location.hostname}:${buildPort}/builds/${qs.project}/${buildId}/`;

    supFetch(`${buildPath}files.json`, "json", (err, filesToDownload) => {
      if (err != null) {
        progress.errors++;
        SupClient.html("li", { parent: detailsListElt, textContent: SupClient.i18n.t("builds:web.errors.exportFailed", { path: settings.outputFolder }) });
        return;
      }

      progress.total = filesToDownload.length;
      updateProgress();

      async.each(filesToDownload as string[], (filePath, cb) => {
        downloadFile(buildPath, filePath, (err) => {
          if (err != null) {
            progress.errors++;
            SupClient.html("li", { parent: detailsListElt, textContent: SupClient.i18n.t("builds:web.errors.exportFailed", { path: filePath }) });
          } else {
            progress.index++;
            updateProgress();
          }

          cb(err);
        });
      });
    });
  });
}

function updateProgress() {
  progressElt.max = progress.total;
  progressElt.value = progress.index;

  if (progress.index < progress.total) {
    statusElt.textContent = SupClient.i18n.t("builds:web.progress", { path: settings.outputFolder, index: progress.index, total: progress.total });
  } else {
    statusElt.textContent = progress.errors > 0 ?
      SupClient.i18n.t("builds:web.doneWithErrors", { path: settings.outputFolder, total: progress.total, errors: progress.errors }) :
      SupClient.i18n.t("builds:web.done", { path: settings.outputFolder, total: progress.total });

      SupApp.sendMessage(projectWindowId, "build-finished");
  }
}

function downloadFile(buildPath: string, filePath: string, callback: (err: Error) => void) {
  const inputPath = `${buildPath}files/${filePath}`;
  const outputPath = path.join(settings.outputFolder, filePath);

  SupApp.mkdirp(path.dirname(outputPath), (err) => {
    supFetch(inputPath, "arraybuffer", (err, data) => {
      if (err != null) { callback(err); return; }

      SupApp.writeFile(outputPath, new Buffer(data), callback);
    });
  });
}
