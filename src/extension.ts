import * as vscode from 'vscode';
import * as path from 'path';

let testFileNameStartsWith: string = 'test_';
let cassetteDirectoryName: string = 'cassettes';
let vcrDecoratorMatchText: string = '@pytest.mark.vcr';
let cassetteDir: string = '';


async function loadConfigOptions() {
    const config = vscode.workspace.getConfiguration('vcrpy-cassette-mgr');
    testFileNameStartsWith = config.get('testFileNameStartsWith') as string;
    cassetteDirectoryName = config.get('cassetteDirectoryName') as string;
    vcrDecoratorMatchText = config.get('vcrDecoratorMatchText') as string;
    console.log(`Configuration loaded, values: testFileNameStartsWith='${testFileNameStartsWith}', cassetteDirectoryName='${cassetteDirectoryName}', vcrDecoratorMatchText='${vcrDecoratorMatchText}'`);
    cassetteDir = await scanForCassetteDirectory(cassetteDirectoryName);
}


export async function activate(context: vscode.ExtensionContext) {
    console.log('vcrpy-cassette-mgr extension is now active!');

    await loadConfigOptions();

    // Listen for configuration changes
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async e => {
        if (e.affectsConfiguration('vcrpy-cassette-mgr')) {
            await loadConfigOptions();
        }
    }));

    // Code Lens Provider
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ language: 'python' }, new VcrCassMgrCodeLensProvider()));
    console.log('Activated vcrpy-cassette-mgr code lens provider!');

    // Open Cassette Command
    context.subscriptions.push(vscode.commands.registerCommand('vcrpy-cassette-mgr.openCassette', (uri: vscode.Uri) => {
        vscode.window.showTextDocument(uri);
    }));

    // Delete Cassette Command
    context.subscriptions.push(vscode.commands.registerCommand('vcrpy-cassette-mgr.deleteCassette', async (uri: vscode.Uri) => {
        const result = await vscode.window.showWarningMessage(`Are you sure you want to delete this cassette?\n${uri.path}`, 'Yes', 'No');
        if (result === 'Yes') {
            await vscode.workspace.fs.delete(uri);
            vscode.window.showInformationMessage('Deleted ' + uri.path);
        }
    }));

    // Delete Cassettes Current File Command
    context.subscriptions.push(vscode.commands.registerCommand('vcrpy-cassette-mgr.deleteCassettesCurrentFile', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const vcrDecoratorsArray = searchForVcrDecorators(editor.document);
            const cassettePromises = vcrDecoratorsArray.map(async (vcrDecorator) => {
                const cassetteFilePath = path.join(cassetteDir, `${vcrDecorator.vcrTestName}.yaml`);
                const exists = await checkFile(cassetteFilePath);
                if (exists) {
                    return cassetteFilePath;
                }
            });
            const cassettesArray = await Promise.all(cassettePromises);
            // delete empty strings from array
            cassettesArray.forEach((element, index) => {
                if (element === undefined) {
                    cassettesArray.splice(index, 1);
                }
            });
            console.log(`Found ${cassettesArray.length} cassettes for ${editor.document.fileName}`);
            const result = await vscode.window.showWarningMessage(`Are you sure you want to delete ${cassettesArray.length} cassettes for this file?`, 'Yes', 'No');
            if (result === 'Yes') {
                const deletePromises = cassettesArray.map(async (cassetteFilePath) => {
                    if (cassetteFilePath) {
                        await vscode.workspace.fs.delete(vscode.Uri.file(cassetteFilePath));
                    }
                });
                await Promise.all(deletePromises);
                vscode.window.showInformationMessage(`Deleted ${cassettesArray.length} cassettes for this file`);
            }
        }
    }));

    // Delete Cassettes Workspace Command
    context.subscriptions.push(vscode.commands.registerCommand('vcrpy-cassette-mgr.deleteCassettesAll', async () => {
        if (cassetteDir === '') {
            vscode.window.showErrorMessage(`'${cassetteDirectoryName}' directory not found`);
            return;
        }
        const cassettes = await scanForCassettesInDirectory(cassetteDir, testFileNameStartsWith);
        const result = await vscode.window.showWarningMessage(`Are you sure you want to delete ${cassettes.length} cassettes in the workspace?`, 'Yes', 'No');
        if (result === 'Yes') {
            const deletePromises = cassettes.map(async (cassette) => {
                await vscode.workspace.fs.delete(cassette);
            });
            await Promise.all(deletePromises);
            vscode.window.showInformationMessage(`Deleted ${cassettes.length} cassettes in the workspace`);
        }
    }));
}


async function scanForCassetteDirectory(dirName: string): Promise<string> {
    let cassetteDir = '';
    const workspaceFolderPath = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
    const workspaceFolderURI = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri : null;
    if (workspaceFolderURI) {
        const files = await vscode.workspace.findFiles(`**/${cassetteDirectoryName}/*`, '**/node_modules/**', 1);
        if (files.length > 0) {
            cassetteDir = path.dirname(files[0].fsPath);
            console.log(`'${cassetteDirectoryName}' directory found at path '${cassetteDir}'`);
            return cassetteDir;
        } else {
            console.log(`'${cassetteDirectoryName}' directory not found`);
            return '';
        }
    }
    return '';
}


