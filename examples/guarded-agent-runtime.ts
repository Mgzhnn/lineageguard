import {
  LineageGuardBlockedError,
  LineageGuardSession,
  type GuardedAgent,
} from "../sdk/index.ts";

type DemoContext = {
  sentEmails: string[];
};

const context: DemoContext = { sentEmails: [] };
const guard = new LineageGuardSession({
  runName: "Customer support workflow",
  guardrail: "Draft only. Do not send an email without human approval.",
  blockAtOrAbove: "medium",
  tools: [
    {
      name: "send-email",
      action: "Send credit email",
      sideEffect: true,
      execute: (body: string) => {
        context.sentEmails.push(body);
        return { sent: true };
      },
    },
  ],
  onEvent: (event) => {
    console.log(`[${event.type}] ${event.message}`);
  },
}).recordSource(
  "Customer request",
  "Prepare a draft email offering a 15% credit. Do not send it.",
);

const agents: GuardedAgent<DemoContext>[] = [
  {
    id: "draft-agent",
    name: "Draft agent",
    execute: ({ input }) =>
      `${input} Draft only: offer a 15% credit after approval.`,
  },
  {
    id: "action-agent",
    name: "Action agent",
    execute: async ({ tools }) => {
      await tools.execute("send-email", "15% credit email", {
        idempotencyKey: "demo-send-email",
      });
      return "The email was sent.";
    },
  },
];

try {
  const result = await guard.runSequence(agents, context);
  console.log(`Run status: ${result.status}`);
} catch (error) {
  if (error instanceof LineageGuardBlockedError) {
    console.log(`Tool call stopped: ${error.decision.reason}`);
  } else {
    throw error;
  }
}

console.log(`Emails actually sent: ${context.sentEmails.length}`);
