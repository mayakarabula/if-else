export type StepKind = "trigger" | "action";

export interface IntegrationErrorDetails {
  message: string;
  code?: string;
  integration: string;
  step: string;
  stepLabel: string;
  kind: StepKind;
  /** Human-readable steps this operation planned to run. */
  plan: string[];
  /** Extra fields declared by the step's errorCallback. */
  extras?: Record<string, unknown>;
}

/** Structured failure from a trigger or action — CATCH templates read this as {{error.*}}. */
export class IntegrationError extends Error {
  readonly details: IntegrationErrorDetails;

  constructor(details: IntegrationErrorDetails) {
    super(details.message);
    this.name = "IntegrationError";
    this.details = details;
  }

  toCatchPayload(): Record<string, unknown> {
    return {
      message: this.details.message,
      code: this.details.code ?? "",
      integration: this.details.integration,
      step: this.details.step,
      stepLabel: this.details.stepLabel,
      kind: this.details.kind,
      plan: this.details.plan.join(" → "),
      planSteps: this.details.plan,
      ...(this.details.extras ?? {}),
    };
  }
}

export function toCatchErrorPayload(
  err: unknown,
  fallback?: Partial<IntegrationErrorDetails>,
): Record<string, unknown> {
  if (err instanceof IntegrationError) {
    return err.toCatchPayload();
  }

  const message = err instanceof Error ? err.message : "Unknown error";
  return {
    message,
    code: fallback?.code ?? "",
    integration: fallback?.integration ?? "",
    step: fallback?.step ?? "",
    stepLabel: fallback?.stepLabel ?? "",
    kind: fallback?.kind ?? "",
    plan: (fallback?.plan ?? []).join(" → "),
    planSteps: fallback?.plan ?? [],
    ...(fallback?.extras ?? {}),
  };
}

export function failStep(
  details: Omit<IntegrationErrorDetails, "message"> & { message: string },
): never {
  throw new IntegrationError(details);
}
