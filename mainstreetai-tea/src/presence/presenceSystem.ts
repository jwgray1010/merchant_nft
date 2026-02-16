export type PresenceSignals = {
  greeting: string;
  badge: string;
  participationLine: string;
};

function periodLabel(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) {
    return "morning";
  }
  if (hour < 18) {
    return "afternoon";
  }
  return "evening";
}

function greetingFor(input: {
  period: "morning" | "afternoon" | "evening";
  level: "low" | "steady" | "rising";
}): string {
  if (input.level === "rising") {
    if (input.period === "morning") {
      return "Good morning - our town is building steady momentum today.";
    }
    if (input.period === "afternoon") {
      return "Good afternoon - our town is moving together at a steady pace.";
    }
    return "Good evening - our town still has a calm local rhythm.";
  }
  if (input.level === "low") {
    if (input.period === "morning") {
      return "Good morning - our town feels calm and steady today.";
    }
    if (input.period === "afternoon") {
      return "Good afternoon - our town is settling into a calm rhythm.";
    }
    return "Good evening - our town is keeping a quiet local pace.";
  }
  if (input.period === "morning") {
    return "Good morning - our town feels steady today.";
  }
  if (input.period === "afternoon") {
    return "Good afternoon - our town has a calm rhythm right now.";
  }
  return "Good evening - our town is moving steadily tonight.";
}

function participationLineFor(level: "low" | "steady" | "rising"): string {
  if (level === "rising") {
    return "We're showing up together today.";
  }
  if (level === "low") {
    return "Neighbors are showing up in small, steady ways.";
  }
  return "Our community is moving steadily today.";
}

function badgeFor(level: "low" | "steady" | "rising"): string {
  if (level === "rising") {
    return "🟢 Town Presence Active";
  }
  if (level === "low") {
    return "🟢 Local Presence Active";
  }
  return "🟢 Local Presence Active";
}

export function buildPresenceSignals(input: {
  confidenceLevel: "low" | "steady" | "rising";
  now?: Date;
}): PresenceSignals {
  const now = input.now ?? new Date();
  const period = periodLabel(now.getHours());
  return {
    greeting: greetingFor({
      period,
      level: input.confidenceLevel,
    }),
    badge: badgeFor(input.confidenceLevel),
    participationLine: participationLineFor(input.confidenceLevel),
  };
}
