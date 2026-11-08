// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Called It Inc.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {activate} from '../src/extension';
import {renderSidebar} from '../src/sidebarView';
const vscode:any=require('vscode');
function setup(){vscode._reset();const stored=new Map();const workspaceMemory=new Map();const stateWrites:any[]=[];const context:any={subscriptions:[],globalState:{update:async(...args:any[])=>stateWrites.push(args)},workspaceState:{get:(key:string)=>workspaceMemory.get(key),update:async(key:string,value:any)=>{workspaceMemory.set(key,value);stateWrites.push([key,value]);}},secrets:{get:async(key:string)=>stored.get(key),store:async(key:string,value:string)=>stored.set(key,value),delete:async(key:string)=>stored.delete(key)}};return {context,stored,state:vscode._state,stateWrites};}
function enable(state:any,stored:Map<any,any>){state.settings.set('enabled',true);state.settings.set('projectId','project');state.settings.set('baseUrl','http://127.0.0.1:9101');const key='memstrata.cl1.grant.'+createHash('sha256').update('http://127.0.0.1:9101\nproject').digest('hex');stored.set(key,'cl1_fixture');}
function source(){const sessions=[{date:'',turns:[{role:'source',speaker:'note.txt page 1',text:'old text',legacy_role:'source',legacy_strip:false}]}];const raw=JSON.stringify({sessions:[{date:'',turns:[{legacy_role:'source',legacy_strip:false,role:'source',speaker:'note.txt page 1',text:'old text'}]}]});return {contract:'memstrata/cl1-source/v1',project_id:'project',source_id:'note',revision:4,sessions,source_sha256:createHash('sha256').update(raw).digest('hex'),offset_basis:'turn_utf8',canonicalization:'cl1-normalized-sessions/v1',metadata:{clear:null}};}

test('activation makes no request, and untrusted workspaces register nothing',async()=>{
    let requests=0;const original=globalThis.fetch;globalThis.fetch=async()=>{requests++;throw new Error('forbidden');};
    try{let {context,state}=setup();vscode.workspace.isTrusted=false;activate(context);assert.equal(state.commands.size,0);
        ({context,state}=setup());activate(context);assert.equal(requests,0);assert.equal(state.commands.size,9);
        await vscode.commands.executeCommand('memstrataCl1.context');assert.equal(requests,0);assert.match(state.errors[0],/Enable CL1 explicitly/);
    }finally{globalThis.fetch=original;}
});

test('workspace configuration stores the grant only in SecretStorage after explicit opt-in',async()=>{
    const {context,stored,state}=setup();activate(context);state.inputs.push('http://127.0.0.1:9101','project','cl1_fixture');state.confirmations.push('Enable workspace');
    await vscode.commands.executeCommand('memstrataCl1.configure');assert.equal(stored.size,1);assert.equal(state.settings.get('enabled'),true);
    assert(state.inputOptions[2].password);assert(state.updates.every((u:any)=>u.target===vscode.ConfigurationTarget.WorkspaceFolder));
    assert(!JSON.stringify(state.updates).includes('cl1_fixture'));assert(!JSON.stringify(state.messages).includes('cl1_fixture'));
    await vscode.commands.executeCommand('memstrataCl1.clearGrant');assert.equal(stored.size,0);assert.equal(state.settings.get('enabled'),false);
});

test('delete requires owner confirmation and binds the inspected revision',async()=>{
    const {context,stored,state}=setup();enable(state,stored);activate(context);const calls:any[]=[];const original=globalThis.fetch;
    globalThis.fetch=async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify(init?.method==='DELETE'?{status:'removed',lifecycle:{backup_purge:'unverified'}}:source()));};
    try{await vscode.commands.executeCommand('memstrataCl1.delete','note');assert.equal(calls.length,1);assert.equal(calls[0].init.method,'GET');
        state.confirmations.push('Delete source');await vscode.commands.executeCommand('memstrataCl1.delete','note');assert.equal(calls.length,3);
        assert.equal(calls[2].init.method,'DELETE');assert.equal(JSON.parse(calls[2].init.body).expected_revision,4);assert(state.documents[0].content.includes('unverified'));
    }finally{globalThis.fetch=original;}
});

test('correction uses owner editor text, existing null metadata and exact revision',async()=>{
    const {context,stored,state}=setup();enable(state,stored);activate(context);state.editor={document:{getText:()=> 'replacement café 😀',fileName:'C:/fixture/note.txt',languageId:'plaintext'}};
    state.confirmations.push('Replace source');const calls:any[]=[];const original=globalThis.fetch;
    globalThis.fetch=async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify(init?.method==='POST'?{status:'stored',ready:false}:source()));};
    try{await vscode.commands.executeCommand('memstrataCl1.correct','note');const body=JSON.parse(calls[1].init.body);assert.equal(body.expected_revision,4);assert.equal(body.text,'replacement café 😀');assert.deepEqual(body.metadata,{clear:null});assert(!('principal_id' in body));}
    finally{globalThis.fetch=original;}
});

