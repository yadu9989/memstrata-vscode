// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Called It Inc.
import * as vscode from 'vscode';
import { basename } from 'node:path';
import { CL1HttpClient, CL1Options, secretKey, sourcePath, validateOptions } from './cl1Client';
import { SidebarViewProvider } from './sidebarView';
import { LOCAL_CL1, pairLocal } from './localPairing';

export function activate(context: vscode.ExtensionContext): void {
    if (!vscode.workspace.isTrusted) {return;}
    const workspaceUri = () => vscode.workspace.workspaceFolders?.[0]?.uri;
    const config = () => vscode.workspace.getConfiguration('memstrataCl1', workspaceUri());
    const options = (): CL1Options => validateOptions({
        baseUrl: config().get<string>('baseUrl', 'http://127.0.0.1:9101'),
        projectId: config().get<string>('projectId', ''),
        sourceIds: config().get<string[]>('sourceIds', []),
        profile: config().get<string>('profile', 'standard_8k'),
    });
    const requireLocalWindow = () => {
        if (vscode.env.remoteName) {
            throw new Error('MemStrata CL1 Workspace works only in a local VS Code window, not in a remote, WSL or Codespaces window.');
        }
    };
    const grantKeyState = 'memstrataCl1.lastGrantKey';
    const pairedState = 'memstrataCl1.pairedLocal';
    const pairedKey = secretKey(LOCAL_CL1) + '.paired';
    const client = (write = false) => {
        requireLocalWindow();
        if (workspaceUri() && vscode.workspace.isTrusted && context.workspaceState.get<boolean>(pairedState)) {
            if (write) throw new Error('The local pairing is read-only. Use an explicitly provisioned write grant.');
            return new CL1HttpClient(LOCAL_CL1, {get: () => context.secrets.get(pairedKey)});
        }
        if (!workspaceUri() || !vscode.workspace.isTrusted || !config().get<boolean>('enabled', false)) {
            throw new Error('Enable CL1 explicitly in a trusted workspace first.');
        }
        return new CL1HttpClient(options(), context.secrets);
    };
    const provider = new SidebarViewProvider(client);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('memstrataCl1.sidebar', provider));
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    status.text = '$(database) CL1: owner commands';
    status.command = 'memstrataCl1.refresh';
    status.tooltip = 'MemStrata CL1: refresh source status';
    status.show();
    context.subscriptions.push(status);
    const command = (name: string, handler: (...args:any[]) => Promise<void>) => context.subscriptions.push(
        vscode.commands.registerCommand('memstrataCl1.' + name, async (...args:any[]) => {
            try {await handler(...args);} catch (error) {
                await vscode.window.showErrorMessage(error instanceof Error ? error.message : 'CL1 operation did not complete.');
            }
        }));
    const display = async (content: string, language = 'json') => {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({content,language}), {preview:true});
    };
    const sourceId = async (id?: string) => {
        const value = id ?? await vscode.window.showInputBox({prompt:'Stable permitted source ID',ignoreFocusOut:true});
        if (value === undefined) {return undefined;}
        sourcePath(value);
        return value;
    };

    let pairing = false;
    command('connectLocal', async () => {
        requireLocalWindow();
        if (!workspaceUri() || !vscode.workspace.isTrusted) {throw new Error('Open a trusted local workspace first.');}
        if (pairing) return;
        pairing = true;
        try {
            if (await context.secrets.get(pairedKey)) throw new Error('Remove the stored local pairing before connecting again.');
            const token = await pairLocal(async (url, code) => {
                void vscode.window.showInformationMessage('Match this VS Code pairing code in the local Assistant: ' + code);
                return vscode.env.openExternal(vscode.Uri.parse(url));
            });
            await context.secrets.store(pairedKey, token);
            await context.workspaceState.update(pairedState, true);
            await provider.refresh();
        } finally {pairing = false;}
    });
    command('configure', async () => {
        requireLocalWindow();
        if (!workspaceUri() || !vscode.workspace.isTrusted) {throw new Error('Open a trusted local workspace first.');}
        const baseUrl = await vscode.window.showInputBox({prompt:'Provisioned CL1 service URL',value:config().get('baseUrl','http://127.0.0.1:9101')});
        if (baseUrl === undefined) {return;}
        const projectId = await vscode.window.showInputBox({prompt:'Project bound to your grant',value:config().get('projectId','')});
        if (projectId === undefined) {return;}
        const declared = validateOptions({baseUrl,projectId});
        const token = await vscode.window.showInputBox({prompt:'Provisioned scoped CL1 grant, stored in VS Code SecretStorage',password:true,ignoreFocusOut:true});
        if (token === undefined) {return;}
        if (!/^cl1_[A-Za-z0-9_-]+$/.test(token) || token.length > 128) {throw new Error('A scoped CL1 grant is required.');}
        const confirm = await vscode.window.showInformationMessage('Enable owner-invoked CL1 source commands for this workspace? Files are imported only by an explicit command.',{modal:true},'Enable workspace');
        if (confirm !== 'Enable workspace') {return;}
        await context.secrets.store(secretKey(declared),token);
        await context.workspaceState.update(grantKeyState,secretKey(declared));
        await config().update('baseUrl',declared.baseUrl,vscode.ConfigurationTarget.WorkspaceFolder);
        await config().update('projectId',declared.projectId,vscode.ConfigurationTarget.WorkspaceFolder);
        await config().update('enabled',true,vscode.ConfigurationTarget.WorkspaceFolder);
        await context.workspaceState.update(pairedState,false);
        await provider.refresh();
    });
    command('clearGrant', async () => {
        if (context.workspaceState.get<boolean>(pairedState)) {
            await context.secrets.delete(pairedKey);
            await context.workspaceState.update(pairedState, false);
            await vscode.window.showInformationMessage('Removed the stored local pairing. Revoke the app grant in the Assistant to end access at the service.');
            return;
        }
        // The stored grant is keyed by service URL and project, not by workspace. Remove the key for
        // the current settings and the key written by the last Enable command, and say truthfully
        // whether anything was removed.
        const keys = new Set<string>();
        const remembered = context.workspaceState.get<string>(grantKeyState);
        if (remembered) {keys.add(remembered);}
        try {keys.add(secretKey(options()));} catch { /* Invalid settings: only the remembered key can be cleared. */ }
        let removed = 0;
        for (const key of keys) {
            if (await context.secrets.get(key)) {await context.secrets.delete(key); removed++;}
        }
        await context.workspaceState.update(grantKeyState,undefined);
        await config().update('enabled',false,vscode.ConfigurationTarget.WorkspaceFolder);
        await vscode.window.showInformationMessage(removed
            ? `Removed ${removed} stored grant${removed === 1 ? '' : 's'} for this service URL and project. Other workspaces that use the same URL and project lose it too. Revoke the service grant separately to deny other holders.`
            : 'No stored grant was found for the current or last-configured service URL and project; nothing was removed. Revoke the service grant separately to deny other holders.');
    });
    command('refresh', async () => {client(); await provider.refresh();});
    command('context', async () => {
        const current = client();
        const question = await vscode.window.showInputBox({prompt:'Question for permitted source evidence',ignoreFocusOut:true});
        if (question === undefined) {return;}
        const packet = await current.context(question);
        await display(packet.assembled_context,'plaintext');
        await vscode.window.showInformationMessage(`Exact UTF-8 packet ${packet.packet_sha256}. Evidence ${packet.evidence_token_count}/${packet.evidence_token_ceiling} service tokens. Model delivery remains unverified.`);
    });
    command('inspect', async (id?:string) => {
        const current = client(); const source = await sourceId(id); if (source === undefined) {return;}
        await display(JSON.stringify(await current.fetchSource(source),null,2));
    });
    command('import', async () => {
        const current = client(true); const editor = vscode.window.activeTextEditor;
        if (!editor) {throw new Error('Open the source text in an editor first.');}
        const source = await sourceId(); if (source === undefined) {return;}
        const text = editor.document.getText();
        const confirm = await vscode.window.showInformationMessage(`Import ${basename(editor.document.fileName)} (${Buffer.byteLength(text,'utf8')} bytes of editor text) into source ${source} on ${current.options.baseUrl}?`,{modal:true},'Import source');
        if (confirm !== 'Import source') {return;}
        const result = await current.writeDocument(source,basename(editor.document.fileName),text,0,{origin:'vscode_owner_command',language:editor.document.languageId});
        await display(JSON.stringify(result,null,2)); await provider.refresh();
    });
    command('correct', async (id?:string) => {
        const current = client(true); const editor = vscode.window.activeTextEditor;
        if (!editor) {throw new Error('Open the replacement source text in an editor first.');}
        const source = await sourceId(id); if (source === undefined) {return;}
        const snapshot = await current.fetchSource(source);
        const text = editor.document.getText();
        const confirm = await vscode.window.showWarningMessage(`Replace source ${source} revision ${snapshot.revision} with ${basename(editor.document.fileName)} (${Buffer.byteLength(text,'utf8')} bytes of editor text) on ${current.options.baseUrl}?`,{modal:true},'Replace source');
        if (confirm !== 'Replace source') {return;}
        const result = await current.writeDocument(source,basename(editor.document.fileName),text,snapshot.revision,snapshot.metadata ?? {});
        await display(JSON.stringify(result,null,2)); await provider.refresh();
    });
    command('delete', async (id?:string) => {
        const current = client(true); const source = await sourceId(id); if (source === undefined) {return;}
        const snapshot = await current.fetchSource(source);
        const confirm = await vscode.window.showWarningMessage(`Delete source ${source} revision ${snapshot.revision}? Active access is removed; retained backups may remain.`,{modal:true},'Delete source');
        if (confirm !== 'Delete source') {return;}
        await display(JSON.stringify(await current.deleteSource(source,snapshot.revision),null,2)); await provider.refresh();
    });
}

export function deactivate(): void { /* No watcher, daemon, session-close write or background poll exists. */ }
