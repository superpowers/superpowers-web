/// <reference path="../../../common/textEditorWidget/operational-transform.d.ts" />
/// <reference path="../api/JadeAPIPlugin.d.ts" />

import * as OT from "operational-transform";
import * as mkdirp from "mkdirp";
import * as async from "async";
import * as dummy_fs from "fs";
import * as dummy_path from "path";

// Since we're doing weird things to the fs module,
// the code won't browserify properly with brfs
// so we'll only require them on the server-side
let serverRequire = require;

let fs: typeof dummy_fs;
let path: typeof dummy_path;
let jade: any;
if ((<any>global).window == null) {
  fs = serverRequire("fs");
  path = serverRequire("path");
  jade = serverRequire("jade");
}

interface JadeAssetPub {
  text: string;
  draft: string;
  revisionId: number;
}

// NOTE: The active system changes as plugins are loaded
// That's why we keep a reference to our containing system here
let system = SupCore.system;

export default class JadeAsset extends SupCore.Data.Base.Asset {
  static schema: SupCore.Data.Schema = {
    text: { type: "string" },
    draft: { type: "string" },
    revisionId: { type: "integer" }
  };

  pub: JadeAssetPub;
  document: OT.Document;
  hasDraft: boolean;

  constructor(id: string, pub: JadeAssetPub, server: ProjectServer) {
    super(id, pub, JadeAsset.schema, server);
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
    let pub: JadeAssetPub;
    fs.readFile(path.join(assetPath, "page.jade"), { encoding: "utf8" }, (err, text) => {
      fs.readFile(path.join(assetPath, "draft.jade"), { encoding: "utf8" }, (err, draft) => {
        pub = { revisionId: 0, text, draft: (draft != null) ? draft : text };
        this._onLoaded(assetPath, pub);
      });
    });
  }

  save(assetPath: string, callback: (err: Error) => any) {
    fs.writeFile(path.join(assetPath, "page.jade"), this.pub.text, { encoding: "utf8" }, (err) => {
      if (err != null) { callback(err); return; }

      if (this.hasDraft) {
        fs.writeFile(path.join(assetPath, "draft.jade"), this.pub.draft, { encoding: "utf8" }, callback);
      } else {
        fs.unlink(path.join(assetPath, "draft.jade"), (err) => {
          if (err != null && err.code !== "ENOENT") { callback(err); return; }
          callback(null);
        });
      }
    });
  }

  publish(buildPath: string, callback: (err: Error) => any) {
    let jadeEntries: SupCore.Data.EntryNode[] = [];
    this.server.data.entries.walk((node) => {
      if (node.type === "jade") jadeEntries.push(node);
    });

    let jadeFiles: { [filename: string]: string; } = {};

    async.each(jadeEntries, (jadeEntry, cb) => {
      this.server.data.assets.acquire(jadeEntry.id, null, (err: Error, item: JadeAsset) => {
        let filename = this.server.data.entries.getPathFromId(jadeEntry.id);
        if (filename.lastIndexOf(".jade") !== filename.length - 5) filename += ".jade";
        jadeFiles[filename] = item.pub.text;
        this.server.data.assets.release(jadeEntry.id, null);
        cb();
      });
    }, () => {
      let pathFromId = this.server.data.entries.getPathFromId(this.id);
      if (pathFromId.lastIndexOf(".jade") === pathFromId.length - 5) pathFromId = pathFromId.slice(0, -5);
      let outputPath = `${buildPath}/assets/${pathFromId}.html`;
      let parentPath = outputPath.slice(0, outputPath.lastIndexOf("/"));

      // NOTE: It might be possible to replace this hack once Jade (well, Pug) 2 is out
      // see https://github.com/pugjs/pug-loader and https://github.com/pugjs/jade/issues/1933
      let oldReadFileSync = fs.readFileSync;
      (fs as any).readFileSync = (...args: any[]) => {
        if (args[0].indexOf(".jade") === -1) return oldReadFileSync.apply(null, args);
        return jadeFiles[args[0].replace(/\\/g, "/")];
      };

      let options: { [key: string]: any; } = {};

      let plugins = system.getPlugins<SupCore.JadeAPIPlugin>("jadeAPI");
      if (plugins != null) {
        for (let pluginName in plugins) {
          let pluginLocals = plugins[pluginName].locals;
          for (let localName in pluginLocals) options[localName] = pluginLocals[localName];
        }
      }

      options["filename"] = `${pathFromId}.jade`;

      let html = "";
      try {
        html = jade.render(this.pub.text, options);
      } catch (err) {
        console.log(err);
      }
      fs.readFileSync = oldReadFileSync;

      mkdirp(parentPath, () => { fs.writeFile(outputPath, html, callback); });
    });
  }

  server_editText(client: any, operationData: OperationData, revisionIndex: number, callback: (err: string, operationData?: any, revisionIndex?: number) => any) {
    if (operationData.userId !== client.id) { callback("Invalid client id"); return; }

    let operation = new OT.TextOperation();
    if (!operation.deserialize(operationData)) { callback("Invalid operation data"); return; }

    try { operation = this.document.apply(operation, revisionIndex); }
    catch (err) { callback("Operation can't be applied"); return; }

    this.pub.draft = this.document.text;
    this.pub.revisionId++;

    callback(null, operation.serialize(), this.document.getRevisionId() - 1);

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

  server_applyDraftChanges(client: any, callback: (err: string) => any) {
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
