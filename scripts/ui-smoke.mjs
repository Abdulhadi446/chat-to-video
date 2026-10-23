import { chromium } from "playwright-core"
import fs from "node:fs"

const BASE = process.env.BASE || "http://127.0.0.1:3111"
const email = `ui${Date.now()}@example.com`
const pass = "demo-password-123"
fs.mkdirSync(".agent-logs", { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--headless=new"],
})
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
const page = await context.newPage()
page.on("console", (m) => { if (m.type() === "error") console.log("[console]", m.text()) })
page.on("pageerror", (e) => console.log("[pageerror]", e.message))

try {
  await page.goto(`${BASE}/register`, { waitUntil: "domcontentloaded", timeout: 45000 })
  console.log("register screenshot ok, title:", await page.title())

  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(pass)
  await page.getByLabel("Confirm password").fill(pass)
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForURL("**/chat", { timeout: 20000 })
  await page.waitForTimeout(3000)
  console.log("chat empty screenshot ok, url:", page.url())

  const composer = page.getByLabel("Describe what to make")
  await composer.fill("Make a 10 second vertical coffee ad with a calm narrator voice, warm and minimal")
  await page.getByLabel("Send message").click()
  await page.waitForTimeout(5000)
  console.log("sending screenshot ok")

  // Wait for either the video or a clear error, max 90s.
  const started = Date.now()
  let state = "unknown"
  while (Date.now() - started < 90000) {
    const video = page.locator("video")
    const error = page.getByText(/failed|error/i)
    if (await video.count()) { state = "video"; break }
    if (await error.count()) { state = "error"; break }
    await page.waitForTimeout(3000)
  }
  console.log("result state:", state, "elapsed:", Math.round((Date.now() - started) / 1000))
  console.log("video count:", await page.locator("video").count())
  console.log("body text:", (await page.locator("body").innerText()).slice(0, 1200).replace(/\n+/g, " | "))
} finally {
  await browser.close()
}