import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as util from 'util';

const readdir = util.promisify(fs.readdir);

let testFileNameStartsWith: string = 'test_';
let cassetteDirectoryName: string = 'cassettes';
let vcrDecoratorMatchText: string = '@pytest.mark.vcr';
let deleteConfirmation: number = 3;
let cassetteButtonOpen: boolean = true;
let cassetteButtonDelete: boolean = true;
let cassetteDir: string = '';


async function loadConfigOptions() {
    const config = vscode.workspace.getConfiguration('vcrpy-cassette-mgr');
    testFileNameStartsWith = config.get('testFileNameStartsWith') as string;
    cassetteDirectoryName = config.get('cassetteDirectoryName') as string;
    vcrDecoratorMatchText = config.get('vcrDecoratorMatchText') as string;
    deleteConfirmation = config.get('deleteConfirmation') as number;
    cassetteButtonOpen = config.get('cassetteButtonOpen') as boolean;
    cassetteButtonDelete = config.get('cassetteButtonDelete') as boolean;
    console.log(`vcrpy-cassette-mgr configuration loaded, values: testFileNameStartsWith='${testFileNameStartsWith}', cassetteDirectoryName='${cassetteDirectoryName}', vcrDecoratorMatchText='${vcrDecoratorMatchText}', deleteConfirmation='${deleteConfirmation}', cassetteButtonOpen='${cassetteButtonOpen}', cassetteButtonDelete='${cassetteButtonDelete}'`);
    cassetteDir = await scanForCassetteDirectory(cassetteDirectoryName);
}


