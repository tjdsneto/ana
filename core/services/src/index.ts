// @core/services — the application service layer. Business logic of each client-facing operation as
// pure functions over the Store port. The MCP tools map the wire protocol onto these; the dashboard
// API calls the same functions. One place for the logic, two transports.

export { requestProduction, requestVideo, type RequestProductionInput, type RequestVideoInput } from "./request.js"
export { getCapabilities } from "./capabilities.js"
export { getDeliverable, getStatus, inbox } from "./reads.js"
export { approve, approveBudget, submitFeedback } from "./gate.js"
