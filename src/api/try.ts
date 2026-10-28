import { clientFor, setEnvironments } from "../store/state";
import { notify } from "../ui/feedback";
import { demoEnvironments, playgroundEnvironment } from "./demo";

/**
 * Loads a demo and lands on the overview. Shared by the buttons on the empty Environments page and
 * the links #/try/playground and #/try/sample that the README points visitors to.
 */
export async function tryDemo(kind: "playground" | "sample"): Promise<void> {
  const playground = kind === "playground" ? playgroundEnvironment() : null;
  if (kind === "playground" && playground) {
    try {
      await clientFor(playground).http.get("/api/v2/entities", { entitySelector: 'type("HOST")', pageSize: 1 });
      await setEnvironments([playground]);
      location.hash = "#/";
      return;
    } catch {
      notify("The live Playground demo is unavailable right now (Dynatrace resets the Playground from time to time). Showing the sample data instead.", "error");
    }
  } else if (kind === "playground") {
    notify("This copy of DMM has no Playground demo built in. Showing the sample data instead.", "error");
  }
  await setEnvironments(demoEnvironments());
  location.hash = "#/";
}