test('source dashboard escapes source material and uses a nonce-limited script policy',()=>{
    const html=renderSidebar('<script>project</script>',[{source_id:'<img src=x onerror=alert(1)>',revision:2,committed:true,indexed:false,searchable:false}],null,'Source status','nonceFixture');
    assert(!html.includes('<img src=x'));assert(!html.includes('<script>project</script>'));assert(html.includes('&lt;script&gt;project'));
    assert(html.includes("script-src 'nonce-nonceFixture'"));assert(!html.includes('iframe'));assert(!html.includes('api_key='));assert(!html.includes('cl1_fixture'));
});

test('server write-grant refusal is preserved after owner consent',async()=>{
    const {context,stored,state}=setup();enable(state,stored);activate(context);
    state.editor={document:{getText:()=> 'synthetic',fileName:'note.txt',languageId:'plaintext'}};
    state.inputs.push('note');state.confirmations.push('Import source');let requests=0;const original=globalThis.fetch;
    globalThis.fetch=async()=>{requests++;return new Response('{}',{status:403,headers:{'X-MemStrata-Error-Code':'write_required'}});};
    try {await vscode.commands.executeCommand('memstrataCl1.import');assert.equal(requests,1);assert.match(state.errors[0],/HTTP 403.*write_required/);assert.equal(state.documents.length,0);}
    finally {globalThis.fetch=original;}
});

test('remove-grant deletes the key written by Enable even after the settings changed, and says so',async()=>{
    const {context,stored,state}=setup();activate(context);state.inputs.push('http://127.0.0.1:9101','project','cl1_fixture');state.confirmations.push('Enable workspace');
    await vscode.commands.executeCommand('memstrataCl1.configure');assert.equal(stored.size,1);
    state.settings.set('projectId','other-project');
    await vscode.commands.executeCommand('memstrataCl1.clearGrant');
    assert.equal(stored.size,0);assert.match(state.messages.at(-1),/Removed 1 stored grant/);assert.equal(state.settings.get('enabled'),false);
});

test('remove-grant reports truthfully when nothing is stored, and tolerates invalid settings',async()=>{
    const {context,stored,state}=setup();activate(context);
    state.settings.set('projectId','');state.settings.set('baseUrl','http://remote.test');
    await vscode.commands.executeCommand('memstrataCl1.clearGrant');
    assert.equal(stored.size,0);assert.equal(state.errors.length,0);assert.match(state.messages.at(-1),/nothing was removed/);
});

test('remote windows are refused before any secret read, prompt or request',async()=>{
    const {context,stored,state}=setup();enable(state,stored);activate(context);state.remoteName='ssh-remote';
    let requests=0;const original=globalThis.fetch;globalThis.fetch=async()=>{requests++;return new Response('{}');};
    try{
        for(const name of ['refresh','context','inspect','configure']){await vscode.commands.executeCommand('memstrataCl1.'+name,'note');}
        assert.equal(requests,0);assert.equal(state.inputs.length,0);assert.equal(state.inputOptions.length,0);
        assert.equal(state.errors.length,4);assert(state.errors.every((m:string)=>/only in a local VS Code window/.test(m)));
    }finally{globalThis.fetch=original;}
});

test('import and replace confirmations name the file, its size and the service',async()=>{
    const {context,stored,state}=setup();enable(state,stored);activate(context);
    state.editor={document:{getText:()=> 'héllo',fileName:'C:/fixture/notes.txt',languageId:'plaintext'}};
    state.inputs.push('note');
    await vscode.commands.executeCommand('memstrataCl1.import');
    assert.match(state.messages[0],/notes\.txt/);assert.match(state.messages[0],/6 bytes/);assert.match(state.messages[0],/127\.0\.0\.1:9101/);
});

test('sidebar acts only on known commands with a string source ID',async()=>{
    const {context,stored,state}=setup();enable(state,stored);activate(context);
    const called:string[]=[];
    for(const name of ['inspect','delete','evil','refresh']){state.commands.set('memstrataCl1.'+name,async(...args:any[])=>{called.push(name+':'+args.join(','));});}
    let handler:any;const view:any={webview:{options:{},html:'',onDidReceiveMessage:(h:any)=>{handler=h;return {dispose(){}};}}};
    state.provider.resolveWebviewView(view);
    await handler({command:'evil',sourceId:'note'});await handler({command:'inspect',sourceId:42});await handler({command:'delete'});await handler(null);await handler('inspect');
    assert.deepEqual(called,[]);
    await handler({command:'inspect',sourceId:'note'});await handler({command:'delete',sourceId:'note'});
    assert.deepEqual(called,['inspect:note','delete:note']);
    assert.equal(view.webview.options.enableScripts,true);assert.deepEqual(view.webview.options.localResourceRoots,[]);
});
