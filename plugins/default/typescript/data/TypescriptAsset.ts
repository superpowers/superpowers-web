/// <reference path="../../../common/textEditorWidget/operational-transform.d.ts" />

import * as OT from "operational-transform";
import * as mkdirp from "mkdirp";
import * as dummy_fs from "fs";
import * as dummy_path from "path";
import * as ts from "typescript";
import * as browserify from "browserify";

// Since we're doing weird things to the fs module,
// the code won't browserify properly with brfs
// so we'll only require them on the server-side
let serverRequire = require;

let fs: typeof dummy_fs;
let path: typeof dummy_path;
if ((<any>global).window == null) {
  fs = serverRequire("fs");
  path = serverRequire("path");
}

interface TypescriptAssetPub {
  text: string;
  draft: string;
  revisionId: number;
}

export default class TypescriptAsset extends SupCore.Data.Base.Asset {
  static schema: SupCore.Data.Base.Schema = {
    text: { type: "string" },
    draft: { type: "string" },
    revisionId: { type: "integer" }
  };

  pub: TypescriptAssetPub;
  document: OT.Document;
  hasDraft: boolean;

  constructor(id: string, pub: TypescriptAssetPub, server: ProjectServer) {
    super(id, pub, TypescriptAsset.schema, server);
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
    let pub: TypescriptAssetPub;
    fs.readFile(path.join(assetPath, "data.ts"), { encoding: "utf8" }, (err, text) => {
      fs.readFile(path.join(assetPath, "draft.ts"), { encoding: "utf8" }, (err, draft) => {
        pub = { revisionId: 0, text, draft: (draft != null) ? draft : text };
        this._onLoaded(assetPath, pub);
      });
    });
  }

  save(assetPath: string, callback: (err: Error) => any) {
    fs.writeFile(path.join(assetPath, "data.ts"), this.pub.text, { encoding: "utf8" }, (err) => {
      if (err != null) { callback(err); return; }

      if (this.hasDraft) {
        fs.writeFile(path.join(assetPath, "draft.ts"), this.pub.draft, { encoding: "utf8" }, callback);
      } else {
        fs.unlink(path.join(assetPath, "draft.ts"), (err) => {
          if (err != null && err.code !== "ENOENT") { callback(err); return; }
          callback(null);
        });
      }
    });
  }

  publish(buildPath: string, callback: (err: Error) => any) {
    let pathFromId = this.server.data.entries.getPathFromId(this.id);
    //if (pathFromId.lastIndexOf(".ts") === pathFromId.length - 5) pathFromId = pathFromId.slice(0, -5);
    let outputPath = `${buildPath}/assets/${pathFromId}.js`;
    let parentPath = outputPath.slice(0, outputPath.lastIndexOf("/"));

    let code = this.pub.text;
    let text = ts.transpile(code);
    if(text.indexOf("/// browserify") > -1) {
      mkdirp(parentPath, () => { fs.writeFile(outputPath, text, 
        () => {
          var browserify = require('browserify');
          var b = browserify();
          b.add(`${buildPath}/assets/${pathFromId}.js`);
          b.bundle((err: any, data: any) => {
              var StringDecoder = require('string_decoder').StringDecoder;
              var decoder = new StringDecoder('utf8');
              
              text = decoder.write(data);
                      
              mkdirp(parentPath, function () { fs.writeFile(outputPath, text, callback); });
          });
        }); 
      });
    } else {
      mkdirp(parentPath, function () { fs.writeFile(outputPath, text, callback); });
    }
    
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