export async function activate(context: vscode.ExtensionContext) {
    console.log('vcrpy-cassette-mgr extension is now active!');
    let codeLensProviderDisposable: vscode.Disposable;

    await loadConfigOptions();

    // Listen for configuration changes
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async e => {
        if (e.affectsConfiguration('vcrpy-cassette-mgr')) {
            await loadConfigOptions();
        }
    }));

    // Create the cassetteCounter status bar item
    let cassetteCounter = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    cassetteCounter.show();
    context.subscriptions.push(cassetteCounter);

    // Update the visibility of the cassetteCounter when the active editor changes
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && editor.document.languageId === 'python') {
            cassetteCounter.show();
        } else {
            cassetteCounter.hide();
        }
    }));

    // Show the cassetteCounter if a Python file is currently open
    if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.languageId === 'python') {
        cassetteCounter.show();
    }

    // Code Lens Provider
    let codeLensProvider = new VcrCassMgrCodeLensProvider(cassetteCounter);
    codeLensProviderDisposable = vscode.languages.registerCodeLensProvider({ language: 'python' }, codeLensProvider);
    context.subscriptions.push(codeLensProviderDisposable);
    console.log('Activated vcrpy-cassette-mgr code lens provider!');

    // Open Cassette(s) Command
    context.subscriptions.push(vscode.commands.registerCommand('vcrpy-cassette-mgr.openCassette', (uris: vscode.Uri[]) => {
        for (const uri of uris) {
            // must use preview: false to open multiple files
            vscode.window.showTextDocument(uri, { preview: false });
        }
    }));

    // Delete Cassette(s) Command
    context.subscriptions.push(vscode.commands.registerCommand('vcrpy-cassette-mgr.deleteCassette', async (uris: vscode.Uri[]) => {
        let deleteConfirmationResult = undefined;
        // if deleteConfirmation setting is 3 (individual test cassette deletion confirm), ask for confirmation
        if (deleteConfirmation === 3) {
            deleteConfirmationResult = await vscode.window.showWarningMessage(`Are you sure you want to delete ${uris.length} cassette(s)?\n${uris.map(uri => uri.path).join('\n')}`, 'Yes', 'No');
        } else {
            deleteConfirmationResult = 'Yes';
        }
        if (deleteConfirmationResult === 'Yes') {
            for (const uri of uris) {
                await vscode.workspace.fs.delete(uri);
                vscode.window.showInformationMessage('Deleted ' + uri.path);
            }
            deleteConfirmationResult = undefined;
            // Refresh code lenses
            codeLensProviderDisposable.dispose();
            codeLensProviderDisposable = vscode.languages.registerCodeLensProvider({ language: 'python' }, codeLensProvider);
            context.subscriptions.push(codeLensProviderDisposable);
        }
    }));

    // Delete Cassettes Current File Command
    context.subscriptions.push(vscode.commands.registerCommand('vcrpy-cassette-mgr.deleteCassettesCurrentFile', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            // search for vcr decorators in the current file
            const vcrDecoratorsArray = searchForVcrDecorators(editor.document);
            
            // iterate through each vcr decorator
            const cassettePromises = vcrDecoratorsArray.map(async (vcrDecorator) => {
                // look for matching cassettes based on vcrDecorator.vcrTestName
                const cassetteDirPath = path.join(cassetteDir);
                const files = await readdir(cassetteDirPath);
                const matchingFiles = files.filter(file => 
                    (file.startsWith(`${vcrDecorator.vcrTestName}.`) || file.startsWith(`${vcrDecorator.vcrTestName}[`)) 
                    && file.endsWith('.yaml')
                );
                return matchingFiles.map(file => vscode.Uri.file(path.join(cassetteDir, file)));
            });
            const cassettesArray = (await Promise.all(cassettePromises)).flat();
            console.log(`Found ${cassettesArray.length} cassettes for ${editor.document.fileName}`);

            // if cassettesArray.length is 0 or undefined, show message and return
            if (cassettesArray.length === 0) {
                vscode.window.showInformationMessage(`No cassettes found for this file`);
                return;
            }

            let deleteConfirmationResult = undefined;
            // if deleteConfirmation is 2 or higher, ask for confirmation
            if (deleteConfirmation >= 2) {
                deleteConfirmationResult = await vscode.window.showWarningMessage(`Are you sure you want to delete ${cassettesArray.length} cassettes for this file?`, 'Yes', 'No');
            } else {
                deleteConfirmationResult = 'Yes';
            }
            if (deleteConfirmationResult === 'Yes') {
                const deletePromises = cassettesArray.map(async (cassetteUriFile) => {
                    if (cassetteUriFile) {
                        await vscode.workspace.fs.delete(cassetteUriFile);
                    }
                });
                await Promise.all(deletePromises);
                vscode.window.showInformationMessage(`Deleted ${cassettesArray.length} cassettes for this file`);
                deleteConfirmationResult = undefined;
                // Refresh code lenses
            codeLensProviderDisposable.dispose();
            codeLensProviderDisposable = vscode.languages.registerCodeLensProvider({ language: 'python' }, codeLensProvider);
            context.subscriptions.push(codeLensProviderDisposable);
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
        let deleteConfirmationResult = undefined;
        // if deleteConfirmation is 1 or higher, ask for confirmation
        if (deleteConfirmation >= 1) {
            deleteConfirmationResult = await vscode.window.showWarningMessage(`Are you sure you want to delete ${cassettes.length} cassettes in the workspace?`, 'Yes', 'No');
        } else {
            deleteConfirmationResult = 'Yes';
        }
        if (deleteConfirmationResult === 'Yes') {
            const deletePromises = cassettes.map(async (cassette) => {
                await vscode.workspace.fs.delete(cassette);
            });
            await Promise.all(deletePromises);
            vscode.window.showInformationMessage(`Deleted ${cassettes.length} cassettes in the workspace`);
            deleteConfirmationResult = undefined;
            // Refresh code lenses
            codeLensProviderDisposable.dispose();
            codeLensProviderDisposable = vscode.languages.registerCodeLensProvider({ language: 'python' }, codeLensProvider);
            context.subscriptions.push(codeLensProviderDisposable);
        }
    }));

    vscode.commands.registerCommand('vcrpy-cassette-mgr.cassetteOptions', async (cassetteDirFound: boolean) => {
        let qpOptions = [''];
        if (cassetteDirFound) {
            qpOptions = ['Delete Cassettes in Current File', 'Delete Cassettes in Workspace', `Rescan Cassettes in '${cassetteDirectoryName}' directory`, 'Configure Cassette Manager'];
        } else {
            qpOptions = [`Rescan Cassettes in '${cassetteDirectoryName}' directory`, 'Configure Cassette Manager'];
        }
        const selectedOption = await vscode.window.showQuickPick(qpOptions, {
            placeHolder: 'Select an option',
        });

        if (selectedOption) {
            switch (selectedOption) {
                case `Rescan Cassettes in '${cassetteDirectoryName}' directory`:
                    codeLensProviderDisposable.dispose();
                    codeLensProviderDisposable = vscode.languages.registerCodeLensProvider({ language: 'python' }, codeLensProvider);
                    context.subscriptions.push(codeLensProviderDisposable);
                    if (cassetteDir !== '') {
                        vscode.window.showInformationMessage(`Cassette '${cassetteDirectoryName}' directory found`);
                    } else {
                        vscode.window.showErrorMessage(`Cassette '${cassetteDirectoryName}' directory not found`);
                    }
                    break;
                case 'Delete Cassettes in Current File':
                    vscode.commands.executeCommand('vcrpy-cassette-mgr.deleteCassettesCurrentFile');
                    break;
                case 'Delete Cassettes in Workspace':
                    vscode.commands.executeCommand('vcrpy-cassette-mgr.deleteCassettesAll');
                    break;
                case 'Configure Cassette Manager':
                    vscode.commands.executeCommand('workbench.action.openSettings', '@ext:pdjohntony.vcrpy-cassette-mgr');
                    break;
            }
        }
    });
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


