import * as vscode from 'vscode';
import * as path from 'path';

let config = vscode.workspace.getConfiguration('vcrpy-cassette-mgr');
let testFileNameStartsWith = config.get('testFileNameStartsWith') as string;
let cassetteDirectoryName = config.get('cassetteDirectoryName') as string;
let vcrDecoratorMatchText = config.get('vcrDecoratorMatchText') as string;

export function activate(context: vscode.ExtensionContext) {
    console.log('vcrpy-cassette-mgr extension is now active!');

    // Listen for configuration changes
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('vcrpy-cassette-mgr')) {
            // The configuration has changed, read the new values
            let config = vscode.workspace.getConfiguration('vcrpy-cassette-mgr');
            testFileNameStartsWith = config.get('testFileNameStartsWith') as string;
            cassetteDirectoryName = config.get('cassetteDirectoryName') as string;
            vcrDecoratorMatchText = config.get('vcrDecoratorMatchText') as string;
            console.log(`Configuration changed, new values: testFileNameStartsWith='${testFileNameStartsWith}', cassetteDirectoryName='${cassetteDirectoryName}', vcrDecoratorMatchText='${vcrDecoratorMatchText}'`);
        }
    }));

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
        if (!path.basename(document.fileName).startsWith(testFileNameStartsWith)) {
            console.log(`Skipping vcr decorator scan, editor filename '${path.basename(document.fileName)}' does not start with '${testFileNameStartsWith}'`);
            return [];
        }

        const workspaceFolderPath = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
        const workspaceFolderURI = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri : null;
        let cassetteDir = '';
        if (workspaceFolderURI) {
            const files = await vscode.workspace.findFiles(`**/${cassetteDirectoryName}/*`, '**/node_modules/**', 1);
            if (files.length > 0) {
                cassetteDir = path.dirname(files[0].fsPath);
                console.log(`'${cassetteDirectoryName}' directory found at path '${cassetteDir}'`);
            } else {
                console.log(`'${cassetteDirectoryName}' directory not found`);
                return [];
            }
        }

        const codeLensesArray: vscode.CodeLens[] = [];
        const docText = document.getText();
        // orginal (?<!# *)(@pytest\.mark\.vcr)(?:.|\n|\r)*?def (\w+)\(
        // have to add regex var inside and escape backslashes
        // so \n|\r)*?def (\w+)\( becomes \\n|\\r)*?def (\\w+)\\(
        let vcrRegex = new RegExp(`(?<!# *)(${vcrDecoratorMatchText})(?:.|\\n|\\r)*?def (\\w+)\\(`, 'g');
        // console.log(vcrRegex);
        let match;
        const promises: Promise<void>[] = [];

        console.log(`Searching for '${vcrDecoratorMatchText}' decorators`);
        while ((match = vcrRegex.exec(docText)) !== null) {
            const vcrTestName = match[2];
            console.log(`Found '${vcrDecoratorMatchText}' on function '${vcrTestName}'`);
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const range = new vscode.Range(startPos, endPos);
            
            // Check if a cassette file exists, add a code lens
            const cassetteFilePath = path.join(cassetteDir, `${vcrTestName}.yaml`);
            // console.log(`Checking for cassette file '${cassetteFilePath}'`);
            promises.push(checkFileAndCreateCodeLens(vcrTestName, cassetteFilePath, range, codeLensesArray));
        }
        console.log(`Decorator search complete`);
        await Promise.all(promises);
        return codeLensesArray;
    }
}

async function checkFileAndCreateCodeLens(vcrTestName: string, cassetteFilePath: string, range: vscode.Range, codeLensesArray: vscode.CodeLens[]) {
    try {
        // Await the stat method to check if the file exists
        await vscode.workspace.fs.stat(vscode.Uri.file(cassetteFilePath));

        console.log(`Cassette found '${cassetteFilePath}'`);
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
        console.log(`Cassette not found '${cassetteFilePath}'`);
        const codeLens = new vscode.CodeLens(range, {
            title: 'No cassette found',
            command: ''
        });
        codeLensesArray.push(codeLens);
    }
}
