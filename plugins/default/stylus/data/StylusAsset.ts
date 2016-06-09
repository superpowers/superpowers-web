/// <reference path="../../../common/textEditorWidget/operational-transform.d.ts" />
/// <reference path="../stylus.d.ts" />

import * as OT from "operational-transform";
import * as mkdirp from "mkdirp";
import * as async from "async";
import * as dummy_fs from "fs";
import * as dummy_path from "path";
import * as dummy_stylus from "stylus";

// Since we're doing weird things to the fs module,
// the code won't browserify properly with brfs
// so we'll only require them on the server-side
let serverRequire = require;

let fs: typeof dummy_fs;
let path: typeof dummy_path;
let stylus: typeof dummy_stylus;

if ((<any>global).window == null) {
  fs = serverRequire("fs");
  path = serverRequire("path");
  stylus = serverRequire("stylus");
}

type EditTextCallback = SupCore.Data.Base.ErrorCallback & ((err: string, ack: any, operationData: OperationData, revisionIndex: number) => void);
type ApplyDraftChangesCallback = SupCore.Data.Base.ErrorCallback;

interface StylusAssetPub {
  text: string;
  draft: string;
  revisionId: number;
}

export default class StylusAsset extends SupCore.Data.Base.Asset {
  static schema: SupCore.Data.Schema = {
    text: { type: "string" },
    draft: { type: "string" },
    revisionId: { type: "integer" }
  };

  pub: StylusAssetPub;
  document: OT.Document;
  hasDraft: boolean;

  constructor(id: string, pub: StylusAssetPub, server: ProjectServer) {
    super(id, pub, StylusAsset.schema, server);
  }

  init(options: any, callback: Function) {
    this.pub = {
      text: "",
      draft: "",
      revisionId: 0
    };

    super.init(options, callback);
  }

  setup() {
    this.document = new OT.Document(this.pub.draft, this.pub.revisionId);
    this.hasDraft = this.pub.text !== this.pub.draft;
  }

  restore() {
    if (this.hasDraft) this.emit("setBadge", "draft", "info");
  }

  load(assetPath: string) {
    let pub: StylusAssetPub;
    fs.readFile(path.join(assetPath, "sheet.styl"), { encoding: "utf8" }, (err, text) => {
      fs.readFile(path.join(assetPath, "draft.styl"), { encoding: "utf8" }, (err, draft) => {
        pub = { revisionId: 0, text, draft: (draft != null) ? draft : text };
        this._onLoaded(assetPath, pub);
      });
    });
  }

  save(assetPath: string, callback: (err: Error) => any) {
    fs.writeFile(path.join(assetPath, "sheet.styl"), this.pub.text, { encoding: "utf8" }, (err) => {
      if (err != null) { callback(err); return; }

      if (this.hasDraft) {
        fs.writeFile(path.join(assetPath, "draft.styl"), this.pub.draft, { encoding: "utf8" }, callback);
      } else {
        fs.unlink(path.join(assetPath, "draft.styl"), (err) => {
          if (err != null && err.code !== "ENOENT") { callback(err); return; }
          callback(null);
        });
      }
    });
  }

  publish(buildPath: string, callback: (err: Error) => any) {
    let stylusEntries: SupCore.Data.EntryNode[] = [];
    this.server.data.entries.walk((node) => {
      if (node.type === "stylus") stylusEntries.push(node);
    });

    let stylusFiles: { [filename: string]: string; } = {};

    async.each(stylusEntries, (stylusEntry, cb) => {
      this.server.data.assets.acquire(stylusEntry.id, null, (err: Error, item: StylusAsset) => {
        let filename = this.server.data.entries.getPathFromId(stylusEntry.id);
        if (filename.lastIndexOf(".styl") !== filename.length - 5) filename += ".styl";
        stylusFiles[filename] = item.pub.text;
        this.server.data.assets.release(stylusEntry.id, null);
        cb();
      });
    }, () => {
      let pathFromId = this.server.data.entries.getPathFromId(this.id);
      if (pathFromId.lastIndexOf(".styl") === pathFromId.length - 5) pathFromId = pathFromId.slice(0, -5);
      let outputPath = `${buildPath}/assets/${pathFromId}.css`;
      let parentPath = outputPath.slice(0, outputPath.lastIndexOf("/"));

      let oldReadFileSync = fs.readFileSync;
      (fs as any).readFileSync = (...args: any[]) => {
        if (args[0].indexOf(".styl") === -1 || args[0].indexOf("/stylus/lib/") !== -1) { return oldReadFileSync.apply(null, args); }
        return stylusFiles[args[0].replace(/\\/g, "/")];
      };
      let css = stylus(this.pub.text).set("filename", `${pathFromId}.styl`).set("cache", false).render();
      fs.readFileSync = oldReadFileSync;
      mkdirp(parentPath, () => { fs.writeFile(outputPath, css, callback); });
    });
  }

  server_editText(client: any, operationData: OperationData, revisionIndex: number, callback: EditTextCallback) {
    if (operationData.userId !== client.id) { callback("Invalid client id"); return; }

    let operation = new OT.TextOperation();
    if (!operation.deserialize(operationData)) { callback("Invalid operation data"); return; }

    try { operation = this.document.apply(operation, revisionIndex); }
    catch (err) { callback("Operation can't be applied"); return; }

    this.pub.draft = this.document.text;
    this.pub.revisionId++;

    callback(null, null, operation.serialize(), this.document.getRevisionId() - 1);

    if (!this.hasDraft) {
      this.hasDraft = true;
      this.emit("setBadge", "draft", "info");
    }
    this.emit("change");
  }

  client_editText(operationData: OperationData, revisionIndex: number) {
    let operation = new OT.TextOperation();
    operation.deserialize(operationData);
    this.document.apply(operation, revisionIndex);
    this.pub.draft = this.document.text;
    this.pub.revisionId++;
  }

  server_applyDraftChanges(client: any, callback: ApplyDraftChangesCallback) {
    this.pub.text = this.pub.draft;

    callback(null);

    if (this.hasDraft) {
      this.hasDraft = false;
      this.emit("clearBadge", "draft");
    }

    this.emit("change");
  }

  client_applyDraftChanges() { this.pub.text = this.pub.draft; }
}
