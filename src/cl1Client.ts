// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Called It Inc.
import { createHash } from 'node:crypto';

export type JsonObject = Record<string, any>;
export type FetchTransport = (input: string, init: RequestInit) => Promise<Response>;
export interface SecretStore {get(key: string): Thenable<string | undefined> | Promise<string | undefined>;}
export interface CL1Options {baseUrl: string; projectId: string; sourceIds?: string[]; profile?: string; timeoutMs?: number; deadlineMs?: number;}

export class CL1RequestError extends Error {
    constructor(message: string, public readonly status?: number, public readonly code?: string) {super(message);}
}

export function validateOptions(options: CL1Options): CL1Options {
    const url = new URL(options.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('A plain HTTP(S) service URL is required.');
    }
    if (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
        throw new Error('Remote CL1 credentials require HTTPS.');
    }
    if (!options.projectId.trim() || options.projectId.length > 128) {throw new Error('A provisioned project is required.');}
    const ids = options.sourceIds ?? [];
    if (ids.length > 128 || new Set(ids).size !== ids.length) {throw new Error('Use at most 128 distinct source IDs.');}
    ids.forEach(sourcePath);
    if (!['standard_7k', 'standard_8k', 'deep_24k'].includes(options.profile ?? 'standard_8k')) {throw new Error('Unknown CL1 profile.');}
    if (options.deadlineMs !== undefined && (!Number.isInteger(options.deadlineMs) || options.deadlineMs < 1 || options.deadlineMs > 120000)) {throw new Error('A deadline must be an integer from 1 to 120000 milliseconds.');}
    return {...options, baseUrl: options.baseUrl.replace(/\/$/, ''), sourceIds: [...ids]};
}

export function secretKey(options: CL1Options): string {
    return 'memstrata.cl1.grant.' + createHash('sha256').update(options.baseUrl + '\n' + options.projectId).digest('hex');
}

export function sourcePath(sourceId: string): string {
    if (typeof sourceId !== 'string' || ['.','..'].includes(sourceId) || !/^[A-Za-z0-9._:-]{1,128}$/.test(sourceId)) {throw new Error('A stable CL1 source ID is required.');}
    return '/sources/cl1/v1/' + encodeURIComponent(sourceId);
}

function sha256(raw: string | Buffer): string {return createHash('sha256').update(raw).digest('hex');}
export function canonicalJSON(value: any): string {
    if (Array.isArray(value)) {return '[' + value.map(canonicalJSON).join(',') + ']';}
    if (value !== null && typeof value === 'object') {
        return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJSON(value[key])).join(',') + '}';
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {throw new Error('Nonfinite metadata is unsupported.');}
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {throw new Error('Metadata must be JSON.');}
    return encoded;
}

export class CL1HttpClient {
    public readonly options: CL1Options;
    constructor(options: CL1Options, private readonly secrets: SecretStore, private readonly transport: FetchTransport = fetch) {
        this.options = validateOptions(options);
    }

