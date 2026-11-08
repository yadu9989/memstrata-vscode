// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Called It Inc.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CL1HttpClient,CL1RequestError,canonicalJSON,secretKey,sourcePath,validateOptions} from '../src/cl1Client';

const options={baseUrl:'http://127.0.0.1:9101',projectId:'project'};
const secrets={get:async()=> 'cl1_fixture'};
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
function golden():any {
    const quote='repeated café 😀';
    const assembled='First\n'+quote+'\nSecond\n'+quote;
    const bytes=Buffer.from(assembled);
    const first=bytes.indexOf(Buffer.from(quote));
    const second=bytes.indexOf(Buffer.from(quote),first+Buffer.byteLength(quote));
    return {contract:'memstrata/cl1-context/v1',status:'ready',project_id:'project',source_scope:'all_ready',
        assembled_context:assembled,packet_sha256:digest(assembled),fallback_used:false,source_validation_passed:true,completion_status:'complete',
        requested_profile:'standard_8k',effective_profile:'standard_8k',evidence_token_ceiling:8192,evidence_token_count:100,
        source_bindings:[{source_id:'note',revision:2,source_sha256:'a'.repeat(64),session_start:0,session_count:2}],
        documents:[first,second].map((start,i)=>({source_id:'note',revision:2,source_sha256:'a'.repeat(64),session_index:i,turn_index:0,
            quote,start_byte:7,end_byte:7+Buffer.byteLength(quote),packet_start_byte:start,packet_end_byte:start+Buffer.byteLength(quote),offset_basis:'turn_utf8'}))};
}
function response(value:any,status=200,headers:Record<string,string>={}):Response {return new Response(JSON.stringify(value),{status,headers});}

test('HTTPS boundary, stable source paths and endpoint/project secret separation',()=>{
    assert.throws(()=>validateOptions({...options,baseUrl:'http://remote.test'}),/HTTPS/);
    for(const url of ['https://user:pass@example.test','https://example.test?x=1','https://example.test#token']) {assert.throws(()=>validateOptions({...options,baseUrl:url}));}
    for(const source of ['../other','.','..','a/b']) {assert.throws(()=>sourcePath(source));}
    assert.notEqual(secretKey(options),secretKey({...options,projectId:'other'}));
    assert.notEqual(secretKey(options),secretKey({...options,baseUrl:'https://remote.test'}));
    assert(!secretKey(options).includes('cl1_fixture'));
});

test('all-ready context uses grant header and preserves repeated Unicode quotes and exact packet',async()=>{
    const calls:any[]=[];
    const client=new CL1HttpClient(options,secrets,async(url,init)=>{calls.push({url,init});return response(golden());});
    const packet=await client.context('What was repeated?');
    assert.equal(packet.packet_sha256,digest(packet.assembled_context));
    assert.equal(packet.documents[0].quote,packet.documents[1].quote);
    assert.notEqual(packet.documents[0].session_index,packet.documents[1].session_index);
    assert.equal(calls[0].init.redirect,'error');
    assert.equal(calls[0].init.headers.Authorization,'Bearer cl1_fixture');
    assert(!calls[0].url.includes('cl1_fixture'));
    const body=JSON.parse(calls[0].init.body);
    assert.equal(body.source_scope,'all_ready');assert.equal(body.source_ids,null);
    assert(!('tenant_id' in body) && !('principal_id' in body));
});

test('changed hash, scope, locator or profile fails before any context is displayed',async()=>{
    const changes=[(p:any)=>p.packet_sha256='0'.repeat(64),(p:any)=>p.project_id='foreign',
        (p:any)=>p.documents[0].session_index=8,(p:any)=>p.documents[0].packet_start_byte++,
        (p:any)=>p.documents[0].offset_basis='pdf_bytes',(p:any)=>p.evidence_token_count=9000,
        (p:any)=>p.effective_profile='deep_24k',(p:any)=>delete p.source_bindings[0].session_start,
        (p:any)=>p.source_bindings[0].session_count=0,(p:any)=>p.documents[1].packet_end_byte++];
    for(const change of changes){const packet=golden();change(packet);const client=new CL1HttpClient(options,secrets,async()=>response(packet));await assert.rejects(()=>client.context('What?'));}
});

