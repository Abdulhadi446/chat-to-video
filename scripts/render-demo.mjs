#!/usr/bin/env node
/**
 * Standalone renderer demo.
 *
 * There is no tsx/ts-node runner in this project, so this script compiles the
 * TypeScript renderer with the local `typescript` devDependency (into
 * .agent-logs/, which is gitignored) and then runs the compiled CommonJS
 * modules with plain Node.
 *
 * Usage:
 *   node scripts/render-demo.mjs [--out <dir>] [--no-audio]
 *
 * Outputs (default): data/outputs/render-demo/
 *   final.mp4, thumb.jpg, final.png, assets/demo-audio.wav, frame-*.jpg
 */

import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { existsSync, mkdirSync, rmSync, writeFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, "..")
const libDir = path.join(repoRoot, "lib")
const buildRoot = path.join(repoRoot, ".agent-logs", "render-build")
const buildJsDir = path.join(buildRoot, "js")
const typescriptBin = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc")

const args = process.argv.slice(2)
const outIndex = args.indexOf("--out")
const outDir = path.resolve(
  outIndex >= 0 && args[outIndex + 1] ? args[outIndex + 1] : path.join(repoRoot, "data", "outputs", "render-demo"),
)
const withAudio = !args.includes("--no-audio")

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    timeout: options.timeout ?? 15 * 60 * 1000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${command} ${commandArgs.join(" ")} exited with ${result.status}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    )
  }
  return result
}

function probe(file) {
  const result = run("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    file,
  ])
  return JSON.parse(result.stdout)
}

function assert(condition, message) {
  if (!condition) throw new Error(`Validation failed: ${message}`)
}

