// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Called It Inc.
'use strict';
const state={commands:new Map(),settings:new Map(),updates:[],inputs:[],inputOptions:[],confirmations:[],errors:[],messages:[],documents:[],saved:[],saveOptions:[],modalOptions:[],events:[],provider:null,editor:undefined};
const disposable=()=>({dispose(){}});
const workspace={isTrusted:true,workspaceFolders:[{name:'fixture',uri:{fsPath:'C:/fixture'}}],
    getWorkspaceFolder:uri=>workspace.workspaceFolders.find(folder=>{const path=uri.fsPath.replace(/\\/g,'/').toLowerCase();const root=folder.uri.fsPath.replace(/\\/g,'/').toLowerCase().replace(/\/$/,'');return path===root||path.startsWith(root+'/');}),
    getConfiguration:()=>({get:(key,fallback)=>state.settings.has(key)?state.settings.get(key):fallback,update:async(key,value,target)=>{state.updates.push({key,value,target});state.settings.set(key,value);}}),
    openTextDocument:async options=>({...options,getText:()=>options.content}),fs:{writeFile:async(uri,data)=>{state.events.push('write');if(state.writeError)throw state.writeError;state.saved.push({uri,data});}}};
const window={registerWebviewViewProvider:(id,provider)=>{state.provider=provider;return disposable();},
    createStatusBarItem:()=>({show(){},dispose(){}}),
    showInputBox:async options=>{state.inputOptions.push(options);return state.inputs.shift();},
    showInformationMessage:async(message,...options)=>{state.messages.push(message);return state.confirmations.shift();},
    showWarningMessage:async(message,...options)=>{state.events.push('warning');state.modalOptions.push(options);state.messages.push(message);return state.confirmations.shift();},
    showErrorMessage:async message=>state.errors.push(message),showTextDocument:async doc=>state.documents.push(doc),showSaveDialog:async(options)=>{state.events.push('save-dialog');state.saveOptions.push(options);return state.destination;}};
Object.defineProperty(window,'activeTextEditor',{get:()=>state.editor});
const commands={registerCommand:(name,handler)=>{state.commands.set(name,handler);return disposable();},executeCommand:async(name,...args)=>state.commands.get(name)?.(...args)};
const reset=()=>{state.commands.clear();state.settings.clear();for(const key of ['updates','inputs','inputOptions','confirmations','errors','messages','documents','saved','saveOptions','modalOptions','events'])state[key]=[];state.provider=null;state.editor=undefined;state.destination=undefined;state.writeError=undefined;state.remoteName=undefined;workspace.isTrusted=true;workspace.workspaceFolders=[{name:'fixture',uri:{fsPath:'C:/fixture'}}];};
const env={};Object.defineProperty(env,'remoteName',{get:()=>state.remoteName});
module.exports={workspace,window,commands,env,ConfigurationTarget:{WorkspaceFolder:3},StatusBarAlignment:{Left:1},_state:state,_reset:reset};
