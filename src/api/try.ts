import { clientFor, setEnvironments } from "../store/state";
import { notify } from "../ui/feedback";
import { demoEnvironments, playgroundEnvironment } from "./demo";
import { ApiError } from "./http";

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
    } catch (error) {
      // Say what actually failed: a blocked connection and an expired token need different fixes.
      const status = error instanceof ApiError ? error.status : 0;
      notify(
        status === 401 || status === 403
          ? "The live Playground demo token has expired (Dynatrace resets the Playground from time to time). Showing the sample data instead."
          : status === 0
            ? `${(error as Error).message} Showing the sample data instead.`
            : `The Playground answered ${status}. Showing the sample data instead.`,
        "error",
      );
    }
  } else if (kind === "playground") {
    notify("This copy of DMM has no Playground demo built in. Showing the sample data instead.", "error");
  }
  await setEnvironments(demoEnvironments());
  location.hash = "#/";
}
