// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';

let vcrDecorationType: vscode.TextEditorDecorationType;

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "vcrpy-mgr" is now active!');

    let command1 = vscode.commands.registerCommand('vcrpy-mgr.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from vcrpy-mgr and Phill!');
    });

    context.subscriptions.push(command1);

    vcrDecorationType = vscode.window.createTextEditorDecorationType({
        gutterIconPath: vscode.Uri.file(path.join(context.extensionPath, 'src', 'cassette-fill.svg')),
        gutterIconSize: 'contain',
        // after: {
        //     contentText: 'Possible cassette',
        //     margin: '0 0 0 2em',
        //     color: '#ff8040',
        // },
    });

    updateDecorations(vscode.window.activeTextEditor, context);

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
    	updateDecorations(editor, context);
    }));

    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
    	updateDecorations(vscode.window.activeTextEditor, context);
    }));

    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ language: 'python' }, new VcrCodeLensProvider()));
    console.log('Activated vcrpy-mgr code lens provider');

    context.subscriptions.push(vscode.commands.registerCommand('vcrpy-mgr.openCassette', (uri: vscode.Uri) => {
        vscode.window.showTextDocument(uri);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vcrpy-mgr.deleteCassette', async (uri: vscode.Uri) => {
        const result = await vscode.window.showWarningMessage('Are you sure you want to delete this cassette?\n' + uri.path, 'Yes', 'No');
        if (result === 'Yes') {
            await vscode.workspace.fs.delete(uri);
            vscode.window.showInformationMessage('Deleted ' + uri.path);
        }
    }));
}

function updateDecorations(editor?: vscode.TextEditor, context?: vscode.ExtensionContext) {
    if (!editor || !context) {
        return;
    }
    if (editor.document.languageId !== 'python') {
        return;
    }
    // ? this isn't working
    // if (!editor.document.fileName.startsWith('test')) {
    // 	return;
    // }
    console.log('Updating vcrpy decorations');

    const text = editor.document.getText();
    
    const vcrDecorations: vscode.DecorationOptions[] = [];
    const regex = /@pytest\.mark\.vcr/g;
    let match;
    while (match = regex.exec(text)) {
        const startPos = editor.document.positionAt(match.index+1);
        const endPos = editor.document.positionAt(match.index + match[0].length);
        const decoration = { range: new vscode.Range(startPos, endPos) };
        vcrDecorations.push(decoration);
        console.log('Found pytest vcrpy decorator');
    }

    editor.setDecorations(vcrDecorationType, vcrDecorations);
    console.log('Updated vcrpy decorations');
}

class VcrCodeLensProvider implements vscode.CodeLensProvider {
    async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
        // check if editor filename starts with 'test'
        if (!path.basename(document.fileName).startsWith('test')) {
            console.log('Skipping vcr scan, editor filename does not start with "test" ' + path.basename(document.fileName));
            return [];
        }
        const vcrCodeLenses: vscode.CodeLens[] = [];
        const text = document.getText();
        const regex = /(?<!# *)(@pytest\.mark\.vcr)(?:.|\n|\r)*?def (\w+)\(/g;
        let match;
        const promises: Promise<void>[] = [];

        console.log('Searching for @pytest.mark.vcr decorators');
        while ((match = regex.exec(text)) !== null) {
            const functionName = match[2];
            console.log('Found @pytest.mark.vcr, def name: ' + functionName);
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const range = new vscode.Range(startPos, endPos);
            
            // Check if a cassette file exists, add a code lens
            const workspaceFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
            const cassetteFilePath = path.join(workspaceFolder, 'tests', 'cassettes', `${functionName}.yaml`);
            promises.push(checkFileAndCreateCodeLens(functionName, cassetteFilePath, range, vcrCodeLenses));
        }
        await Promise.all(promises);
        return vcrCodeLenses;
    }
}

async function checkFileAndCreateCodeLens(functionName: string, cassetteFilePath: string, range: vscode.Range, vcrCodeLenses: vscode.CodeLens[]) {
    try {
        // Await the stat method to check if the file exists
        await vscode.workspace.fs.stat(vscode.Uri.file(cassetteFilePath));

        console.log('Found cassette file for ' + functionName);
        const openCommand = new vscode.CodeLens(range, {
            title: 'Open cassette',
            command: 'vcrpy-mgr.openCassette',
            arguments: [vscode.Uri.file(cassetteFilePath)]
        });
        vcrCodeLenses.push(openCommand);
        const deleteCommand = new vscode.CodeLens(range, {
            title: 'Delete cassette',
            command: 'vcrpy-mgr.deleteCassette',
            arguments: [vscode.Uri.file(cassetteFilePath)]
        });
        vcrCodeLenses.push(deleteCommand);

    } catch (error) {
        console.log('No cassette file found for ' + functionName);
        const codeLens = new vscode.CodeLens(range, {
            title: 'No cassette found',
            command: 'vcrpy-mgr.helloWorld',
            arguments: [vscode.Uri.file(cassetteFilePath)]
        });
        vcrCodeLenses.push(codeLens);
    }
}