async function scanForCassettesInDirectory(cassetteDir: string, testFileNameStartsWith: string): Promise<vscode.Uri[]> {
    const pattern = new vscode.RelativePattern(cassetteDir, `${testFileNameStartsWith}*.yaml`);
    console.log(`Searching for all cassettes in '${cassetteDir}' with pattern '${pattern.pattern}'`);
    const yamlFiles = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 5000);
    console.log(`Found ${yamlFiles.length} cassettes`);
    return yamlFiles;
}


interface VcrDecorator {
    vcrTestName: string;
    range: vscode.Range;
}


class VcrCassMgrCodeLensProvider implements vscode.CodeLensProvider {
    async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
        let codeLensesArray: vscode.CodeLens[] = [];
        // check if editor filename starts with testFileNameStartsWith
        if (!path.basename(document.fileName).startsWith(testFileNameStartsWith)) {
            console.log(`Skipping vcr decorator scan, '${path.basename(document.fileName)}' does not start with '${testFileNameStartsWith}'`);
            return [];
        }
        if (cassetteDir === '') {
            console.log(`Skipping vcr decorator scan, '${cassetteDirectoryName}' is empty`);
            return [];
        }

        const vcrDecoratorsArray = searchForVcrDecorators(document);
        let cassetteCount = 0;

        const codeLensesPromises = vcrDecoratorsArray.map(async (vcrDecorator) => {
            const cassetteFilePath = path.join(cassetteDir, `${vcrDecorator.vcrTestName}.yaml`);
            const exists = await checkFile(cassetteFilePath);
            if (exists) {
                cassetteCount++;
                const openCommand = new vscode.CodeLens(vcrDecorator.range, {
                    title: 'Open cassette',
                    command: 'vcrpy-cassette-mgr.openCassette',
                    arguments: [vscode.Uri.file(cassetteFilePath)]
                });
                const deleteCommand = new vscode.CodeLens(vcrDecorator.range, {
                    title: 'Delete cassette',
                    command: 'vcrpy-cassette-mgr.deleteCassette',
                    arguments: [vscode.Uri.file(cassetteFilePath)]
                });
                return [openCommand, deleteCommand];
            } else {
                const codeLens = new vscode.CodeLens(vcrDecorator.range, {
                    title: 'No cassette found',
                    command: ''
                });
                return [codeLens];
            }
        });
        Promise.all(codeLensesPromises).then(() => {
            console.log(`Found ${cassetteCount} cassettes`);
        });
    
        const codeLensesArrays = await Promise.all(codeLensesPromises);
        codeLensesArray = codeLensesArrays.flat();
    
        // console.log(codeLensesArray);
        console.log(`Returning ${codeLensesArray.length} code lenses`);
        return codeLensesArray;
    }
}


/**
 * Searches for VCR decorators in the given text document.
 * 
 * @param document - The text document to search in.
 * @returns An array of objects representing the found VCR decorators, each containing the VCR test name and the range of the decorator in the document.
 */
function searchForVcrDecorators(document: vscode.TextDocument): VcrDecorator[] {
    const vcrDecoratorsArray = [];
    const docText = document.getText();
    // orginal (?<!# *)(@pytest\.mark\.vcr)(?:.|\n|\r)*?def (\w+)\(
    // have to add regex var inside and escape backslashes
    // so \n|\r)*?def (\w+)\( becomes \\n|\\r)*?def (\\w+)\\(
    let vcrRegex = new RegExp(`(?<!# *)(${vcrDecoratorMatchText})(?:.|\\n|\\r)*?def (\\w+)\\(`, 'g');
    // console.log(vcrRegex);
    let match;

    console.log(`Searching for '${vcrDecoratorMatchText}' decorators`);
    while ((match = vcrRegex.exec(docText)) !== null) {
        const vcrTestName = match[2];
        // console.log(`Found '${vcrDecoratorMatchText}' on function '${vcrTestName}'`);
        const startPos = document.positionAt(match.index);
        const endPos = document.positionAt(match.index + match[0].length);
        const range = new vscode.Range(startPos, endPos);
        
        vcrDecoratorsArray.push({"vcrTestName": vcrTestName, "range": range});
    }
    console.log(`Found ${vcrDecoratorsArray.length} decorators`);
    // console.log(vcrDecoratorsArray);
    return vcrDecoratorsArray;
}


async function checkFile(cassetteFilePath: string): Promise<boolean> {
    try {
        // console.log(`Checking for cassette file '${cassetteFilePath}'`);

        // Await the stat method to check if the file exists
        await vscode.workspace.fs.stat(vscode.Uri.file(cassetteFilePath));

        // console.log(`Cassette found '${cassetteFilePath}'`);
        return true;
    } catch (error) {
        // console.log(`Cassette not found '${cassetteFilePath}'`);
        return false;
    }
}
