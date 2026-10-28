import type { FunctionComponent } from "preact";
import { Dashboards, RequestNaming } from "./Configuration";
import { Entities } from "./Entities";
import { Events } from "./Events";
import { Hosts } from "./Hosts";
import { ActiveGates, Extensions, NetworkZones, Synthetic } from "./Infrastructure";
import { Metrics } from "./Metrics";
import { Audit, Logs, Releases, Tokens } from "./Operations";
import { Overview } from "./Overview";
import { Problems } from "./Problems";
import { Slos, Vulnerabilities } from "./Reliability";
import { Settings } from "./Settings";

export interface PageDef {
  path: string;
  label: string;
  group: string;
  component: FunctionComponent;
  /** Works across all environments rather than the selected one. */
  global?: boolean;
}

export const PAGES: PageDef[] = [
  { path: "/", label: "All environments", group: "Overview", component: Overview, global: true },
  { path: "/hosts", label: "Hosts", group: "Infrastructure", component: Hosts },
  { path: "/activegates", label: "ActiveGates", group: "Infrastructure", component: ActiveGates },
  { path: "/network-zones", label: "Network zones", group: "Infrastructure", component: NetworkZones },
  { path: "/synthetic", label: "Synthetic monitors", group: "Infrastructure", component: Synthetic },
  { path: "/problems", label: "Problems", group: "Observe", component: Problems },
  { path: "/events", label: "Events", group: "Observe", component: Events },
  { path: "/metrics", label: "Metric explorer", group: "Observe", component: Metrics },
  { path: "/logs", label: "Log search", group: "Observe", component: Logs },
  { path: "/slos", label: "SLOs", group: "Observe", component: Slos },
  { path: "/releases", label: "Releases", group: "Observe", component: Releases },
  { path: "/settings", label: "Settings 2.0", group: "Configuration", component: Settings },
  { path: "/entities", label: "Entities & tags", group: "Configuration", component: Entities },
  { path: "/dashboards", label: "Dashboards", group: "Configuration", component: Dashboards },
  { path: "/request-naming", label: "Request naming", group: "Configuration", component: RequestNaming },
  { path: "/extensions", label: "Extensions", group: "Configuration", component: Extensions },
  { path: "/vulnerabilities", label: "Vulnerabilities", group: "Security", component: Vulnerabilities },
  { path: "/tokens", label: "API tokens", group: "Security", component: Tokens },
  { path: "/audit", label: "Audit log", group: "Security", component: Audit },
];