async function main() {
  if (!existsSync(typescriptBin)) {
    throw new Error(
      `typescript is not installed at ${typescriptBin}. Run \`npm install\` (the demo compiles lib/render with the local tsc).`,
    )
  }
  if (!existsSync(path.join(repoRoot, "node_modules"))) {
    throw new Error("node_modules is missing. Run `npm install` first.")
  }

  console.log("[demo] compiling lib/render with local TypeScript ...")
  rmSync(buildRoot, { recursive: true, force: true })
  mkdirSync(buildJsDir, { recursive: true })

  const tsconfigPath = path.join(buildRoot, "tsconfig.render-demo.json")
  writeFileSync(path.join(buildRoot, "package.json"), JSON.stringify({ type: "commonjs" }, null, 2), "utf8")
  writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          module: "CommonJS",
          moduleResolution: "Node10",
          rootDir: libDir,
          outDir: buildJsDir,
          esModuleInterop: true,
          skipLibCheck: true,
          strict: true,
          noEmit: false,
          types: ["node"],
          typeRoots: [path.join(repoRoot, "node_modules", "@types")],
          forceConsistentCasingInFileNames: true,
          resolveJsonModule: true,
        },
        files: [path.join(libDir, "render", "video.ts"), path.join(libDir, "render", "image.ts")],
      },
      null,
      2,
    ),
    "utf8",
  )

  const compile = run(process.execPath, [typescriptBin, "-p", tsconfigPath])
  if (compile.stdout.trim()) console.log(compile.stdout.trim())
  console.log("[demo] compiled")

  const requireFromRepo = createRequire(import.meta.url)
  const { renderVideo } = requireFromRepo(path.join(buildJsDir, "render", "video.js"))
  const { renderImage } = requireFromRepo(path.join(buildJsDir, "render", "image.js"))

  mkdirSync(outDir, { recursive: true })

  let audioPath = null
  if (withAudio) {
    audioPath = path.join(outDir, "assets", "demo-audio.wav")
    mkdirSync(path.dirname(audioPath), { recursive: true })
    console.log("[demo] synthesizing a 12s test audio bed (trimmed to 10s by the renderer)")
    run("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=196:duration=12:sample_rate=48000",
      "-af",
      "volume=0.06,afade=t=in:st=0:d=0.5,afade=t=out:st=10.5:d=1.5",
      "-c:a",
      "pcm_s16le",
      audioPath,
    ])
  }

  const spec = {
    title: "Slow Mornings, Better Coffee",
    kind: "video",
    duration: 10,
    aspect: "9:16",
    voice: withAudio ? "narrator" : "silent",
    style: "warm cinematic coffee commercial",
    palette: ["#1B0F08", "#7C2D12", "#F59E0B", "#FFF7ED"],
    scenes: [
      {
        text: "Slow mornings start with better coffee.",
        caption: "Slow mornings start with better coffee.",
        visual: "macro coffee beans, warm window light",
        assetQuery: "coffee beans",
        duration: 2.5,
        transition: "fade",
      },
      {
        text: "Single origin, roasted in small batches.",
        caption: "Single origin, roasted in small batches.",
        visual: "espresso pouring into a cup, steam",
        assetQuery: "espresso coffee",
        duration: 2.5,
        transition: "slide",
      },
      {
        text: "Rich crema with notes of cocoa and citrus.",
        caption: "Rich crema. Notes of cocoa and citrus.",
        visual: "close up coffee cup on a wooden table",
        assetQuery: "coffee cup",
        duration: 2.5,
        transition: "zoom",
      },
      {
        text: "Brewed for the moments that matter.",
        caption: "Brewed for the moments that matter.",
        visual: "cosy cafe interior, morning atmosphere",
        assetQuery: "cafe interior",
        duration: 2.5,
        transition: "fade",
      },
    ],
    voiceScript: "Slow mornings start with better coffee. Brewed for the moments that matter.",
  }

  const startedAt = Date.now()
  const video = await renderVideo(
    spec,
    outDir,
    ({ progress, stage }) => {
      console.log(`[demo] ${String(Math.round(progress * 100)).padStart(3, " ")}%  ${stage}`)
    },
    { audioPath },
  )
  console.log(`[demo] video rendered in ${((Date.now() - startedAt) / 1000).toFixed(1)}s: ${video.filePath}`)

  const image = await renderImage(spec, outDir)
  console.log(`[demo] image rendered: ${image.filePath}`)

  const videoProbe = probe(video.filePath)
  const streams = videoProbe.streams ?? []
  const videoStream = streams.find((stream) => stream.codec_type === "video")
  const audioStream = withAudio ? streams.find((stream) => stream.codec_type === "audio") : undefined
  const duration = Number(videoProbe.format?.duration ?? 0)

  assert(videoStream, "final.mp4 has no video stream")
  assert(videoStream.codec_name === "h264", `expected h264, got ${videoStream.codec_name}`)
  assert(videoStream.width === 720 && videoStream.height === 1280, `expected 720x1280, got ${videoStream.width}x${videoStream.height}`)
  assert(videoStream.pix_fmt === "yuv420p", `expected yuv420p, got ${videoStream.pix_fmt}`)
  assert(videoStream.color_range === "tv", `expected limited color range, got ${videoStream.color_range}`)
  assert(videoStream.r_frame_rate === "30/1", `expected 30fps, got ${videoStream.r_frame_rate}`)
  assert(Math.abs(duration - 10) <= 0.15, `expected ~10s, got ${duration}`)
  if (withAudio) {
    assert(audioStream, "expected an AAC audio stream")
    assert(audioStream.codec_name === "aac", `expected aac, got ${audioStream.codec_name}`)
  }
  assert(existsSync(video.thumbPath), "thumb.jpg is missing")
  assert(statSync(video.thumbPath).size > 1000, "thumb.jpg is empty")

  const imageProbe = probe(image.filePath)
  const imageStream = (imageProbe.streams ?? []).find((stream) => stream.codec_type === "video")
  assert(imageStream, "final.png has no image stream")
  assert(imageStream.codec_name === "png", `expected png, got ${imageStream.codec_name}`)
  assert(imageStream.width === 1080 && imageStream.height === 1920, `expected 1080x1920 poster, got ${imageStream.width}x${imageStream.height}`)

  // Frames for manual QA (caption clipping / composition).
  const frames = []
  for (const [name, timestamp] of [
    ["frame-1.5s.jpg", "1.5"],
    ["frame-6.5s.jpg", "6.5"],
  ]) {
    const framePath = path.join(outDir, name)
    run("ffmpeg", ["-y", "-ss", timestamp, "-i", video.filePath, "-frames:v", "1", "-q:v", "2", "-update", "1", framePath])
    frames.push(framePath)
  }

  console.log("\n[demo] ffprobe final.mp4:")
  console.log(JSON.stringify(videoProbe, null, 2))
  console.log("\n[demo] ffprobe final.png:")
  console.log(JSON.stringify(imageProbe, null, 2))
  console.log("\n[demo] outputs:")
  for (const file of [video.filePath, video.thumbPath, image.filePath, ...frames]) {
    console.log(`  ${file}`)
  }
  console.log("\n[demo] validation passed")
}

main().catch((error) => {
  console.error(`\n[demo] FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  process.exit(1)
})
