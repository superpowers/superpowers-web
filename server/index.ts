/// <reference path="./index.d.ts" />

import * as fs from "fs";
import * as async from "async";

interface ExportableAsset extends SupCore.Data.Base.Asset {
  serverExport: (outputPath: string, assetsById: { [id: string]: ExportableAsset }, callback: (err: Error) => void) => void;
}

SupCore.system.serverBuild = (server: ProjectServer, buildPath: string, callback: (err: string) => void) => {
  fs.mkdirSync(`${buildPath}/assets`);

  const assetIdsToExport: string[] = [];
  server.data.entries.walk((entry: SupCore.Data.EntryNode, parent: SupCore.Data.EntryNode) => {
    if (entry.type != null) assetIdsToExport.push(entry.id);
  });

  const assetsById: { [id: string]: ExportableAsset } = {};
  async.each(assetIdsToExport, (assetId, cb) => {
    server.data.assets.acquire(assetId, null, (err: Error, asset: ExportableAsset) => {
      server.data.assets.release(assetId, null);

      assetsById[assetId] = asset;
      cb();
    });
  }, (err) => {
    if (err != null) { callback("Could not load all assets"); return; }

    async.each(assetIdsToExport, (assetId, cb) => {
      assetsById[assetId].serverExport(buildPath, assetsById, cb);
    }, (err) => {
      if (err != null) { callback("Could not export all assets"); return; }

      callback(null);
    });
  });
};
