import * as vscode from 'vscode';
import * as path from 'path';

let scanFileNamePrefix = 'test';
let vcrDecoratorTextForRegEx = '@pytest.mark.vcr';

export function activate(context: vscode.ExtensionContext) {
    console.log('vcrpy-cassette-mgr extension is now active!');

    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ language: 'python' }, new VcrCassMgrCodeLensProvider()));
    console.log('Activated vcrpy-cassette-mgr code lens provider!');

    context.subscriptions.push(vscode.commands.registerCommand('vcrpy-cassette-mgr.openCassette', (uri: vscode.Uri) => {
        vscode.window.showTextDocument(uri);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vcrpy-cassette-mgr.deleteCassette', async (uri: vscode.Uri) => {
        const result = await vscode.window.showWarningMessage(`Are you sure you want to delete this cassette?\n${uri.path}`, 'Yes', 'No');
        if (result === 'Yes') {
            await vscode.workspace.fs.delete(uri);
            vscode.window.showInformationMessage('Deleted ' + uri.path);
        }
    }));
}

class VcrCassMgrCodeLensProvider implements vscode.CodeLensProvider {
    async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
        // check if editor filename starts with scanFileNamePrefix
        if (!path.basename(document.fileName).startsWith(scanFileNamePrefix)) {
            console.log(`Skipping vcr decorator scan, editor filename '${path.basename(document.fileName)}' does not start with '${scanFileNamePrefix}'`);
            return [];
        }
        const codeLensesArray: vscode.CodeLens[] = [];
        const docText = document.getText();
        const vcrRegex = /(?<!# *)(@pytest\.mark\.vcr)(?:.|\n|\r)*?def (\w+)\(/g;
        let match;
        const promises: Promise<void>[] = [];

        console.log(`Searching for '${vcrDecoratorTextForRegEx}' decorators`);
        while ((match = vcrRegex.exec(docText)) !== null) {
            const vcrTestName = match[2];
            console.log(`Found '${vcrDecoratorTextForRegEx}' on function '${vcrTestName}'`);
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const range = new vscode.Range(startPos, endPos);
            
            // Check if a cassette file exists, add a code lens
            const workspaceFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
            const cassetteFilePath = path.join(workspaceFolder, 'tests', 'cassettes', `${vcrTestName}.yaml`);
            promises.push(checkFileAndCreateCodeLens(vcrTestName, cassetteFilePath, range, codeLensesArray));
        }
        await Promise.all(promises);
        return codeLensesArray;
    }
}

async function checkFileAndCreateCodeLens(vcrTestName: string, cassetteFilePath: string, range: vscode.Range, codeLensesArray: vscode.CodeLens[]) {
    try {
        // Await the stat method to check if the file exists
        await vscode.workspace.fs.stat(vscode.Uri.file(cassetteFilePath));

        console.log(`Cassette found for '${vcrTestName}'`);
        const openCommand = new vscode.CodeLens(range, {
            title: 'Open cassette',
            command: 'vcrpy-cassette-mgr.openCassette',
            arguments: [vscode.Uri.file(cassetteFilePath)]
        });
        codeLensesArray.push(openCommand);
        const deleteCommand = new vscode.CodeLens(range, {
            title: 'Delete cassette',
            command: 'vcrpy-cassette-mgr.deleteCassette',
            arguments: [vscode.Uri.file(cassetteFilePath)]
        });
        codeLensesArray.push(deleteCommand);

    } catch (error) {
        console.log(`Cassette not found for '${vcrTestName}'`);
        const codeLens = new vscode.CodeLens(range, {
            title: 'No cassette found',
            command: ''
        });
        codeLensesArray.push(codeLens);
    }
}
