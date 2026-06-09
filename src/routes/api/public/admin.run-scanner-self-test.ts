// Admin endpoint to trigger the scanner self-test on demand. Public (no auth)
// but only writes synthetic scans tagged source=self_test in the summary.
import { createFileRoute } from "@tanstack/react-router";
import { runScannerSelfTest } from "@/lib/parking/scanner-self-test.functions";

async function run() {
  const result = await runScannerSelfTest();
  return new Response(JSON.stringify(result), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/admin/run-scanner-self-test")({
  server: { handlers: { POST: run, GET: run } },
});
