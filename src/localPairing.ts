// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Called It Inc.
import { createHash, randomBytes } from 'node:crypto';

const ASSISTANT = 'http://127.0.0.1:9001';
const PAIR_API = ASSISTANT + '/assistant/api/cl1/connections/vscode';
export const LOCAL_CL1 = {baseUrl: 'http://127.0.0.1:9101', projectId: 'personal'};

async function smallJSON(response: Response): Promise<Record<string, unknown>> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Pairing response is empty.');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
        const item = await reader.read();
        if (item.done) break;
        bytes += item.value.byteLength;
        if (bytes > 4096) {
            await reader.cancel();
            throw new Error('Pairing response exceeds the local envelope.');
        }
        chunks.push(item.value);
    }
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!result || Array.isArray(result) || typeof result !== 'object') {
        throw new Error('Pairing response is invalid.');
    }
    return result as Record<string, unknown>;
}

export async function pairLocal(
    showApproval: (url: string, code: string) => Promise<boolean>,
    transport: typeof fetch = fetch,
    pause = () => new Promise<void>(resolve => setTimeout(resolve, 1000)),
): Promise<string> {
    const verifier = randomBytes(32).toString('hex');
    const challenge = createHash('sha256').update(verifier, 'ascii').digest('hex');
    const request = (path: string, body: object) => transport(path, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
        redirect: 'error', signal: AbortSignal.timeout(4000),
    });
    let start: Response;
    try { start = await request(PAIR_API, {challenge}); }
    catch { throw new Error('Start the local Assistant with memstrata-conversational assistant.'); }
    if (start.status !== 201) throw new Error('The local Assistant does not offer VS Code pairing.');
    const pair = await smallJSON(start);
    if (typeof pair.pair_id !== 'string' || !/^[a-f0-9]{32}$/.test(pair.pair_id)
        || pair.code !== pair.pair_id.slice(-6).toUpperCase()) {
        throw new Error('The local pairing response is invalid.');
    }
    const ttl = pair.expires_in_seconds ?? 90;
    if (typeof ttl !== 'number' || !Number.isInteger(ttl) || ttl < 1 || ttl > 600) {
        throw new Error('The local pairing lifetime is invalid.');
    }
    const deadline = performance.now() + ttl * 1000;
    if (!await showApproval(ASSISTANT + '/assistant?pair-vscode=' + pair.pair_id, pair.code)) {
        throw new Error('The local Assistant approval page did not open.');
    }
    while (performance.now() < deadline) {
        const result = await request(PAIR_API + '/' + pair.pair_id + '/claim', {verifier});
        if (result.status === 202) {
            await result.body?.cancel();
            await pause();
            continue;
        }
        if (!result.ok) throw new Error('This pairing could not be completed.');
        const grant = await smallJSON(result);
        if (grant.project_id !== LOCAL_CL1.projectId || grant.can_write !== false
            || typeof grant.token !== 'string' || !/^cl1_[A-Za-z0-9_-]{1,124}$/.test(grant.token)) {
            throw new Error('The local Assistant did not return a read-only personal grant.');
        }
        return grant.token;
    }
    throw new Error('The local VS Code approval expired.');
}
