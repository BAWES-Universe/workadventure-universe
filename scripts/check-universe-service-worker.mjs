#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { join } from "node:path"

const serviceWorkerPath = join("play", "public", "service-worker-prod.js")
const source = readFileSync(serviceWorkerPath, "utf8")

const requiredPatterns = [
  ["install immediately activates new worker", /self\.skipWaiting\(\)/],
  ["activate claims open clients", /clients\.claim\(\)/],
  ["message event supports skip waiting", /addEventListener\(["']message["']/],
  ["message event listens for SKIP_WAITING", /SKIP_WAITING/],
  ["push event is handled", /addEventListener\(["']push["']/],
  ["push event displays a notification", /showNotification\(/],
  ["notification clicks are handled", /addEventListener\(["']notificationclick["']/],
  ["notification click closes the notification", /notification\.close\(\)/],
  ["notification click can focus an existing client", /\.focus\(\)/],
  ["notification click can open the target URL", /clients\.openWindow\(/],
  ["notification target URLs stay on the Universe origin", /url\.origin === self\.location\.origin/],
]

const forbiddenPatterns = [
  ["placeholder wait event", /addEventListener\(["']wait["']/],
  ["placeholder update event", /addEventListener\(["']update["']/],
  ["beforeinstallprompt does not belong in a service worker", /beforeinstallprompt/],
]

const failures = []
for (const [description, pattern] of requiredPatterns) {
  if (!pattern.test(source)) {
    failures.push(`Missing: ${description}`)
  }
}

for (const [description, pattern] of forbiddenPatterns) {
  if (pattern.test(source)) {
    failures.push(`Remove: ${description}`)
  }
}

if (failures.length > 0) {
  console.error(`Service worker guard failed for ${serviceWorkerPath}`)
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(`Service worker guard passed for ${serviceWorkerPath}`)