export class VcrCassMgrCodeLensProvider implements vscode.CodeLensProvider {
    async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
        let codeLensesArray: vscode.CodeLens[] = [];
        // check if editor filename starts with testFileNameStartsWith
        if (!path.basename(document.fileName).startsWith(testFileNameStartsWith)) {
            console.log(`Skipping vcr decorator scan, '${path.basename(document.fileName)}' does not start with '${testFileNameStartsWith}'`);
            this.cassetteCounter.hide();
            return [];
        }
        if (cassetteDir === '') {
            console.log(`Skipping vcr decorator scan, '${cassetteDirectoryName}' is empty`);
            this.updateCassetteCount(0, false);
            return [];
        }

        const vcrDecoratorsArray = searchForVcrDecorators(document);
        let editorCassetteCount = 0;

        // Iterate through each vcr decorator, look for matching cassettes and create code lenses
        const codeLensesPromises = vcrDecoratorsArray.map(async (vcrDecorator) => {
            const cassetteDirPath = path.join(cassetteDir);
            const files = await readdir(cassetteDirPath);
            const matchingFiles = files.filter(file => 
                (file.startsWith(`${vcrDecorator.vcrTestName}.`) || file.startsWith(`${vcrDecorator.vcrTestName}[`)) 
                && file.endsWith('.yaml')
            );
            let codeLensItems = [];
            const cassetteCount = matchingFiles.length;
            editorCassetteCount += cassetteCount;
            const cassetteFilePaths = matchingFiles.map(file => vscode.Uri.file(path.join(cassetteDir, file)));
            if (cassetteCount > 0) {
                const openTitle = cassetteCount === 1 ? 'Open cassette' : `Open ${cassetteCount} cassettes`;
                const deleteTitle = cassetteCount === 1 ? 'Delete cassette' : `Delete ${cassetteCount} cassettes`;
                const openCommand = new vscode.CodeLens(vcrDecorator.range, {
                    title: openTitle,
                    command: 'vcrpy-cassette-mgr.openCassette',
                    arguments: [cassetteFilePaths]
                });
                codeLensItems.push(openCommand);
                const deleteCommand = new vscode.CodeLens(vcrDecorator.range, {
                    title: deleteTitle,
                    command: 'vcrpy-cassette-mgr.deleteCassette',
                    arguments: [cassetteFilePaths]
                });
                codeLensItems.push(deleteCommand);
            }
            // if matchingFiles is 0, add a no cassette found code lens
            if (cassetteCount === 0) {
                if (cassetteButtonOpen || cassetteButtonDelete) {
                    const noCassetteCommand = new vscode.CodeLens(vcrDecorator.range, {
                        title: 'No cassette found',
                        command: ''
                    });
                    codeLensItems.push(noCassetteCommand);
                }
            }
            return codeLensItems;
        });
        Promise.all(codeLensesPromises).then(() => {
            console.log(`Found ${editorCassetteCount} cassettes`);
            this.updateCassetteCount(editorCassetteCount);
        });
    
        const codeLensesArrays = await Promise.all(codeLensesPromises);
        codeLensesArray = codeLensesArrays.flat();
        // console.log(codeLensesArray);
        console.log(`Returning ${codeLensesArray.length} code lenses`);
        return codeLensesArray;
    }

    // Status bar item
    private cassetteCounter: vscode.StatusBarItem;
    constructor(cassetteCounter: vscode.StatusBarItem) {
        this.cassetteCounter = cassetteCounter;
    }
    public updateCassetteCount(cassetteCount: number = 0, cassetteDirFound: boolean = true) {
        if (cassetteDirFound) {
            this.cassetteCounter.text = `Cassettes: ${cassetteCount}`;
            this.cassetteCounter.tooltip = 'Cassette Manager Options';
            this.cassetteCounter.backgroundColor = undefined;
            this.cassetteCounter.command = {
                command: 'vcrpy-cassette-mgr.cassetteOptions',
                title: 'Cassette Options',
                arguments: [cassetteDirFound]
            };
        } else {
            this.cassetteCounter.text = `${cassetteDirectoryName} directory not found`;
            this.cassetteCounter.tooltip = 'Cassette Manager Options';
            this.cassetteCounter.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            // this.cassetteCounter.color = new vscode.ThemeColor('statusBarItem.warningBackground');
            this.cassetteCounter.command = {
                command: 'vcrpy-cassette-mgr.cassetteOptions',
                title: 'Cassette Options',
                arguments: [cassetteDirFound]
            };
        }
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
