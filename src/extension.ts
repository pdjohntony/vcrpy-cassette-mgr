// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "vcrpy-mgr" is now active!');

	let command1 = vscode.commands.registerCommand('vcrpy-mgr.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from vcrpy-mgr and Phill!');
	});

	context.subscriptions.push(command1);

	updateDecorations(vscode.window.activeTextEditor, context);

	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
		updateDecorations(editor, context);
	}));

	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
		updateDecorations(vscode.window.activeTextEditor, context);
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

	const vcrDecorationType = vscode.window.createTextEditorDecorationType({
		gutterIconPath: vscode.Uri.file(context.asAbsolutePath('src/cassette-fill.svg')),
		gutterIconSize: 'auto',
		after: {
			contentText: 'Possible cassette',
			margin: '0 0 0 2em',
			color: '#ff8040',
		},
	});

	editor.setDecorations(vcrDecorationType, vcrDecorations);
	console.log('Updated vcrpy decorations');
}