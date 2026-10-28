// Serves the mock Dynatrace over HTTP with CORS, Managed-style at
// http://localhost:<port>/e/{production,staging,development}.
//
//   node mock/server.mjs [port]

import { createServer } from "node:http";
import { createMock } from "./dynatrace.mjs";

const PORT = Number(process.argv[2] ?? process.env.MOCK_PORT ?? 8787);
const handle = createMock();

createServer((req, res) => {
  const origin = req.headers.origin ?? "*";
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, DELETE, PUT",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "60",
      Vary: "Origin",
    });
    return res.end();
  }
  let data = "";
  req.on("data", (chunk) => (data += chunk));
  req.on("end", () => {
    let body;
    try {
      body = data ? JSON.parse(data) : undefined;
    } catch {
      body = undefined;
    }
    const result = handle(req.method, req.url, req.headers.authorization, body);
    res.writeHead(result.status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": origin, "Access-Control-Expose-Headers": "*", Vary: "Origin" });
    res.end(result.body === undefined ? "" : JSON.stringify(result.body));
  });
}).listen(PORT, () => console.log(`Mock Dynatrace on http://localhost:${PORT}/e/{production,staging,development}`));
