// Deployment settings read from the environment, in one place.

/** True when publishing needs every pod's lead to have approved (REQUIRE_POD_APPROVAL=true). Off by default. */
export const podApprovalRequired = (): boolean =>
  ["1", "true", "yes"].includes((process.env.REQUIRE_POD_APPROVAL ?? "").trim().toLowerCase());
