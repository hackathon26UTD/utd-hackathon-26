// Explicit test double: no model or network call. Uses the real tools and checkpoint validator.
export function simulatedCompletion(evidence) {
  let round = 0;
  const call = (id, name, args = {}) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  return async ({ messages } = {}) => {
    round++;
    if (round === 1) return { tool_calls: [call('sim_read', 'read_sensor_timeline')] };
    if (round === 2) return { tool_calls: [call('sim_correlate', 'correlate_signals'), call('sim_power', 'plan_power_budget')] };
    // Cite only IDs actually emitted by the read tool, including compact tables.
    const timelineMessage = messages?.find(m => m.role === 'tool' && m.tool_call_id === 'sim_read');
    const timeline = timelineMessage ? JSON.parse(timelineMessage.content) : null;
    const ids = timeline ? [...(timeline.observations || []), ...(timeline.incidents || []), ...(timeline.events || [])].map(r => Array.isArray(r) ? r[0] : r.id) : [];
    return { tool_calls: [call('sim_save', 'save_review_checkpoint', {
      summary: 'SIMULATED AGENT — no NVIDIA inference. Recorded observations and deterministic power policies are attached for human review. Connectivity, occupancy and battery endurance require separate verification.',
      evidenceIds: ids.slice(-6), nextAction: 'check_device_health',
    })] };
  };
}