    private async request(method: string, path: string, body?: JsonObject): Promise<{json: JsonObject; raw: string}> {
        const token = await this.secrets.get(secretKey(this.options));
        if (!token || !/^cl1_[A-Za-z0-9_-]+$/.test(token) || token.length > 128) {throw new Error('Store a provisioned scoped grant first.');}
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 120000);
        try {
            const response = await this.transport(this.options.baseUrl + path, {
                method, redirect: 'error', signal: controller.signal,
                headers: {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            const limit = 32_000_000;
            if (Number(response.headers.get('content-length') ?? 0) > limit) {throw new Error('CL1 response exceeds the source envelope.');}
            const chunks: Uint8Array[] = [];
            let total = 0;
            const reader = response.body?.getReader();
            if (reader) {
                while (true) {
                    const next = await reader.read();
                    if (next.done) {break;}
                    total += next.value.byteLength;
                    if (total > limit) {await reader.cancel(); throw new Error('CL1 response exceeds the source envelope.');}
                    chunks.push(next.value);
                }
            }
            const raw = Buffer.concat(chunks).toString('utf8');
            if (![200, 202].includes(response.status)) {
                let code: string | undefined;
                try {
                    const detail = JSON.parse(raw)?.detail;
                    const candidate = response.status === 403 && detail === 'CL1 credential expired'
                        ? 'authorization_expired' : detail?.code;
                    if (typeof candidate === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(candidate)) {code = candidate;}
                } catch { /* Error bodies never become user-facing source text. */ }
                const headerCode = response.headers.get('x-memstrata-error-code');
                if (!code && headerCode && /^[A-Za-z0-9_-]{1,80}$/.test(headerCode)) {code=headerCode;}
                if (response.status === 403 && code === 'authorization_expired') {
                    throw new CL1RequestError('This connection expired. Open Connections and choose Renew.', 403, code);
                }
                throw new CL1RequestError('Scoped CL1 operation returned HTTP ' + response.status + (code ? ' (' + code + ').' : '.'), response.status, code);
            }
            let json: JsonObject;
            try {json = JSON.parse(raw);} catch {throw new Error('CL1 returned invalid JSON.');}
            if (!json || Array.isArray(json) || typeof json !== 'object') {throw new Error('CL1 returned an invalid object.');}
            return {json, raw};
        } catch (error) {
            if (error instanceof CL1RequestError) {throw error;}
            if (error instanceof Error && ['Store a provisioned scoped grant first.', 'CL1 returned invalid JSON.', 'CL1 returned an invalid object.', 'CL1 response exceeds the source envelope.'].includes(error.message)) {throw error;}
            throw new Error('CL1 service request did not complete.');
        } finally {clearTimeout(timer);}
    }

    async listSources(cursor = '', limit = 25): Promise<JsonObject> {
        if (cursor.length > 256 || !Number.isInteger(limit) || limit < 1 || limit > 100) {throw new Error('Invalid source page.');}
        const query = new URLSearchParams({project_id: this.options.projectId, cursor, limit: String(limit)});
        const {json} = await this.request('GET', '/sources/cl1/v1?' + query);
        if (json.contract !== 'memstrata/cl1-source-list/v1' || json.project_id !== this.options.projectId || !Array.isArray(json.sources) || json.sources.length > limit) {throw new Error('Source listing scope is invalid.');}
        return json;
    }

    async sourceStatus(sourceId: string): Promise<JsonObject> {
        const query = new URLSearchParams({project_id: this.options.projectId});
        const {json} = await this.request('GET', sourcePath(sourceId) + '/status?' + query);
        if (json.source_id !== sourceId || !Number.isInteger(json.revision) || json.revision < 1) {throw new Error('Source status binding is invalid.');}
        if (!/^[0-9a-f]{64}$/.test(json.source_sha256) || ['committed','indexed','searchable'].some(key => typeof json[key] !== 'boolean')) {throw new Error('Source readiness is invalid.');}
        const freshness = json.freshness;
        if (freshness !== null && (!freshness || Array.isArray(freshness) || typeof freshness !== 'object'
            || !Number.isFinite(freshness.committed_at_epoch) || freshness.committed_at_epoch < 0
            || (freshness.searchable_observed_at_epoch !== null && (!Number.isFinite(freshness.searchable_observed_at_epoch) || freshness.searchable_observed_at_epoch < 0))
            || typeof freshness.index_error !== 'string'
            || freshness.measurement_basis !== 'status_observation_not_exact_index_completion')) {throw new Error('Source freshness is invalid.');}
        return json;
    }

    async fetchSource(sourceId: string, revision?: number): Promise<JsonObject> {
        const query = new URLSearchParams({project_id: this.options.projectId});
        if (revision !== undefined) {if (!Number.isInteger(revision) || revision < 1) {throw new Error('A positive exact revision is required.');} query.set('revision', String(revision));}
        const {json} = await this.request('GET', sourcePath(sourceId) + '?' + query);
        if (json.contract !== 'memstrata/cl1-source/v1' || json.project_id !== this.options.projectId || json.source_id !== sourceId || !Number.isInteger(json.revision) || json.revision < 1 || (revision !== undefined && json.revision !== revision) || json.canonicalization !== 'cl1-normalized-sessions/v1' || json.offset_basis !== 'turn_utf8' || !Array.isArray(json.sessions) || !json.metadata || Array.isArray(json.metadata) || typeof json.metadata !== 'object') {throw new Error('Source binding is invalid.');}
        if (sha256(canonicalJSON({sessions: json.sessions})) !== json.source_sha256) {throw new Error('Source canonical snapshot hash differs.');}
        return json;
    }

    async context(question: string): Promise<JsonObject> {
        if (!question.trim() || question.length > 4096) {throw new Error('Use a nonblank bounded question.');}
        const ids = this.options.sourceIds ?? [];
        const scope = ids.length ? 'selected' : 'all_ready';
        const {json} = await this.request('POST', '/context/cl1/v1', {
            project_id: this.options.projectId, source_scope: scope, source_ids: ids.length ? ids : null,
            question, profile: this.options.profile ?? 'standard_8k',
            ...(this.options.deadlineMs === undefined ? {} : {deadline_ms:this.options.deadlineMs}),
        });
        if (json.contract !== 'memstrata/cl1-context/v1' || json.project_id !== this.options.projectId || json.source_scope !== scope || json.status !== 'ready' || json.fallback_used !== false || json.completion_status !== 'complete' || json.source_validation_passed !== true || typeof json.assembled_context !== 'string') {throw new Error('CL1 packet scope or completion is invalid.');}
        if (sha256(json.assembled_context) !== json.packet_sha256) {throw new Error('CL1 exact packet hash differs.');}
        const bindings = json.source_bindings;
        if (!Array.isArray(bindings) || !bindings.length || bindings.some(b=>!b || Array.isArray(b) || typeof b !== 'object') || !Array.isArray(json.documents) || new Set(bindings.map((b: JsonObject) => b.source_id)).size !== bindings.length) {throw new Error('CL1 packet source bindings are invalid.');}
        let sessionStart=0;
        for(const binding of bindings){
            if (!binding || typeof binding !== 'object' || typeof binding.source_id !== 'string' || !/^[0-9a-f]{64}$/.test(binding.source_sha256) || !Number.isInteger(binding.revision) || binding.revision < 1 || !Number.isInteger(binding.session_start) || binding.session_start !== sessionStart || !Number.isInteger(binding.session_count) || binding.session_count < 1) {throw new Error('CL1 source session partition is incomplete or ambiguous.');}
            sourcePath(binding.source_id);sessionStart+=binding.session_count;
        }
        if (ids.length && JSON.stringify(bindings.map((b: JsonObject) => b.source_id)) !== JSON.stringify(ids)) {throw new Error('CL1 packet source selection differs.');}
        const raw = Buffer.from(json.assembled_context, 'utf8');
        for (const doc of json.documents) {
            const bound = bindings.find((b: JsonObject) => b.source_id === doc.source_id && b.revision === doc.revision && b.source_sha256 === doc.source_sha256);
            const integers = [doc.session_index, doc.turn_index, doc.start_byte, doc.end_byte, doc.packet_start_byte, doc.packet_end_byte];
            if (!bound || integers.some(n => !Number.isInteger(n) || n < 0) || doc.session_index < bound.session_start || doc.session_index >= bound.session_start + bound.session_count || (doc.offset_basis !== undefined && doc.offset_basis !== 'turn_utf8') || typeof doc.quote !== 'string' || !doc.quote.length || Buffer.byteLength(doc.quote) !== doc.end_byte - doc.start_byte || doc.packet_end_byte > raw.length || doc.packet_end_byte - doc.packet_start_byte !== Buffer.byteLength(doc.quote) || !raw.subarray(doc.packet_start_byte, doc.packet_end_byte).equals(Buffer.from(doc.quote))) {throw new Error('CL1 quote locator or exact packet span is invalid.');}
        }
        const ceiling = ({standard_7k:7000, standard_8k:8192, deep_24k:24000} as JsonObject)[this.options.profile ?? 'standard_8k'];
        if (json.requested_profile !== (this.options.profile ?? 'standard_8k') || json.effective_profile !== json.requested_profile || json.evidence_token_ceiling !== ceiling || !Number.isInteger(json.evidence_token_count) || json.evidence_token_count < 0 || json.evidence_token_count > ceiling) {throw new Error('CL1 evidence profile is inconsistent.');}
        return json;
    }

    async writeDocument(sourceId: string, filename: string, text: string, revision: number, metadata: JsonObject = {}): Promise<JsonObject> {
        sourcePath(sourceId);
        if (!Number.isInteger(revision) || revision < 0 || !text.trim() || !filename || filename.length > 256 || Buffer.byteLength(canonicalJSON(metadata)) > 65536) {throw new Error('Explicit source text, filename, metadata and CAS revision are required.');}
        const {json} = await this.request('POST', '/sources/cl1/v1', {project_id:this.options.projectId,source_id:sourceId,kind:'document',filename,text,expected_revision:revision,metadata});
        return json;
    }

    async deleteSource(sourceId: string, revision: number): Promise<JsonObject> {
        if (!Number.isInteger(revision) || revision < 1) {throw new Error('An exact source revision is required.');}
        const {json} = await this.request('DELETE', sourcePath(sourceId), {project_id:this.options.projectId,expected_revision:revision});
        return json;
    }

}
