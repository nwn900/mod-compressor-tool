import { spawn, ChildProcess } from 'child_process';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  timeout?: number;
  cwd?: string;
  input?: string;
  onStdoutLine?: (line: string) => void;
}

export class ProcessRunner {
  private _process: ChildProcess | null = null;

  get isRunning(): boolean {
    return this._process !== null
      && this._process.exitCode === null
      && this._process.signalCode === null;
  }

  async run(args: string[], options?: RunOptions): Promise<RunResult> {
    if (this._process) {
      this.cancel();
    }

    return new Promise<RunResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let stdoutLineBuffer = '';
      let settled = false;

      const proc = spawn(args[0], args.slice(1), {
        windowsHide: true,
        shell: false,
        cwd: options?.cwd,
      });

      this._process = proc;

      if (proc.stdout) {
        proc.stdout.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stdout += chunk;
          const lines = `${stdoutLineBuffer}${chunk}`.split(/\r?\n/);
          stdoutLineBuffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line) continue;
            try { options?.onStdoutLine?.(line); } catch { /* observer errors must not stop the child */ }
          }
        });
      }

      if (proc.stderr) {
        proc.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      }

      if (options?.input !== undefined && proc.stdin) {
        proc.stdin.write(options.input);
        proc.stdin.end();
      }

      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      if (options?.timeout && options.timeout > 0) {
        timeoutId = setTimeout(() => {
          timedOut = true;
          this.kill(proc);
        }, options.timeout * 1000);
      }

      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        if (this._process === proc) this._process = null;
        resolve({
          code: err.code === 'ENOENT' ? -2 : -1,
          stdout,
          stderr: stderr || err.message,
        });
      });

      proc.on('close', (code: number | null) => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        if (stdoutLineBuffer) {
          try { options?.onStdoutLine?.(stdoutLineBuffer); } catch { /* observer errors must not stop the child */ }
        }
        if (this._process === proc) this._process = null;
        if (timedOut) {
          resolve({ code: -1, stdout, stderr: 'Timeout' });
        } else {
          resolve({ code: code ?? -1, stdout, stderr });
        }
      });
    });
  }

  cancel(): void {
    this.kill();
  }

  private kill(proc: ChildProcess | null = this._process): void {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) {
      return;
    }

    try {
      proc.kill('SIGTERM');
      // Force kill after 3s if still running
      setTimeout(() => {
        try {
          if (proc.exitCode === null && proc.signalCode === null) {
            proc.kill('SIGKILL');
          }
        } catch {
          // Process already exited
        }
      }, 3000);
    } catch {
      // Process may have already exited
    }
  }
}
