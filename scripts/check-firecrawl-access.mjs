const target = process.argv[2];
const apiKey = process.env.FIRECRAWL_API_KEY?.trim();

if (!target || !apiKey) {
  throw new Error("Usage: FIRECRAWL_API_KEY=... node scripts/check-firecrawl-access.mjs <https-url>");
}

const url = new URL(target);
if (url.protocol !== "https:") throw new Error("Only HTTPS targets are allowed.");

function pathDisallowed(robots, pathname) {
  const lines = robots.split(/\r?\n/).map((line) => line.replace(/#.*$/, "").trim());
  let applies = false;
  const disallowed = [];
  for (const line of lines) {
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") applies = value === "*";
    if (applies && key === "disallow" && value) disallowed.push(value);
  }
  return disallowed.some((rule) => rule === "/" || pathname.startsWith(rule));
}

const robotsUrl = new URL("/robots.txt", url);
const robotsResponse = await fetch(robotsUrl, { signal: AbortSignal.timeout(15_000) });
if (robotsResponse.ok && pathDisallowed(await robotsResponse.text(), url.pathname)) {
  console.log(JSON.stringify({ allowed: false, reason: "robots.txt disallows this path", target }));
  process.exitCode = 2;
} else {
  const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      url: target,
      formats: ["markdown"],
      onlyMainContent: true,
      maxAge: 0,
      zeroDataRetention: true,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(`Firecrawl failed (HTTP ${response.status}): ${result.error ?? "unknown error"}`);
  }

  console.log(JSON.stringify({
    allowed: true,
    statusCode: result.data?.metadata?.statusCode,
    title: result.data?.metadata?.title,
    markdownChars: result.data?.markdown?.length ?? 0,
  }));
}
