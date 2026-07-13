export type DeleteReferenceSummary = {
  activeStockQuantity: number;
  historyCount: number;
  relationCount: number;
};

export type DeletePlan =
  | {
      action: "delete";
      canDeactivate: true;
      reason: string;
    }
  | {
      action: "deactivate";
      canDeactivate: true;
      reason: string;
    }
  | {
      action: "blocked";
      canDeactivate: false;
      reason: string;
    };

export function planAdminObjectDelete(summary: DeleteReferenceSummary): DeletePlan {
  if (Math.abs(summary.activeStockQuantity) > 0.000001) {
    return {
      action: "blocked",
      canDeactivate: false,
      reason: "Der er stadig beholdning. Flyt eller nulstil beholdningen før objektet kan slettes eller deaktiveres.",
    };
  }

  if (summary.historyCount > 0 || summary.relationCount > 0) {
    return {
      action: "deactivate",
      canDeactivate: true,
      reason: "Objektet har historik eller relationer og kan derfor ikke slettes permanent. Det kan deaktiveres og skjules fra nye valg.",
    };
  }

  return {
    action: "delete",
    canDeactivate: true,
    reason: "Objektet er ikke brugt endnu og kan slettes permanent.",
  };
}
