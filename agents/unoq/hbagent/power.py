"""Power manager for the Uno Q agent. Pure functions and small dataclasses, no I/O, no clock reads.

What it does
  1. Load model: average milliwatts per mode, built from components (base, radio idle, display,
     USB peripherals, uplink bursts). Every figure is an ESTIMATE until someone measures it with a
     USB power meter and passes `load_basis="bench_measurement"` plus measured overrides.
  2. Runtime estimator: usable energy / average load, with a confidence grade and the assumptions.
  3. Mode ladder (full, eco, survival, beacon) with hysteresis and a last-gasp reserve.
  4. Event-aware rules: a hazard raises reporting only while there is still runway; mains loss
     moves to a runway-preserving schedule; unknown mains counts as lost.
  5. Auto target: choose the highest mode that still meets the outage need, then stretch the
     uplink interval only as far as the target requires. Every decision carries plain sentences.

Consistency with the rest of the repo (see docs/POWER_DESIGN.md)
  - `full` mirrors firmware/common/power_policy.h Normal and domain/system-policy.js `normal`.
  - `eco` mirrors Saver. Reporting 120 s and Wi-Fi retry 300 s are the same constants.
  - A hazard mirrors Critical (report 30 s, Wi-Fi retry 60 s) but only while runway lasts. The
    firmware keeps Critical on regardless because the boxes own sensing; the Uno Q hub is a
    second copy of the record, so it may step down to protect its own last-gasp beacon.
  - `survival` and `beacon` exist only on the hub. They are NOT firmware modes.
  - Reserve fraction defaults to 0.15 and the formula is the same as powerBudget():
    hours = usable Wh x (1 - reserve) / average W.
  - Voltage is never read as usable energy by itself. A voltage-to-percent estimate is allowed
    only when labelled `voltage_estimate`, and it caps the confidence at low.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Optional

MODES = ("full", "eco", "survival", "beacon")
RANK = {m: i for i, m in enumerate(reversed(MODES))}  # higher number = more service
FRESH_S = 120  # same as FRESH_MS in domain/system-policy.js

# Server-side vocabulary (src/live-api.js records `power_mode` readings of these three values).
SERVER_MODE = {"full": "normal", "eco": "saver", "survival": "saver", "beacon": "saver"}
SERVER_MODE_HAZARD = "critical"


@dataclass(frozen=True)
class ModeProfile:
    name: str
    sample_s: int            # local sampling of the hub's own gauges (CPU temperature, load)
    report_s: int            # uplink batch cadence
    max_report_s: int        # longest the auto-target may stretch the cadence
    poll_floor_s: int        # shortest message poll the agent will use in this mode
    wifi_retry_s: int        # minimum gap between failed uplink attempts
    display: bool
    # ESTIMATED load components in mW (see docs/POWER_DESIGN.md, "Estimates, not measurements")
    base_mw: float           # SoC + RAM + MCU idle
    radio_idle_mw: float     # associated Wi-Fi between bursts
    display_mw: float
    peripherals_mw: float    # USB-powered box A and sensors drawn from the hub supply
    burst_mj: float          # one uplink burst (wake, TLS, request, response), millijoules
    poll_mj: float           # one message poll, millijoules


# Mirrors: full == Normal 30 s / 60 s, eco == Saver 120 s / 300 s. survival and beacon are hub-only.
DEFAULT_PROFILES: dict[str, ModeProfile] = {
    "full": ModeProfile("full", 10, 30, 60, 30, 60, True, 1800, 250, 150, 450, 1500, 400),
    "eco": ModeProfile("eco", 30, 120, 240, 60, 300, False, 1400, 120, 0, 350, 1500, 400),
    "survival": ModeProfile("survival", 60, 300, 600, 120, 600, False, 1100, 60, 0, 300, 1500, 400),
    "beacon": ModeProfile("beacon", 120, 900, 1800, 300, 900, False, 900, 40, 0, 250, 1500, 400),
}

# Hazard cadence mirrors firmware Critical: report 30 s, Wi-Fi retry 60 s.
HAZARD_REPORT_S = 30
HAZARD_WIFI_RETRY_S = 60

# Usable fraction of nameplate energy at modest drain (ESTIMATES for planning, not datasheet values).
CHEMISTRY_DERATE = {
    "alkaline_aa": 0.70,   # drops sharply at 300 mA+ and when cold
    "nimh_aa": 0.85,
    "liion": 0.90,         # stops at the protection cutoff, not at 0 V
    "lifepo4": 0.95,
    "lead_acid": 0.50,
    "unknown": 0.70,
}
CHEMISTRY_CELL_V = {"alkaline_aa": 1.5, "nimh_aa": 1.2, "liion": 3.7, "lifepo4": 3.2, "lead_acid": 2.0}


MIN_STEP_DOWN_V = 5.5   # a buck or LDO needs headroom above the 5 V rail; below this it cannot make 5 V


def converter_problem(kind: str, v_in: float) -> Optional[str]:
    """Plain sentence when the converter cannot physically make 5 V from this pack, else None."""
    if kind in ("buck", "ldo") and 0 < v_in < MIN_STEP_DOWN_V:
        return (f"a {kind} converter cannot make 5 V from a {v_in:g} V pack (it only steps down, and needs about "
                f"{MIN_STEP_DOWN_V:g} V or more in): use boost, or a 2S pack.")
    return None


def converter_efficiency(kind: str, v_in: float, v_out: float = 5.0, buck_eff: float = 0.88) -> float:
    """LDO efficiency is v_out / v_in (the difference is burned as heat). A buck is mostly flat."""
    if kind == "ldo":
        return max(0.05, min(1.0, v_out / v_in)) if v_in > 0 else 0.05
    if kind == "boost":
        return 0.85
    return buck_eff


@dataclass(frozen=True)
class Battery:
    capacity_mah: float                 # nameplate; the energy you would get at the nominal voltage
    nominal_v: float                    # pack nominal voltage at the converter input
    soc_pct: Optional[float] = None     # state of charge 0..100
    soc_source: str = "assumed"         # gauge | manual | voltage_estimate | integrated_estimate | assumed
    chemistry: str = "unknown"
    converter_eff: float = 0.88
    derate: Optional[float] = None      # None = chemistry default

    def nameplate_wh(self) -> float:
        return max(0.0, self.capacity_mah) * max(0.0, self.nominal_v) / 1000.0

    def usable_wh(self) -> float:
        """Remaining energy at the 5 V rail after derating and conversion losses."""
        derate = self.derate if self.derate is not None else CHEMISTRY_DERATE.get(self.chemistry, 0.70)
        soc = 100.0 if self.soc_pct is None else min(100.0, max(0.0, self.soc_pct))
        return self.nameplate_wh() * (soc / 100.0) * derate * min(1.0, max(0.01, self.converter_eff))


def soc_from_voltage(chemistry: str, cell_v: float) -> Optional[float]:
    """Coarse resting-voltage map. ESTIMATE ONLY: load, temperature and age move these a lot."""
    curves = {
        "liion": [(3.0, 0), (3.3, 5), (3.6, 30), (3.7, 50), (3.9, 70), (4.1, 92), (4.2, 100)],
        "lifepo4": [(2.9, 0), (3.2, 20), (3.25, 50), (3.3, 80), (3.4, 100)],
        "alkaline_aa": [(0.9, 0), (1.1, 15), (1.25, 50), (1.4, 85), (1.55, 100)],
        "nimh_aa": [(1.0, 0), (1.15, 20), (1.2, 60), (1.3, 100)],
    }
    pts = curves.get(chemistry)
    if not pts or cell_v is None:
        return None
    if cell_v <= pts[0][0]:
        return float(pts[0][1])
    for (v0, p0), (v1, p1) in zip(pts, pts[1:]):
        if cell_v <= v1:
            return p0 + (p1 - p0) * (cell_v - v0) / (v1 - v0)
    return float(pts[-1][1])


@dataclass(frozen=True)
class PowerConfig:
    profiles: dict = field(default_factory=lambda: dict(DEFAULT_PROFILES))
    load_basis: str = "assumption"        # assumption | partial_measurement | bench_measurement (mirrors powerBudget)
    reserve_fraction: float = 0.15        # same default as domain/system-policy.js
    last_gasp_hours: float = 2.0          # beacon-only heartbeat the pack must still be able to run
    final_status_mj: float = 3000.0       # one last status upload
    need_hours: float = 24.0              # outage length we are trying to ride out
    hazard_min_runway_h: float = 3.0      # a hazard may raise service only while this much runway remains
    up_margin: float = 0.20               # stepping up needs 20 % more runway than the need
    up_dwell_s: float = 600.0
    down_dwell_s: float = 60.0
    stretch_margin: float = 0.05
    override_min_runway_h: float = 1.0

    def with_measured(self, mw: dict, basis: Optional[str] = None) -> "PowerConfig":
        """Replace the estimated average load of a mode with a USB-meter measurement (mW).

        The basis is `bench_measurement` only when all four modes were measured. Fewer than four is
        `partial_measurement`: the unmeasured modes stay estimates, so confidence is capped at medium.
        """
        profs = dict(self.profiles)
        measured = {name for name, value in mw.items() if name in profs and value and value > 0}
        if basis is None:
            basis = "bench_measurement" if measured >= set(MODES) else "partial_measurement"
        for name, value in mw.items():
            if name in profs and value and value > 0:
                p = profs[name]
                fixed = p.radio_idle_mw + p.display_mw + p.peripherals_mw + p.burst_mj / p.report_s + p.poll_mj / p.poll_floor_s
                profs[name] = replace(p, base_mw=max(0.0, float(value) - fixed))
        return replace(self, profiles=profs, load_basis=basis)


def avg_load_mw(p: ModeProfile, report_s: Optional[float] = None, poll_s: Optional[float] = None) -> float:
    """Average draw at the 5 V rail. Bursts are amortised over the interval (mJ / s = mW)."""
    r = float(report_s or p.report_s)
    q = float(poll_s or p.poll_floor_s)
    return p.base_mw + p.radio_idle_mw + p.display_mw + p.peripherals_mw + p.burst_mj / r + p.poll_mj / q


def last_gasp_wh(cfg: PowerConfig) -> float:
    beacon = cfg.profiles["beacon"]
    return avg_load_mw(beacon) * cfg.last_gasp_hours / 1000.0 + cfg.final_status_mj / 3.6e6  # mJ to Wh


def reserve_wh(batt: Battery, cfg: PowerConfig) -> float:
    """Held back from service: the larger of the 15 % fraction and the last-gasp energy."""
    return max(batt.usable_wh() * cfg.reserve_fraction, last_gasp_wh(cfg))


def available_wh(batt: Battery, cfg: PowerConfig) -> float:
    return max(0.0, batt.usable_wh() - reserve_wh(batt, cfg))


def hours_at(batt: Battery, cfg: PowerConfig, mode: str, report_s: Optional[float] = None) -> float:
    mw = avg_load_mw(cfg.profiles[mode], report_s)
    return available_wh(batt, cfg) * 1000.0 / mw if mw > 0 else float("inf")


def confidence(batt: Optional[Battery], cfg: PowerConfig) -> tuple[str, list[str]]:
    notes: list[str] = []
    if batt is None:
        return "none", ["No battery information was given, so there is no runway estimate."]
    score = 0
    if cfg.load_basis == "bench_measurement":
        score += 1
    elif cfg.load_basis == "partial_measurement":
        notes.append("Only some modes were measured with a power meter; the rest are estimates.")
    else:
        notes.append("Loads are estimates, not measured with a power meter.")
    if batt.soc_source == "gauge":
        score += 1
    elif batt.soc_source == "voltage_estimate":
        notes.append("Charge is guessed from battery voltage, which is rough.")
    elif batt.soc_source == "integrated_estimate":
        notes.append("Charge is an integrated estimate: the entered starting charge minus energy counted from assumed loads. It is not a gauge.")
    elif batt.soc_source == "manual":
        notes.append("Charge was entered by hand.")
        score += 0
    else:
        notes.append("Charge is assumed, not measured.")
    notes.append(f"Usable energy uses a {int((batt.derate if batt.derate is not None else CHEMISTRY_DERATE.get(batt.chemistry, 0.7)) * 100)} percent derating for {batt.chemistry} and {int(batt.converter_eff * 100)} percent converter efficiency (assumed).")
    if batt.soc_source == "voltage_estimate":
        return "low", notes
    return ("high" if score == 2 else "medium" if score == 1 else "low"), notes


@dataclass(frozen=True)
class PowerInputs:
    battery: Optional[Battery] = None
    mains: str = "unknown"              # present | lost | unknown  (unknown is treated as lost)
    hazard: bool = False
    override_mode: Optional[str] = None  # operator or local request, None = auto
    override_active: bool = False        # caller drops expired overrides


@dataclass(frozen=True)
class LadderState:
    mode: Optional[str] = None
    since_s: float = 0.0
    hazard_boost: bool = False


@dataclass
class Decision:
    mode: str
    hazard_boost: bool
    report_s: int
    sample_s: int
    poll_floor_s: int
    wifi_retry_s: int
    display: bool
    avg_mw: float
    hours_remaining: Optional[float]       # full-service hours before the last-gasp reserve
    hours_with_beacon_tail: Optional[float]  # plus the heartbeat reserve
    target_hours: float
    meets_target: Optional[bool]
    confidence: str
    basis: str
    last_gasp_active: bool
    reserve_wh: Optional[float]
    server_mode: str
    changed: bool
    reasons: list[str]
    assumptions: list[str]
    table: list[dict] = field(default_factory=list)

    def summary(self) -> str:
        return " ".join(self.reasons)


def _h(x: Optional[float]) -> str:
    if x is None:
        return "an unknown number of"
    if x == float("inf"):
        return "unlimited"
    return f"{x:.1f}" if x < 100 else f"{x:.0f}"


def mode_table(batt: Optional[Battery], cfg: PowerConfig, need: float) -> list[dict]:
    rows = []
    for m in MODES:
        p = cfg.profiles[m]
        mw = avg_load_mw(p)
        h = hours_at(batt, cfg, m) if batt else None
        rows.append({"mode": m, "report_s": p.report_s, "poll_floor_s": p.poll_floor_s, "avg_mw": round(mw, 1),
                     "hours": None if h is None else round(h, 1), "meets_target": None if h is None else h >= need})
    return rows


def _stretch(batt: Battery, cfg: PowerConfig, mode: str, need: float):
    """Smallest report interval inside the mode's allowed range that meets need with a small margin."""
    p = cfg.profiles[mode]
    target = need * (1 + cfg.stretch_margin)
    r = float(p.report_s)
    while True:
        if hours_at(batt, cfg, mode, r) >= target or r >= p.max_report_s:
            return int(min(r, p.max_report_s))
        r = min(float(p.max_report_s), r * 1.25)


