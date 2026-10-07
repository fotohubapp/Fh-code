import { createInterface, type Interface } from "node:readline";

/**
 * Line input that never drops a line. readline emits lines as they arrive, so
 * with piped input every line that arrives while the agent is busy would be lost
 * if we only listened during a question; here they wait in a queue instead.
 */
export class LineReader {
  readonly rl: Interface;
  private readonly output: NodeJS.WritableStream;
  private readonly terminal: boolean;
  private readonly queue: string[] = [];
  private waiting: ((line: string | undefined) => void) | undefined;
  private closed = false;

  constructor(input: NodeJS.ReadableStream, output: NodeJS.WritableStream, terminal: boolean) {
    this.output = output;
    this.terminal = terminal;
    this.rl = createInterface({ input, output, terminal, historySize: 200 });
    this.rl.on("line", (line) => {
      const waiting = this.waiting;
      this.waiting = undefined;
      if (waiting) {
        // A terminal echoes what was typed; piped input is not echoed by anyone else.
        if (!this.terminal) this.output.write(`${line}\n`);
        waiting(line);
      } else {
        this.queue.push(line);
      }
    });
    this.rl.on("close", () => {
      this.closed = true;
      const waiting = this.waiting;
      this.waiting = undefined;
      waiting?.(undefined);
    });
  }

  /** Resolves to the next line, or undefined once input has ended. */
  question(prompt: string): Promise<string | undefined> {
    const queued = this.queue.shift();
    if (queued !== undefined) {
      // A queued line was never shown next to its prompt; echo it when piped.
      this.output.write(this.terminal ? prompt : `${prompt}${queued}\n`);
      if (this.terminal) this.output.write(`${queued}\n`);
      return Promise.resolve(queued);
    }
    if (this.closed) return Promise.resolve(undefined);
    this.rl.setPrompt(prompt);
    this.rl.prompt();
    return new Promise((resolve) => {
      this.waiting = resolve;
    });
  }

  close(): void {
    this.rl.close();
  }
}
