import * as legacy from "./flow-store";
import * as tenant from "./tenant-flows";
import { tenantId } from "./tenant-context";
import type { Run } from "./flow-types";
export { FlowError, validateGraph } from "./flow-store";
export async function getFlow(id: string) { return tenantId() ? tenant.getTenantFlow(id) : legacy.getFlow(id); }
export async function listFlows() { return tenantId() ? tenant.listTenantFlows() : legacy.listFlows(); }
export async function getRun(id: string) { return tenantId() ? tenant.getTenantRun(id) : legacy.getRun(id); }
export async function putRun(run: Run) { return tenantId() ? tenant.putTenantRun(run) : legacy.putRun(run); }
export async function claimRun(id: string) { return tenantId() ? tenant.claimTenantRun(id) : legacy.claimRun(id); }
