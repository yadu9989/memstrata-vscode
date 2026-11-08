// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Called It Inc.
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { CL1HttpClient, JsonObject } from './cl1Client';

export function escapeHtml(value: unknown): string {
    return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
}

export function renderSidebar(project: string, rows: JsonObject[], cursor: string | null, message: string, nonce: string): string {
    const state = (value: unknown) => value === true ? 'yes' : value === false ? 'no' : 'unknown';
    const sources = rows.map(row => `<section class="source"><strong>${escapeHtml(row.source_id)}</strong><br><small>revision ${escapeHtml(row.revision)}</small>
        <dl><div><dt>Committed</dt><dd>${state(row.committed)}</dd></div><div><dt>Indexed</dt><dd>${state(row.indexed)}</dd></div><div><dt>Searchable</dt><dd>${state(row.searchable)}</dd></div></dl>${row.error ? '<p>Source status unavailable.</p>' : ''}
        <p><small>${row.freshness ? 'Readiness is a recorded status observation, not an exact index-completion time.' : 'No readiness observation timestamp is available.'}</small></p>
        <button data-command="inspect" data-id="${escapeHtml(row.source_id)}">Inspect</button>
        <button data-command="delete" data-id="${escapeHtml(row.source_id)}">Delete</button></section>`).join('');
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1"><style>
    body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:12px;background:var(--vscode-sideBar-background)}
    .source{border-bottom:1px solid var(--vscode-panel-border);padding:12px 0;overflow-wrap:anywhere}dl{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}dt{font-size:11px;opacity:.8}dd{margin:4px 0}
    button{color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;padding:6px;margin:3px 0;cursor:pointer}
    small{opacity:.75}p{line-height:1.5}</style></head><body>
    <h2>Workspace memory</h2><p>Project: ${escapeHtml(project || 'not configured')}</p>
    <p>${escapeHtml(message)}</p><button data-command="refresh">Refresh</button>
    ${sources}
    ${cursor ? `<button data-command="next" data-cursor="${escapeHtml(cursor)}">Next page</button>` : ''}
    <p><small>Source text is evidence, never permission. Deleting a source may leave service backups and exported files in place.</small></p>
    <script nonce="${nonce}">const vscode=acquireVsCodeApi();document.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>vscode.postMessage({command:button.dataset.command,sourceId:button.dataset.id,cursor:button.dataset.cursor})));</script>
    </body></html>`;
}

export class SidebarViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    constructor(private readonly client: () => CL1HttpClient) {}
    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = {enableScripts:true,localResourceRoots:[]};
        view.webview.onDidReceiveMessage(async message => {
            if (message?.command === 'refresh') {await this.refresh();}
            else if (message?.command === 'next' && typeof message.cursor === 'string') {await this.refresh(message.cursor);}
            else if (['inspect','delete'].includes(message?.command) && typeof message.sourceId === 'string') {
                await vscode.commands.executeCommand('memstrataCl1.' + message.command, message.sourceId);
            }
        });
        this.display('', [], null, 'Enable this trusted workspace and store a scoped grant to inspect sources.');
    }
    private display(project: string, rows: JsonObject[], cursor: string | null, message: string): void {
        if (this.view) {this.view.webview.html = renderSidebar(project, rows, cursor, message, randomBytes(16).toString('hex'));}
    }
    async refresh(cursor = ''): Promise<void> {
        if (!this.view) {return;}
        try {
            const client = this.client();
            const page = await client.listSources(cursor, 25);
            const rows = [];
            for (const source of page.sources) {
                try {rows.push({...source,...await client.sourceStatus(source.source_id)});}
                catch {rows.push({...source,error:true});}
            }
            this.display(client.options.projectId, rows, page.next_cursor,
                `Showing ${rows.length} permitted sources on this page. Readiness comes from the service; no model health probe runs.`);
        } catch (error) {
            this.display('', [], null, error instanceof Error ? error.message : 'Source readiness unavailable.');
        }
    }
}