test('source fetch checks current revision, canonical hash and scoped identity',async()=>{
    const sessions=[{date:'2026-10-10T11:12:13.123456-04:00',turns:[{role:'source',speaker:'Notes',text:'café 😀',legacy_role:'source',legacy_strip:false}]}];
    const source={contract:'memstrata/cl1-source/v1',project_id:'project',source_id:'note',revision:2,
        sessions,source_sha256:digest(canonicalJSON({sessions})),offset_basis:'turn_utf8',canonicalization:'cl1-normalized-sessions/v1',metadata:{cleared:null}};
    const calls:any[]=[];const client=new CL1HttpClient(options,secrets,async(url,init)=>{calls.push({url,init});return response(source);});
    assert.equal((await client.fetchSource('note',2)).metadata.cleared,null);
    assert(calls[0].url.includes('revision=2'));
    await assert.rejects(()=>client.fetchSource('note',1),/binding/);
    source.sessions[0].turns[0].text='tampered';await assert.rejects(()=>client.fetchSource('note',2),/hash/);
});

test('CAS correction, truthful delete receipt and metadata null are preserved',async()=>{
    const calls:any[]=[];const client=new CL1HttpClient(options,secrets,async(url,init)=>{calls.push({url,init});return response({status:init.method==='DELETE'?'removed':'stored',ready:false,lifecycle:{backup_purge:'unverified'}});});
    await client.writeDocument('note','note.txt','source text',2,{cleared:null});
    const body=JSON.parse(calls[0].init.body);assert.equal(body.expected_revision,2);assert.deepEqual(body.metadata,{cleared:null});
    assert(!('token' in body));
    const deleted=await client.deleteSource('note',3);assert.equal(deleted.lifecycle.backup_purge,'unverified');
    assert.equal(JSON.parse(calls[1].init.body).expected_revision,3);
    await assert.rejects(()=>client.deleteSource('note',0));
    await assert.rejects(()=>client.writeDocument('note','note.txt','x',1,{x:NaN}));
});

test('error bodies, revoked grants and transport exceptions do not expose secrets',async()=>{
    const client=new CL1HttpClient(options,secrets,async()=>response({detail:'sensitive cl1_fixture'},403,{'X-Memstrata-Error-Code':'authorization_revoked'}));
    await assert.rejects(()=>client.sourceStatus('note'),(error:unknown)=>error instanceof CL1RequestError && error.code==='authorization_revoked' && !error.message.includes('cl1_fixture'));
    const failing=new CL1HttpClient(options,secrets,async()=>{throw new Error('network cl1_fixture');});
    await assert.rejects(()=>failing.sourceStatus('note'),(error:unknown)=>error instanceof Error && !error.message.includes('cl1_fixture'));
    let calls=0;const redirect=new CL1HttpClient(options,secrets,async()=>{calls++;return new Response('',{status:302,headers:{Location:'https://foreign.test'}});});
    await assert.rejects(()=>redirect.sourceStatus('note'));assert.equal(calls,1);
});

test('timeout aborts a hung request with a credential-free error',async()=>{
    const client=new CL1HttpClient({...options,timeoutMs:5},secrets,async(url,init)=>new Promise((resolve,reject)=>{init.signal?.addEventListener('abort',()=>reject(new Error('cl1_fixture')));}));
    await assert.rejects(()=>client.sourceStatus('note'),/did not complete/);
});


test('main readiness and nullable observation fields remain separate',async()=>{
    const state:any={source_id:'note',revision:1,source_sha256:'a'.repeat(64),committed:true,indexed:true,searchable:false,
        freshness:{committed_at_epoch:123,searchable_observed_at_epoch:null,index_error:'',measurement_basis:'status_observation_not_exact_index_completion'}};
    const client=new CL1HttpClient(options,secrets,async()=>response(state));
    assert.equal((await client.sourceStatus('note')).searchable,false);
    state.freshness=null;assert.equal((await client.sourceStatus('note')).freshness,null);
    state.committed='yes';await assert.rejects(()=>client.sourceStatus('note'),/readiness/);
    state.committed=true;state.freshness={committed_at_epoch:123};await assert.rejects(()=>client.sourceStatus('note'),/freshness/);
});

test('deadline is omitted by default and strictly bounded when explicitly supplied',async()=>{
    const calls:any[]=[];const transport=async(url:string,init:RequestInit)=>{calls.push(JSON.parse(String(init.body)));return response(golden());};
    await new CL1HttpClient(options,secrets,transport).context('Question');assert(!('deadline_ms' in calls[0]));
    await new CL1HttpClient({...options,deadlineMs:500},secrets,transport).context('Question');assert.equal(calls[1].deadline_ms,500);
    for(const deadlineMs of [0,120001,1.5,NaN]){assert.throws(()=>new CL1HttpClient({...options,deadlineMs},secrets,transport),/deadline/);}
});


