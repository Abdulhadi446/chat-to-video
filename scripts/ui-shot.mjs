import { chromium } from "playwright-core"

const BASE = process.env.BASE || "http://127.0.0.1:3111"
const email = process.env.EMAIL || "ui1792693497855@example.com"
const pass = process.env.PASS || "demo-password-123"

const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1"],
})
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
const page = await context.newPage()
page.on("pageerror", (e) => console.log("[pageerror]", e.message))
try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 })
  await page.waitForTimeout(1000)
  await page.screenshot({ path: ".agent-logs/ui-login.png", timeout: 20000 })
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(pass)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL("**/chat", { timeout: 20000 })
  await page.waitForTimeout(3500)
  await page.screenshot({ path: ".agent-logs/ui-chat.png", timeout: 20000 })
  console.log("chat title:", await page.title())
  console.log("video count:", await page.locator("video").count())
  console.log("body:", (await page.locator("body").innerText()).slice(0, 500).replace(/\n+/g, " | "))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: ".agent-logs/ui-chat-mobile.png", timeout: 20000 })
} finally {
  await browser.close()
}
