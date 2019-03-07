/// <reference path="../../../common/textEditorWidget/operational-transform.d.ts" />
/// <reference path="../api/PugAPIPlugin.d.ts" />

import * as OT from "operational-transform";
import * as mkdirp from "mkdirp";
import * as dummy_fs from "fs";
import * as dummy_path from "path";

// Since we're doing weird things to the fs module,
// the code won't browserify properly with brfs
// so we'll only require them on the server-side
let serverRequire = require;

let fs: typeof dummy_fs;
let path: typeof dummy_path;
let pug: any;
if ((<any>global).window == null) {
  fs = serverRequire("fs");
  path = serverRequire("path");
  pug = serverRequire("pug");
}

type EditTextCallback = SupCore.Data.Base.ErrorCallback & ((err: string, ack: any, operationData: OperationData, revisionIndex: number) => void);
type ApplyDraftChangedCallback = SupCore.Data.Base.ErrorCallback;

interface PugAssetPub {
  text: string;
  draft: string;
  revisionId: number;
}

// NOTE: The active system changes as plugins are loaded
// That's why we keep a reference to our containing system here
let system = SupCore.system;

export default class PugAsset extends SupCore.Data.Base.Asset {
  static schema: SupCore.Data.Schema = {
    text: { type: "string" },
    draft: { type: "string" },
    revisionId: { type: "integer" }
  };

  pub: PugAssetPub;
  document: OT.Document;
  hasDraft: boolean;

  constructor(id: string, pub: PugAssetPub, server: ProjectServer) {
    super(id, pub, PugAsset.schema, server);
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
    let pub: PugAssetPub;
    fs.readFile(path.join(assetPath, "page.pug"), { encoding: "utf8" }, (err, text) => {
      fs.readFile(path.join(assetPath, "draft.pug"), { encoding: "utf8" }, (err, draft) => {
        pub = { revisionId: 0, text, draft: (draft != null) ? draft : text };

        pub.draft = pub.draft.replace(/\r\n/g, "\n");
        pub.text = pub.text.replace(/\r\n/g, "\n");

        this._onLoaded(assetPath, pub);
      });
    });
  }

  save(assetPath: string, callback: (err: Error) => any) {
    fs.writeFile(path.join(assetPath, "page.pug"), this.pub.text, { encoding: "utf8" }, (err) => {
      if (err != null) { callback(err); return; }

      if (this.hasDraft) {
        fs.writeFile(path.join(assetPath, "draft.pug"), this.pub.draft, { encoding: "utf8" }, callback);
      } else {
        fs.unlink(path.join(assetPath, "draft.pug"), (err) => {
          if (err != null && err.code !== "ENOENT") { callback(err); return; }
          callback(null);
        });
      }
    });
  }

  serverExport(buildPath: string, assetsById: { [id: string]: PugAsset }, callback: (err: Error, writtenFiles: string[]) => void) {
    let pathFromId = this.server.data.entries.getPathFromId(this.id);
    const ext = ".pug";
    if (pathFromId.lastIndexOf(ext) === pathFromId.length - ext.length) pathFromId = pathFromId.slice(0, -ext.length);
    let outputPath = `${buildPath}/${pathFromId}.html`;
    let parentPath = outputPath.slice(0, outputPath.lastIndexOf("/"));

    const pugFiles: { [filename: string]: string; } = {};
    for (const assetId in assetsById) {
      if (this.server.data.entries.byId[assetId].type !== "pug") continue;

      let filename = this.server.data.entries.getPathFromId(assetId);
      if (filename.lastIndexOf(ext) !== filename.length - ext.length) filename += ext;
      pugFiles[filename] = assetsById[assetId].pub.text;
    }

    // NOTE: It might be possible to replace this hack once Jade (well, Pug) 2 is out
    // see https://github.com/pugjs/pug-loader and https://github.com/pugjs/jade/issues/1933
    let oldReadFileSync = fs.readFileSync;
    (fs as any).readFileSync = (...args: any[]) => {
      if (args[0].indexOf(".pug") === -1) return oldReadFileSync.apply(null, args);
      return pugFiles[args[0].replace(/\\/g, "/")];
    };

    let options: { [key: string]: any; } = {};

    let plugins = system.getPlugins<SupCore.PugAPIPlugin>("pugAPI");
    if (plugins != null) {
      for (let pluginName in plugins) {
        let pluginLocals = plugins[pluginName].locals;
        for (let localName in pluginLocals) options[localName] = pluginLocals[localName];
      }
    }

    options["filename"] = `${pathFromId}.pug`;

    let html = "";
    try {
      html = pug.render(this.pub.text, options);
    } catch (err) {
      console.log(err);
    }
    fs.readFileSync = oldReadFileSync;

    mkdirp(parentPath, () => {
      fs.writeFile(outputPath, html, (err) => {
        callback(err, [ `${pathFromId}.html` ]);
      });
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

  server_applyDraftChanges(client: any, callback: ApplyDraftChangedCallback) {
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
