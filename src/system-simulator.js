// Explicit test double: no model or network call. Uses the real tools and checkpoint validator.
export function simulatedCompletion(evidence) {
  let round = 0;
  const call = (id, name, args = {}) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  return async () => {
    round++;
    if (round === 1) return { tool_calls: [call('sim_read', 'read_sensor_timeline')] };
    if (round === 2) return { tool_calls: [call('sim_correlate', 'correlate_signals'), call('sim_power', 'plan_power_budget')] };
    const facts = [...evidence.observations, ...evidence.incidents, ...evidence.events];
    return { tool_calls: [call('sim_save', 'save_review_checkpoint', {
      summary: 'SIMULATED AGENT — no NVIDIA inference. Recorded observations and deterministic power policies are attached for human review. Connectivity, occupancy and battery endurance require separate verification.',
      evidenceIds: facts.slice(-6).map(x => x.id), nextAction: 'check_device_health',
    })] };
  };
}
