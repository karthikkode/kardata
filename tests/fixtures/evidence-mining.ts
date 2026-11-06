export const miningText = [
  "Host: I am a journalist interviewing the team.",
  "Alex: I own Synthetic Practice. We have 12 employees.",
  "[12:30] Alex: We lost 8 hours each week copying files because the systems did not connect.",
  "Alex: We adopted ExampleCRM and hired an outside operator. We paid $300 a month for that help.",
  "Alex: The change saved 5 hours each week. The setup cost us $0.",
  "Taylor: I manage operations at Synthetic Practice. I had to correct the same form twice.",
  "Sam: I sell software to practices. My customers say they waste 10 hours every week.",
].join("\n\n");
const field = (text = "not stated", ...evidence: string[]) => ({ text, evidence });
const amount = (metric: string, stated: string, number: number, unit: string, evidence: string[]) => ({ metric, stated, number, unit,
  period: "not stated", context: "at time of problem" as const, evidence });
export function miningFixture(sourceId = "source-one") {
  const quotes = { owner: "I own Synthetic Practice.", size: "We have 12 employees.",
    problem: "We lost 8 hours each week copying files because the systems did not connect.",
    action: "We adopted ExampleCRM and hired an outside operator.", help: "We paid $300 a month for that help.",
    result: "The change saved 5 hours each week.", zero: "The setup cost us $0.",
    ops: "I manage operations at Synthetic Practice.", rework: "I had to correct the same form twice.",
    vendor: "I sell software to practices.", claim: "My customers say they waste 10 hours every week.",
    journalist: "I am a journalist interviewing the team." };
  const base = { cause: field(), firm_size_at_problem: [], tools: [], tried: [], results: [], time_or_cost_lost: [],
    outside_help: { paid: field(), description: field(), costs: [] } };
  return {
    citations: Object.entries(quotes).map(([id, quote]) => ({ id, source_id: sourceId, quote })),
    speakers: [
      { id: "owner", label: "Alex", role: "firm_owner" as const, role_evidence: ["owner"], firm_size: [amount("employees", "12 employees", 12, "employees", ["size"])] },
      { id: "ops", label: "Taylor", role: "operations" as const, role_evidence: ["ops"], firm_size: [] },
      { id: "vendor", label: "Sam", role: "vendor" as const, role_evidence: ["vendor"], firm_size: [] },
      { id: "host", label: "Host", role: "journalist" as const, role_evidence: ["journalist"], firm_size: [] },
    ],
    tools_named: [field("ExampleCRM", "action")],
    problems: [
      { ...base, theme: "workflow", speaker_id: "owner", basis: "firsthand" as const,
        problem: field("Repeated file copying wastes time", "problem"), cause: field("Disconnected systems", "problem"),
        tools: [field("ExampleCRM", "action")], tried: [field("Adopted a tool and hired outside help", "action")],
        results: [amount("time saved", "5 hours each week", 5, "hours/week", ["result"])],
        time_or_cost_lost: [amount("time lost", "8 hours each week", 8, "hours/week", ["problem"])],
        outside_help: { paid: field("yes", "help"), description: field("outside operator", "action"),
          costs: [amount("outside help", "$300 a month", 300, "USD/month", ["help"]), amount("setup", "$0", 0, "USD", ["zero"])] } },
      { ...base, theme: "workflow", speaker_id: "ops", basis: "firsthand" as const, problem: field("Form rework", "rework") },
      { ...base, theme: "workflow", speaker_id: "vendor", basis: "firsthand" as const, problem: field("Customers lose time", "claim") },
      { ...base, theme: "workflow", speaker_id: "host", basis: "reported" as const, problem: field("Reported customer time loss", "claim") },
    ],
    notes: field(),
  };
}
export const miningThemes = [{ key: "workflow", name: "Workflow", definition: "Repeatable internal process difficulties" }];
