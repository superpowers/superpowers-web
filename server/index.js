/// <reference path="./index.d.ts" />
"use strict";
var fs = require("fs");
var async = require("async");
SupCore.system.serverBuild = function (server, buildPath, callback) {
    fs.mkdirSync(buildPath + "/assets");
    var assetIdsToExport = [];
    server.data.entries.walk(function (entry, parent) {
        if (entry.type != null)
            assetIdsToExport.push(entry.id);
    });
    var assetsById = {};
    async.each(assetIdsToExport, function (assetId, cb) {
        server.data.assets.acquire(assetId, null, function (err, asset) {
            server.data.assets.release(assetId, null);
            assetsById[assetId] = asset;
            cb();
        });
    }, function (err) {
        if (err != null) {
            callback("Could not load all assets");
            return;
        }
        async.each(assetIdsToExport, function (assetId, cb) {
            assetsById[assetId].serverExport(buildPath, assetsById, cb);
        }, function (err) {
            if (err != null) {
                callback("Could not export all assets");
                return;
            }
            callback(null);
        });
    });
};
