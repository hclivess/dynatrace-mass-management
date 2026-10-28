/** A small stroke icon set (24×24, currentColor), drawn for DMM. */
const PATHS: Record<string, string> = {
  overview: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
  hosts: "M4 5h16v5H4zM4 14h16v5H4zM7.5 7.5h.01M7.5 16.5h.01",
  activegates: "M12 3l8 4v5c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V7zM9 12l2 2 4-4",
  network: "M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9M12 3C9.5 5.5 8.2 8.5 8.2 12s1.3 6.5 3.8 9",
  synthetic: "M3 12h4l2-6 4 12 2-6h6",
  problems: "M12 4l9 16H3zM12 10v4M12 17h.01",
  events: "M13 3L5 14h6l-1 7 8-11h-6z",
  metrics: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  logs: "M5 5h14M5 10h14M5 15h9M5 20h6",
  slos: "M12 3a9 9 0 109 9M12 7a5 5 0 105 5M12 11a1 1 0 101 1M12 12l7-7",
  releases: "M20 12l-8 8-9-9V3h8zM7.5 7.5h.01",
  settings: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
  entities: "M3 7l9-4 9 4-9 4zM3 12l9 4 9-4M3 17l9 4 9-4",
  dashboards: "M4 4h16v16H4zM4 10h16M10 10v10",
  naming: "M4 6h16M4 12h10M4 18h6M17 14l3 3-3 3",
  extensions: "M10 3h4v3a2 2 0 104 0V3h3v7h-3a2 2 0 100 4h3v7h-7v-3a2 2 0 10-4 0v3H3v-7h3a2 2 0 100-4H3V3z",
  vulnerabilities: "M12 3l8 4v5c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V7zM12 8v5M12 16h.01",
  tokens: "M15 7a4 4 0 11-3.5 6L4 20.5V17h3v-3h3l1.5-1.5A4 4 0 0115 7zM16 10h.01",
  audit: "M9 4h6v3H9zM7 5H5v16h14V5h-2M8 12h8M8 16h5",
  environments: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  sun: "M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 7a5 5 0 100 10 5 5 0 000-10z",
  moon: "M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z",
  system: "M3 5h18v11H3zM8 20h8M12 16v4",
  menu: "M4 6h16M4 12h16M4 18h16",
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.overview} />
    </svg>
  );
}
