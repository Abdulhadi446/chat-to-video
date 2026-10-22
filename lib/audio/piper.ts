/**
 * Local Piper text-to-speech.
 *
 * Install once with `bash scripts/setup-piper.sh` (downloads the static binary
 * and the en_US-lessac-medium voice into `tools/piper/`).
 *
 * Contract:
 *   piperAvailable(): Promise<boolean>
 *   synthesizeNarration(text, outWav): Promise<{ok, wavPath?, error?}>
 *
 * Nothing here throws: every failure is reported as `{ok:false,error}` so the
 * renderer/jobs can fall back to a silent video.
 */
import { spawn } from "node:child_process";
import { existsSync, constants as fsConstants } from "node:fs";
import { access, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_PIPER_PATH = "tools/piper/piper";
const DEFAULT_MODEL_PATH = "tools/piper/voices/en_US-lessac-medium.onnx";

const HELP_TIMEOUT_MS = 10_000;
const SYNTH_TIMEOUT_MS = 120_000;
const PROBE_TIMEOUT_MS = 15_000;
const MIN_WAV_BYTES = 1024;
const MAX_CAPTURED_OUTPUT = 64_000;

export interface NarrationResult {
  ok: boolean;
  wavPath?: string;
  error?: string;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Resolve a tool path. Absolute paths pass through. Relative paths containing a
 * separator (or existing relative to the repo root) resolve against cwd; bare
 * command names fall through to PATH lookup.
 */
function resolveToolPath(value: string): string {
  if (path.isAbsolute(value)) return value;
  const local = path.resolve(process.cwd(), value);
  if (value.includes("/") || value.includes("\\") || existsSync(local)) return local;
  return value;
}

function piperPath(): string {
  const configured = process.env.PIPER_PATH?.trim();
  return resolveToolPath(configured || DEFAULT_PIPER_PATH);
}

function modelPath(): string {
  const configured = process.env.PIPER_MODEL?.trim();
  return resolveToolPath(configured || DEFAULT_MODEL_PATH);
}

function ffprobePath(): string {
  const explicit = process.env.FFPROBE_PATH?.trim();
  if (explicit) return resolveToolPath(explicit);

  const ffmpeg = process.env.FFMPEG_PATH?.trim();
  if (ffmpeg) {
    const resolved = resolveToolPath(ffmpeg);
    const dir = path.dirname(resolved);
    if (dir !== ".") {
      const sibling = path.join(dir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
      if (existsSync(sibling)) return sibling;
    }
  }
  return "ffprobe";
}

function appendOutput(current: string, chunk: Buffer | string): string {
  if (current.length >= MAX_CAPTURED_OUTPUT) return current;
  return (current + chunk.toString()).slice(0, MAX_CAPTURED_OUTPUT);
}

/** Spawn a process, feed optional stdin, and always resolve (never reject). */
function runProcess(
  command: string,
  args: string[],
  opts: { input?: string; timeoutMs: number },
): Promise<RunResult> {
  return new Promise<RunResult>((resolve) => {
    let settled = false;
    let timedOut = false;
    let stdout = "";
    let stderr = "";
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      finish({ code: null, stdout, stderr, error: errorMessage(err) });
      return;
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendOutput(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendOutput(stderr, chunk);
    });

    // Ignore EPIPE if the process exits before reading all of stdin.
    child.stdin?.on("error", () => undefined);

    child.on("error", (err) => {
      finish({ code: null, stdout, stderr, error: errorMessage(err) });
    });

    child.on("close", (code) => {
      finish({
        code,
        stdout,
        stderr,
        error: timedOut ? `Timed out after ${opts.timeoutMs}ms` : undefined,
      });
    });

    timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // Process already gone.
      }
    }, opts.timeoutMs);

    if (opts.input !== undefined) {
      child.stdin?.end(opts.input);
    } else {
      child.stdin?.end();
    }
  });
}

function lastLines(value: string, maxChars = 600): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.length > maxChars ? `...${trimmed.slice(-maxChars)}` : trimmed;
}

/**
 * True when the Piper binary, voice model, and voice config exist and the
 * binary can run. Safe to call from API routes / jobs.
 */
export async function piperAvailable(): Promise<boolean> {
  try {
    const binary = piperPath();
    const model = modelPath();

    await access(binary, fsConstants.X_OK);
    await access(model, fsConstants.R_OK);
    await access(`${model}.json`, fsConstants.R_OK);

    const result = await runProcess(binary, ["--help"], { timeoutMs: HELP_TIMEOUT_MS });
    return result.code === 0 || /\busage\b/i.test(result.stdout);
  } catch {
    return false;
  }
}

