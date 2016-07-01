/// <reference path="./index.d.ts" />

import * as async from "async";

interface ExportableAsset extends SupCore.Data.Base.Asset {
  serverExport: (outputPath: string, assetsById: { [id: string]: ExportableAsset }, callback: (err: Error) => void) => void;
}

SupCore.system.serverBuild = (server: ProjectServer, buildPath: string, callback: (err: string) => void) => {
  const assetIdsToExport: string[] = [];
  server.data.entries.walk((entry: SupCore.Data.EntryNode, parent: SupCore.Data.EntryNode) => {
    if (entry.type != null) assetIdsToExport.push(entry.id);
  });

  const assetsById: { [id: string]: ExportableAsset } = {};

  async.series([

    // Acquire all assets
    (cb) => {
      async.each(assetIdsToExport, (assetId, cb) => {
        server.data.assets.acquire(assetId, null, (err: Error, asset: ExportableAsset) => {
          assetsById[assetId] = asset;
          cb();
        });
      }, cb);
    },

    // Export all assets
    (cb) => {
      async.each(assetIdsToExport, (assetId, cb) => {
        assetsById[assetId].serverExport(buildPath, assetsById, () => {
          cb();
        });
      }, cb);
    },

  ], () => {
    // Release all assets
    for (const assetId of assetIdsToExport) server.data.assets.release(assetId, null);

    callback(null);
  });
};