test('responses over the 32 MB envelope are refused by header and while streaming',async()=>{
    const byHeader=new CL1HttpClient(options,secrets,async()=>new Response('{}',{headers:{'content-length':'32000001'}}));
    await assert.rejects(()=>byHeader.context('What?'),/exceeds the source envelope/);
    const chunk=new Uint8Array(1_000_000).fill(32);let sent=0;
    const stream=new ReadableStream<Uint8Array>({pull(controller){if(sent++<33){controller.enqueue(chunk);}else{controller.close();}}});
    const streaming=new CL1HttpClient(options,secrets,async()=>new Response(stream));
    await assert.rejects(()=>streaming.context('What?'),/exceeds the source envelope/);
    assert(sent<=34,'the reader stopped promptly after the cap');
});

test('source listing must match its contract, project and page size',async()=>{
    const good={contract:'memstrata/cl1-source-list/v1',project_id:'project',sources:[{source_id:'a',revision:1}],next_cursor:null};
    const listed=await new CL1HttpClient(options,secrets,async()=>response(good)).listSources();
    assert.equal(listed.sources.length,1);
    for(const bad of [{...good,contract:'other/v1'},{...good,project_id:'foreign'},{...good,sources:'x'},{...good,sources:[{},{}]}]){
        await assert.rejects(()=>new CL1HttpClient(options,secrets,async()=>response(bad)).listSources(cursorFree,1),/scope|invalid/i);
    }
    await assert.rejects(()=>new CL1HttpClient(options,secrets,async()=>response(good)).listSources('',0),/Invalid source page/);
});
const cursorFree='';

test('selected sources must come back in the requested order and set',async()=>{
    const requested=['a','b'];
    // Internally consistent packets: only the order or the set of sources differs.
    const packetFor=(order:string[])=>{
        const packet=golden();packet.source_scope='selected';
        packet.source_bindings=order.map((id,i)=>({source_id:id,revision:2,source_sha256:'a'.repeat(64),session_start:i,session_count:1}));
        packet.documents=packet.documents.map((d:any,i:number)=>({...d,source_id:order[i],session_index:i}));
        return packet;
    };
    const run=(packet:any)=>new CL1HttpClient({...options,sourceIds:requested},secrets,async()=>response(packet)).context('What?');
    assert.equal((await run(packetFor(['a','b']))).source_scope,'selected');
    await assert.rejects(()=>run(packetFor(['b','a'])),/source selection differs/);
    await assert.rejects(()=>run(packetFor(['a','c'])),/source selection differs/);
});


test('installed context v1 can omit a redundant turn offset basis', async () => {
    const packet = golden();
    for (const document of packet.documents) delete (document as any).offset_basis;
    const client = new CL1HttpClient(options, secrets, async () => response(packet));
    assert.equal((await client.context('Question')).packet_sha256, packet.packet_sha256);
});

test('local pairing sends proof only to the same loopback endpoint and admits read-only grants', async () => {
    const { pairLocal } = await import('../src/localPairing');
    const { createHash } = await import('node:crypto');
    const pairId = '0123456789abcdef0123456789abcdef';
    let challenge: string | undefined;
    let claims = 0;
    let shown = false;
    const token = 'cl1_synthetic_pair';
    const wire: typeof fetch = async (input, init) => {
        const url = new URL(String(input));
        assert.equal(url.origin, 'http://127.0.0.1:9001');
        assert.equal(init?.redirect, 'error');
        const body = JSON.parse(String(init?.body));
        if (!url.pathname.endsWith('/claim')) {
            assert.deepEqual(Object.keys(body), ['challenge']);
            challenge = body.challenge;
            return response({pair_id: pairId, code: 'ABCDEF'}, 201);
        }
        assert.ok(shown);
        assert.equal(createHash('sha256').update(body.verifier).digest('hex'), challenge);
        claims++;
        if (claims === 1) return response({status:'pending'}, 202);
        return response({token, project_id:'personal', can_write:false});
    };
    assert.equal(await pairLocal(async (url, code) => {
        assert.equal(url, 'http://127.0.0.1:9001/assistant?pair-vscode=' + pairId);
        assert.equal(code, 'ABCDEF');
        assert.ok(!url.includes(token));
        shown = true;
        return true;
    }, wire, async () => {}), token);
    assert.equal(claims, 2);
});

test('an expired read grant names the Connections action', async () => {
    const client = new CL1HttpClient(options, secrets, async () => response({detail: 'CL1 credential expired'}, 403));
    await assert.rejects(() => client.sourceStatus('note'), (error: unknown) =>
        error instanceof CL1RequestError && error.code === 'authorization_expired' &&
        error.message === 'This connection expired. Open Connections and choose Renew.');
});