/** Validate a generated WAV with ffprobe. Returns an error string or null. */
async function validateWav(wavPath: string): Promise<string | null> {
  let size: number;
  try {
    const info = await stat(wavPath);
    if (!info.isFile()) return "Piper output is not a file";
    size = info.size;
  } catch (err) {
    return `Piper did not produce an output file: ${errorMessage(err)}`;
  }

  if (size <= MIN_WAV_BYTES) {
    return `Piper output is too small (${size} bytes, expected > ${MIN_WAV_BYTES})`;
  }

  const probe = await runProcess(
    ffprobePath(),
    [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_name,sample_rate,channels",
      "-of",
      "json",
      wavPath,
    ],
    { timeoutMs: PROBE_TIMEOUT_MS },
  );

  if (probe.error) {
    return `ffprobe failed: ${probe.error}`;
  }
  if (probe.code !== 0) {
    return `ffprobe rejected Piper output: ${lastLines(probe.stderr) || `exit code ${probe.code}`}`;
  }

  try {
    const parsed = JSON.parse(probe.stdout) as {
      streams?: Array<{ codec_name?: string; sample_rate?: string; channels?: number }>;
    };
    if (!parsed.streams || parsed.streams.length === 0) {
      return "ffprobe found no audio stream in Piper output";
    }
    const codec = parsed.streams[0]?.codec_name ?? "";
    if (!codec.startsWith("pcm_")) {
      return `Unexpected audio codec in Piper output: ${codec || "unknown"}`;
    }
  } catch {
    return "Could not parse ffprobe output";
  }

  return null;
}

/**
 * Synthesize `text` to a WAV at `outWav`. Resolves against cwd when relative.
 * Never throws; returns `{ok:false,error}` on any problem.
 */
export async function synthesizeNarration(
  text: string,
  outWav: string,
): Promise<NarrationResult> {
  let tempPath: string | null = null;

  try {
    const narration = typeof text === "string"
      ? text
          // eslint-disable-next-line no-control-regex
          .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
      : "";

    if (!narration) return { ok: false, error: "Narration text is empty" };
    if (typeof outWav !== "string" || !outWav.trim()) {
      return { ok: false, error: "Output WAV path is required" };
    }

    const binary = piperPath();
    const model = modelPath();
    const config = `${model}.json`;
    const wavPath = path.isAbsolute(outWav) ? outWav : path.resolve(process.cwd(), outWav);

    try {
      await access(binary, fsConstants.X_OK);
    } catch {
      return {
        ok: false,
        error: `Piper is not installed or not executable at ${binary}. Run: bash scripts/setup-piper.sh`,
      };
    }
    try {
      await access(model, fsConstants.R_OK);
    } catch {
      return {
        ok: false,
        error: `Piper voice model not found at ${model}. Run: bash scripts/setup-piper.sh`,
      };
    }
    try {
      await access(config, fsConstants.R_OK);
    } catch {
      return { ok: false, error: `Piper voice config not found at ${config}` };
    }

    await mkdir(path.dirname(wavPath), { recursive: true });

    // Write to a temp file first so a failed run never leaves a half WAV behind.
    const nonce = Math.random().toString(36).slice(2, 8);
    tempPath = `${wavPath}.${process.pid}.${Date.now()}.${nonce}.part.wav`;

    const result = await runProcess(
      binary,
      ["--model", model, "--config", config, "--output_file", tempPath],
      { input: `${narration}\n`, timeoutMs: SYNTH_TIMEOUT_MS },
    );

    if (result.error) {
      return { ok: false, error: `Piper failed: ${result.error}` };
    }
    if (result.code !== 0) {
      return {
        ok: false,
        error: `Piper exited with code ${result.code}: ${lastLines(result.stderr) || "unknown error"}`,
      };
    }

    const validationError = await validateWav(tempPath);
    if (validationError) return { ok: false, error: validationError };

    // Replace any previous output atomically.
    await rm(wavPath, { force: true });
    await rename(tempPath, wavPath);
    tempPath = null;

    return { ok: true, wavPath };
  } catch (err) {
    return { ok: false, error: `Narration failed: ${errorMessage(err)}` };
  } finally {
    if (tempPath) {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }
}

/** Convenience wrapper for jobs: returns the WAV path or null on failure. */
export async function synthesizeNarrationSafe(
  text: string,
  outWav: string,
): Promise<string | null> {
  const result = await synthesizeNarration(text, outWav);
  return result.ok && result.wavPath ? result.wavPath : null;
}
