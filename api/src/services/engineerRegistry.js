// api/src/services/engineerRegistry.js
// Single source of truth for engineer runtime state

const engineers = new Map();

/** Called on WS connect / heartbeat */
export function upsertEngineerState(state) {
  engineers.set(state.engineerId, {
    ...state,
    lastSeenAt: Date.now(),
  });
}

export function listAvailableEngineers() {
  return Array.from(engineers.values()).filter(
    (e) => e.daoStatus === "CERTIFIED"
  );
}

export function getEngineer(engineerId) {
  return engineers.get(engineerId);
}
