import path from 'path';
import vscode from 'vscode';

import { APP_NAME } from './shared/constants';
import getMakefileTargetNames, { MAKEFILE } from './shared/getMakefileTargetNames';
import getOutputChannel from './shared/getOutputChannel';
import localize from './shared/localize';
import { MakefileTaskDefinition } from './shared/MakeTask';
import showError from './shared/showError';
import { getTaskGroupGuess } from './shared/taskGroup';

export default class FolderDetector {
  private fileWatcher?: vscode.FileSystemWatcher;

  private promise?: Thenable<vscode.Task[]>;

  private rootPath?: string;

  private sourceName = 'make';

  constructor(public readonly workspaceFolder: vscode.WorkspaceFolder) {
    this.rootPath = workspaceFolder.uri.scheme === 'file' ? workspaceFolder.uri.fsPath : undefined;
  }

  isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration(APP_NAME, this.workspaceFolder.uri)
      .get<boolean>('autoDetect', true);
  }

  start(): void {
    if (!this.isEnabled()) {
      return;
    }

    if (!this.rootPath) {
      getOutputChannel().appendLine(
        `Wrong Workspace schema: ${this.workspaceFolder.uri.toString()}`,
      );
      showError();
      return;
    }

    const pattern = path.join(this.rootPath, `{${MAKEFILE}}`);
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.fileWatcher.onDidChange(this.unsetPromise);
    this.fileWatcher.onDidCreate(this.unsetPromise);
    this.fileWatcher.onDidDelete(this.unsetPromise);
  }

  dispose(): void {
    this.unsetPromise();

    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }
    this.fileWatcher = undefined;
  }

  async getTasks(): Promise<vscode.Task[]> {
    if (!this.isEnabled()) {
      return [];
    }

    if (!this.promise) {
      this.promise = this.computeTasks();
    }

    return this.promise;
  }

  getTask(task: vscode.Task): Promise<vscode.Task | undefined> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const definition: MakefileTaskDefinition = <any>task.definition;
    return Promise.resolve(this.makeTask(definition.targetName));
  }

  private makeTask = (targetName: string): vscode.Task => {
    const definition: MakefileTaskDefinition = {
      type: this.sourceName,
      targetName,
    };

    const options: vscode.ShellExecutionOptions = { cwd: this.rootPath };

    const task = new vscode.Task(
      definition,
      this.workspaceFolder,
      targetName,
      this.sourceName,
      new vscode.ShellExecution(`make`, [targetName], options),
    );

    task.group = getTaskGroupGuess(targetName);
    return task;
  };

  private async computeTasks(): Promise<vscode.Task[]> {
    try {
      const targetNames = await getMakefileTargetNames(this.rootPath);

      if (!targetNames) {
        return [];
      }

      const result: vscode.Task[] = targetNames.map((name) => this.makeTask(name));
      return result;
    } catch (err) {
      this.unsetPromise();
      const channel = getOutputChannel();

      /* eslint-disable @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-call */
      if (err.stderr) {
        channel.appendLine(err.stderr);
      }

      if (err.stdout) {
        channel.appendLine(err.stdout);
      }

      channel.appendLine(
        localize(
          'execFailed',
          'Auto detecting Make targets for folder `{0}` failed with error: {1}',
          this.workspaceFolder.name,
          err.error ? err.error.toString() : 'unknown',
        ),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-call */
      showError();

      return [];
    }
  }

  private unsetPromise = (): void => {
    this.promise = undefined;
  };
}
