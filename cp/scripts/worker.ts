// ローカル用のワーカー。5 秒ごとに tick を回す。--once で 1 回だけ。
import { tick } from "../src/worker/tick";

const INTERVAL_MS = 5000;
const once = process.argv.includes("--once");

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
  console.log("stopping worker...");
});
process.on("SIGTERM", () => {
  stopping = true;
});

async function main() {
  do {
    try {
      const summary = await tick();
      if (summary.processed || summary.hardDeleted.length > 0 || summary.timedOut > 0 || summary.reconcileEnqueued) {
        console.log(JSON.stringify({ type: "tick", at: new Date().toISOString(), ...summary }));
      }
    } catch (err) {
      console.error(JSON.stringify({ type: "tick-error", error: (err as Error).message }));
    }
    if (once || stopping) break;
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  } while (!stopping);
  process.exit(0);
}

main();
