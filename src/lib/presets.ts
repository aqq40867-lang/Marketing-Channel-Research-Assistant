import type { ResearchInput } from "./types";

// Preset example: only the scenario from the brief
export const PRESETS: { label: string; input: ResearchInput }[] = [
  {
    label: "Brief example: task management · UK small businesses",
    input: {
      product: "A task management product for small teams of 1 to 20 people: assign tasks, set deadline reminders and track project progress.",
      audience: "Owners and founders of UK small businesses with 1 to 20 people",
      market: "UK",
      productName: "Marketing Channel Research Assistant",
      productUrl: "https://www.wesgroup.co.uk/index.html",
      collabForms: ["guest_post", "article", "demo"],
      excludeUrls: [],
    },
  },
];
