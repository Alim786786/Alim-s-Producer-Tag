import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';

const COOLDOWN_MS = 1000;
const RESET_DELAY_MS = 30_000;
const SOUND_FILES = ['producer-tag-1.wav', 'producer-tag-2.wav', 'producer-tag-3.wav'];

let lastPlayed = 0;
let consecutiveErrors = 0;
let resetTimer: ReturnType<typeof setTimeout> | undefined;

// Persistent PowerShell process (Windows only) — avoids cold-start delay
let psProc: ChildProcess | undefined;

function getOrCreatePsProc(): ChildProcess {
	if (psProc && !psProc.killed) {
		return psProc;
	}
	// Loop: read a file path from stdin, play it, repeat
	const script = `
while ($true) {
	$f = [Console]::ReadLine()
	if ($null -eq $f) { break }
	try { (New-Object Media.SoundPlayer $f).PlaySync() } catch {}
}`;
	const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
		stdio: ['pipe', 'ignore', 'ignore']
	});
	proc.on('error', (err) => console.error('[producer-tag] ps proc error:', err));
	proc.on('exit', () => { psProc = undefined; });
	psProc = proc;
	return proc;
}

function playSound(extensionPath: string, filename: string): void {
	const soundPath = path.join(extensionPath, 'media', filename);
	console.log('[producer-tag] Playing sound:', soundPath);

	try {
		if (process.platform === 'win32') {
			const ps = getOrCreatePsProc();
			ps.stdin!.write(soundPath + '\n');
		} else {
			const cmd = process.platform === 'darwin' ? 'afplay' : 'aplay';
			const proc = spawn(cmd, [soundPath], { stdio: 'pipe' });
			proc.on('error', (err) => console.error('[producer-tag] spawn error:', err));
		}
	} catch (err) {
		console.error('[producer-tag] Failed to play sound:', err);
	}
}

function resetCounter(): void {
	consecutiveErrors = 0;
	if (resetTimer) {
		clearTimeout(resetTimer);
		resetTimer = undefined;
	}
}

function scheduleReset(): void {
	if (resetTimer) {
		clearTimeout(resetTimer);
	}
	resetTimer = setTimeout(resetCounter, RESET_DELAY_MS);
}

function onError(extensionPath: string): void {
	const now = Date.now();
	if (now - lastPlayed < COOLDOWN_MS) {
		return;
	}
	lastPlayed = now;

	const index = consecutiveErrors % SOUND_FILES.length;
	consecutiveErrors++;

	playSound(extensionPath, SOUND_FILES[index]);
	scheduleReset();
}

export function activate(context: vscode.ExtensionContext): void {
	const extPath = context.extensionPath;
	console.log('[producer-tag] Extension activated, path:', extPath);

	// Test command: open Command Palette → "Play Producer Tag" to verify audio
	context.subscriptions.push(
		vscode.commands.registerCommand('alim-s-producer-tag.testSound', () => {
			playSound(extPath, SOUND_FILES[0]);
		})
	);

	context.subscriptions.push(
		vscode.window.onDidEndTerminalShellExecution(event => {
			console.log('[producer-tag] Shell execution ended, exitCode:', event.exitCode);
			if (event.exitCode !== undefined && event.exitCode !== 0) {
				onError(extPath);
			} else if (event.exitCode === 0) {
				resetCounter();
			}
		})
	);
}

export function deactivate(): void {
	if (resetTimer) {
		clearTimeout(resetTimer);
	}
	if (psProc && !psProc.killed) {
		psProc.stdin!.end();
		psProc.kill();
	}
}