def decide(inp: PowerInputs, state: LadderState, now_s: float, cfg: PowerConfig = PowerConfig()) -> tuple[Decision, LadderState]:
    need = cfg.need_hours
    batt = inp.battery
    reasons: list[str] = []
    conf, assumptions = confidence(batt, cfg)
    on_mains = inp.mains == "present"
    table = mode_table(batt, cfg, need)
    last_gasp = False
    hazard_boost = False
    report_s = None
    hours = None

    if on_mains:
        auto = "full"
        reasons.append("Wall power is present, so the hub runs at full service.")
        if batt is not None:
            reasons.append("The battery is only a backup right now.")
    elif batt is None:
        auto = "full" if inp.hazard else "eco"
        why = "mains power is lost" if inp.mains == "lost" else "mains power is unknown, which is treated as lost"
        reasons.append(f"The hub is off wall power ({why}) and no battery size is known, so it cannot promise any runway.")
        reasons.append("A hazard keeps reporting at the fast rate because there is nothing to protect." if inp.hazard
                       else "It is saving power by reporting every few minutes.")
        hazard_boost = inp.hazard
    else:
        why = "Mains power is lost" if inp.mains == "lost" else "Mains power is unknown, which is treated as lost"
        avail = available_wh(batt, cfg)
        rsv = reserve_wh(batt, cfg)
        hours_by = {m: hours_at(batt, cfg, m) for m in MODES}
        if avail <= 0:
            auto = "beacon"
            last_gasp = True
            reasons.append(f"{why}. The battery is down to the last-gasp reserve of {rsv:.1f} Wh, so only the heartbeat beacon runs.")
        else:
            meeting = [m for m in MODES if hours_by[m] >= need]
            if meeting:
                auto = meeting[0]
                reasons.append(f"{why}. {auto.capitalize()} mode can last about {_h(hours_by[auto])} hours, which covers the {need:g} hour outage target.")
            else:
                auto = "beacon"
                reasons.append(f"{why}. No mode reaches the {need:g} hour target. Beacon mode gets the furthest, about {_h(hours_by['beacon'])} hours before the reserve.")
        # Event-aware: a hazard may raise service only while it still has runway.
        if inp.hazard and not last_gasp:
            for cand in ("full", "eco"):
                if hours_by[cand] >= cfg.hazard_min_runway_h and RANK[cand] >= RANK[auto]:
                    raised = RANK[cand] > RANK[auto]
                    auto, hazard_boost = cand, True
                    if raised:
                        reasons.append(f"A hazard is active, so reporting is raised to {cand} while the battery still has about {_h(hours_by[cand])} hours of runway.")
                    else:
                        reasons.append(f"A hazard is active, so reports go out at the fast rate for as long as the battery has runway (about {_h(hours_by[cand])} hours).")
                    break
            else:
                reasons.append("A hazard is active, but raising reporting would drain the battery too fast, so the saved-power rate stays.")
        elif inp.hazard and last_gasp:
            reasons.append("A hazard is active, but the battery is at the last-gasp reserve, so only the beacon and critical events go out.")
    # Operator or local override (lower is always allowed, higher only with runway).
    chosen = auto
    if inp.override_active and inp.override_mode in MODES:
        om = inp.override_mode
        if RANK[om] > RANK[auto] and batt is not None and not on_mains and hours_at(batt, cfg, om) < cfg.override_min_runway_h:
            reasons.append(f"A request for {om} mode was refused because the battery could not run it for {cfg.override_min_runway_h:g} hour.")
        else:
            chosen = om
            reasons.append(f"Mode is held at {om} by request.")
            hazard_boost = False
    # Hysteresis: no flapping between modes.
    if state.mode and chosen != state.mode and not (inp.override_active and inp.override_mode == chosen):
        dwell = now_s - state.since_s
        if RANK[chosen] > RANK[state.mode]:
            if hazard_boost:
                ok_up = True
            elif on_mains or batt is None:
                ok_up = dwell >= 30.0
            else:
                ok_up = dwell >= cfg.up_dwell_s and hours_at(batt, cfg, chosen) >= need * (1 + cfg.up_margin)
            if not ok_up:
                reasons.append(f"Staying in {state.mode} mode for now so the hub does not flap; stepping up to {chosen} needs more spare runway or time.")
                chosen = state.mode
        else:
            urgent = batt is not None and not on_mains and hours_at(batt, cfg, state.mode) < need * 0.8
            if dwell < cfg.down_dwell_s and not urgent and not last_gasp:
                reasons.append(f"Holding {state.mode} mode briefly before stepping down to {chosen}.")
                chosen = state.mode
    prof = cfg.profiles[chosen]
    report_s = prof.report_s
    wifi_retry = prof.wifi_retry_s
    if hazard_boost and chosen in ("full", "eco"):
        report_s = min(report_s, HAZARD_REPORT_S)
        wifi_retry = min(wifi_retry, HAZARD_WIFI_RETRY_S)
    elif batt is not None and not on_mains and not last_gasp and not (inp.override_active and inp.override_mode == chosen):
        stretched = _stretch(batt, cfg, chosen, need)
        if stretched > report_s:
            reasons.append(f"The report interval was stretched from {report_s} to {stretched} seconds to help reach the target.")
            report_s = stretched
    if batt is not None:
        hours = hours_at(batt, cfg, chosen, report_s) if available_wh(batt, cfg) > 0 else 0.0
        tail = cfg.last_gasp_hours
        total = hours + tail
        meets = hours >= need
        if not on_mains and not meets and not last_gasp:
            short = need - hours
            need_wh = short * avg_load_mw(prof, report_s) / 1000.0 / max(0.01, 1 - cfg.reserve_fraction)
            reasons.append(f"At this rate the hub runs about {_h(hours)} hours, then keeps the beacon going for about {_h(tail)} more; the target is short by about {_h(short)} hours or roughly {need_wh:.1f} Wh of extra usable battery.")
        elif not on_mains:
            reasons.append(f"At this rate the hub runs about {_h(hours)} hours, then keeps the beacon going for about {_h(tail)} more.")
        if conf in ("low", "none"):
            reasons.append("Treat these hours as a planning figure; they rest on estimates.")
    else:
        total = None
        meets = None
    changed = chosen != state.mode
    new_state = LadderState(chosen, now_s if changed else state.since_s, hazard_boost)
    avg = avg_load_mw(prof, report_s)
    dec = Decision(
        mode=chosen, hazard_boost=hazard_boost, report_s=int(report_s), sample_s=prof.sample_s, poll_floor_s=prof.poll_floor_s,
        wifi_retry_s=wifi_retry, display=prof.display, avg_mw=round(avg, 1),
        hours_remaining=None if hours is None else round(hours, 1),
        hours_with_beacon_tail=None if total is None else round(total, 1),
        target_hours=need, meets_target=meets, confidence=conf, basis=cfg.load_basis, last_gasp_active=last_gasp,
        reserve_wh=None if batt is None else round(reserve_wh(batt, cfg), 2),
        server_mode=SERVER_MODE_HAZARD if hazard_boost else SERVER_MODE[chosen], changed=changed, reasons=reasons,
        assumptions=assumptions, table=table,
    )
    return dec, new_state


def plan(batt: Optional[Battery], cfg: PowerConfig = PowerConfig(), mains: str = "lost", hazard: bool = False) -> Decision:
    """One-shot plan with no history, for the power-plan command and documentation."""
    dec, _ = decide(PowerInputs(batt, mains, hazard), LadderState(), 0.0, cfg)
    return dec
