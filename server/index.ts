/// <reference path="../../../SupCore/SupCore.d.ts" />

import * as async from "async";
import * as fs from "fs";

interface ServerExportableAsset extends SupCore.Data.Base.Asset {
  serverExport: (outputPath: string, assetsById: { [id: string]: ServerExportableAsset }, callback: (err: Error, writtenFiles: string[]) => void) => void;
}

SupCore.system.serverBuild = (server: ProjectServer, buildPath: string, callback: (err: string) => void) => {
  const assetIdsToExport: string[] = [];
  let files: string[] = [];
  server.data.entries.walk((entry: SupCore.Data.EntryNode, parent: SupCore.Data.EntryNode) => {
    if (entry.type == null) return;

    assetIdsToExport.push(entry.id);
  });

  const assetsById: { [id: string]: ServerExportableAsset } = {};

  async.series([

    // Acquire all assets
    (cb) => {
      async.each(assetIdsToExport, (assetId, cb) => {
        server.data.assets.acquire(assetId, null, (err: Error, asset: ServerExportableAsset) => {
          assetsById[assetId] = asset;
          cb();
        });
      }, cb);
    },

    // Export all assets
    (cb) => {
      async.each(assetIdsToExport, (assetId, cb) => {
        assetsById[assetId].serverExport(`${buildPath}/files`, assetsById, (err, writtenFiles) => {
          files = files.concat(writtenFiles);
          cb();
        });
      }, cb);
    },

  ], () => {
    // Release all assets
    for (const assetId of assetIdsToExport) server.data.assets.release(assetId, null);

    // Write files.json
    fs.writeFile(`${buildPath}/files.json`, JSON.stringify(files), (err) => { callback(err != null ? err.message : null); });
  });
};
