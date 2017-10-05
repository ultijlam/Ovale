import { OvaleDebug } from "./Debug";
import { OvalePool } from "./Pool";
import { OvaleProfiler } from "./Profiler";
import { Ovale } from "./Ovale";
import { OvaleAura } from "./Aura";
import { OvaleCooldown, cooldownState } from "./Cooldown";
import { OvaleData } from "./Data";
import { OvaleGUID } from "./GUID";
import { OvalePaperDoll, paperDollState } from "./PaperDoll";
import { OvaleScore } from "./Score";
import { OvaleSpellBook } from "./SpellBook";
import { OvaleState } from "./State";

let OvaleFutureBase = Ovale.NewModule("OvaleFuture", "AceEvent-3.0");
let _assert = assert;
let _ipairs = ipairs;
let _pairs = pairs;
let strsub = string.sub;
let tinsert = table.insert;
let tremove = table.remove;
let _type = type;
let _wipe = wipe;
let API_GetSpellInfo = GetSpellInfo;
let API_GetTime = GetTime;
let API_UnitCastingInfo = UnitCastingInfo;
let API_UnitChannelInfo = UnitChannelInfo;
let API_UnitExists = UnitExists;
let API_UnitGUID = UnitGUID;
let API_UnitName = UnitName;
let self_playerGUID = undefined;
let self_pool = new OvalePool<SpellCast>("OvaleFuture_pool");
let self_timeAuraAdded = undefined;
let self_modules = {
}
let CLEU_AURA_EVENT = {
    SPELL_AURA_APPLIED: "hit",
    SPELL_AURA_APPLIED_DOSE: "hit",
    SPELL_AURA_BROKEN: "hit",
    SPELL_AURA_BROKEN_SPELL: "hit",
    SPELL_AURA_REFRESH: "hit",
    SPELL_AURA_REMOVED: "hit",
    SPELL_AURA_REMOVED_DOSE: "hit"
}
let CLEU_SPELLCAST_FINISH_EVENT = {
    SPELL_DAMAGE: "hit",
    SPELL_DISPEL: "hit",
    SPELL_DISPEL_FAILED: "miss",
    SPELL_HEAL: "hit",
    SPELL_INTERRUPT: "hit",
    SPELL_MISSED: "miss",
    SPELL_STOLEN: "hit"
}
let CLEU_SPELLCAST_EVENT = {
    SPELL_CAST_FAILED: true,
    SPELL_CAST_START: true,
    SPELL_CAST_SUCCESS: true
}
{
    for (const [cleuEvent, v] of _pairs(CLEU_AURA_EVENT)) {
        CLEU_SPELLCAST_FINISH_EVENT[cleuEvent] = v;
    }
    for (const [cleuEvent, v] of _pairs(CLEU_SPELLCAST_FINISH_EVENT)) {
        CLEU_SPELLCAST_EVENT[cleuEvent] = true;
    }
}
let SPELLCAST_AURA_ORDER = {
    1: "target",
    2: "pet"
}
let UNKNOWN_GUID = 0;
let SPELLAURALIST_AURA_VALUE = {
    count: true,
    extend: true,
    refresh: true,
    refresh_keep_snapshot: true
}
let WHITE_ATTACK = {
    [75]: true,
    [5019]: true,
    [6603]: true
}
let WHITE_ATTACK_NAME = {
}
{
    for (const [spellId] of _pairs(WHITE_ATTACK)) {
        let [name] = API_GetSpellInfo(spellId);
        if (name) {
            WHITE_ATTACK_NAME[name] = true;
        }
    }
}
let SIMULATOR_LAG = 0.005;

const IsSameSpellcast = function(a, b) {
    let boolean = (a.spellId == b.spellId && a.queued == b.queued);
    if (boolean) {
        if (a.channel || b.channel) {
            if (a.channel != b.channel) {
                boolean = false;
            }
        } else if (a.lineId != b.lineId) {
            boolean = false;
        }
    }
    return boolean;
}
let eventDebug = false;

interface SpellCast {
    stop?: number;
    start?: number;
    lineId?: number;
    spellId?: number;
    spellName?: string;
    targetName?: string;
    target?: string;
    queued?: number;
    success?: number;
    auraId?: number;
    auraGUID?: string;
    channel?: boolean;
    caster?: string;
    offgcd?:number;
}

class OvaleFutureClass extends OvaleProfiler.RegisterProfiling(OvaleDebug.RegisterDebugging(OvaleFutureBase)) {
    inCombat = undefined;
    combatStartTime = undefined;
    queue: LuaArray<SpellCast> = {    }
    lastCastTime = {    }
    lastSpellcast = undefined;
    lastGCDSpellcast: SpellCast = {}
    lastOffGCDSpellcast: SpellCast = {    }
    counter = {    }

    OnInitialize() {
    }
    OnEnable() {
        self_playerGUID = Ovale.playerGUID;
        this.RegisterEvent("COMBAT_LOG_EVENT_UNFILTERED");
        this.RegisterEvent("PLAYER_ENTERING_WORLD");
        this.RegisterEvent("PLAYER_REGEN_DISABLED");
        this.RegisterEvent("PLAYER_REGEN_ENABLED");
        this.RegisterEvent("UNIT_SPELLCAST_CHANNEL_START");
        this.RegisterEvent("UNIT_SPELLCAST_CHANNEL_STOP");
        this.RegisterEvent("UNIT_SPELLCAST_CHANNEL_UPDATE");
        this.RegisterEvent("UNIT_SPELLCAST_DELAYED");
        this.RegisterEvent("UNIT_SPELLCAST_FAILED", "UnitSpellcastEnded");
        this.RegisterEvent("UNIT_SPELLCAST_FAILED_QUIET", "UnitSpellcastEnded");
        this.RegisterEvent("UNIT_SPELLCAST_INTERRUPTED", "UnitSpellcastEnded");
        this.RegisterEvent("UNIT_SPELLCAST_SENT");
        this.RegisterEvent("UNIT_SPELLCAST_START");
        this.RegisterEvent("UNIT_SPELLCAST_STOP", "UnitSpellcastEnded");
        this.RegisterEvent("UNIT_SPELLCAST_SUCCEEDED");
        this.RegisterMessage("Ovale_AuraAdded");
    }
    OnDisable() {
        this.UnregisterEvent("COMBAT_LOG_EVENT_UNFILTERED");
        this.UnregisterEvent("PLAYER_ENTERING_WORLD");
        this.UnregisterEvent("PLAYER_REGEN_DISABLED");
        this.UnregisterEvent("PLAYER_REGEN_ENABLED");
        this.UnregisterEvent("UNIT_SPELLCAST_CHANNEL_START");
        this.UnregisterEvent("UNIT_SPELLCAST_CHANNEL_STOP");
        this.UnregisterEvent("UNIT_SPELLCAST_CHANNEL_UPDATE");
        this.UnregisterEvent("UNIT_SPELLCAST_DELAYED");
        this.UnregisterEvent("UNIT_SPELLCAST_FAILED");
        this.UnregisterEvent("UNIT_SPELLCAST_FAILED_QUIET");
        this.UnregisterEvent("UNIT_SPELLCAST_INTERRUPTED");
        this.UnregisterEvent("UNIT_SPELLCAST_SENT");
        this.UnregisterEvent("UNIT_SPELLCAST_START");
        this.UnregisterEvent("UNIT_SPELLCAST_STOP");
        this.UnregisterEvent("UNIT_SPELLCAST_SUCCEEDED");
        this.UnregisterMessage("Ovale_AuraAdded");
    }
    COMBAT_LOG_EVENT_UNFILTERED(event, timestamp, cleuEvent, hideCaster, sourceGUID, sourceName, sourceFlags, sourceRaidFlags, destGUID, destName, destFlags, destRaidFlags, ...__args) {
        let [arg12, arg13, arg14, arg15, arg16, arg17, arg18, arg19, arg20, arg21, arg22, arg23, arg24, arg25] = __args;
        if (sourceGUID == self_playerGUID || OvaleGUID.IsPlayerPet(sourceGUID)) {
            this.StartProfiling("OvaleFuture_COMBAT_LOG_EVENT_UNFILTERED");
            if (CLEU_SPELLCAST_EVENT[cleuEvent]) {
                let now = API_GetTime();
                let [spellId, spellName] = [arg12, arg13];
                let eventDebug = false;
                let delta = 0;
                if (strsub(cleuEvent, 1, 11) == "SPELL_CAST_" && (destName && destName != "")) {
                    if (!eventDebug) {
                        this.DebugTimestamp("CLEU", cleuEvent, sourceName, sourceGUID, destName, destGUID, spellId, spellName);
                        eventDebug = true;
                    }
                    let [spellcast] = this.GetSpellcast(spellName, spellId, undefined, now);
                    if (spellcast && spellcast.targetName && spellcast.targetName == destName && spellcast.target != destGUID) {
                        this.Debug("Disambiguating target of spell %s (%d) to %s (%s).", spellName, spellId, destName, destGUID);
                        spellcast.target = destGUID;
                    }
                }
                let finish = CLEU_SPELLCAST_FINISH_EVENT[cleuEvent];
                if (cleuEvent == "SPELL_DAMAGE" || cleuEvent == "SPELL_HEAL") {
                    let [isOffHand, multistrike] = [arg24, arg25];
                    if (isOffHand || multistrike) {
                        finish = undefined;
                    }
                }
                if (finish) {
                    let anyFinished = false;
                    for (let i = lualength(this.queue); i >= 1; i += -1) {
                        let spellcast = this.queue[i];
                        if (spellcast.success && (spellcast.spellId == spellId || spellcast.auraId == spellId)) {
                            if (this.FinishSpell(spellcast, cleuEvent, sourceName, sourceGUID, destName, destGUID, spellId, spellName, delta, finish, i)) {
                                anyFinished = true;
                            }
                        }
                    }
                    if (!anyFinished) {
                        this.Debug("No spell found for %s (%d)", spellName, spellId);
                        for (let i = lualength(this.queue); i >= 1; i += -1) {
                            let spellcast = this.queue[i];
                            if (spellcast.success && (spellcast.spellName == spellName)) {
                                if (this.FinishSpell(spellcast, cleuEvent, sourceName, sourceGUID, destName, destGUID, spellId, spellName, delta, finish, i)) {
                                    anyFinished = true;
                                }
                            }
                        }
                        if (!anyFinished) {
                            this.Debug("No spell found for %s", spellName, spellId);
                        }
                    }
                }
            }
            this.StopProfiling("OvaleFuture_COMBAT_LOG_EVENT_UNFILTERED");
        }
    }
    FinishSpell(spellcast, cleuEvent, sourceName, sourceGUID, destName, destGUID, spellId, spellName, delta, finish, i) {
        let finished = false;
        if (!spellcast.auraId) {
            if (!eventDebug) {
                this.DebugTimestamp("CLEU", cleuEvent, sourceName, sourceGUID, destName, destGUID, spellId, spellName);
                eventDebug = true;
            }
            if (!spellcast.channel) {
                this.Debug("Finished (%s) spell %s (%d) queued at %s due to %s.", finish, spellName, spellId, spellcast.queued, cleuEvent);
                finished = true;
            }
        } else if (CLEU_AURA_EVENT[cleuEvent] && spellcast.auraGUID && destGUID == spellcast.auraGUID) {
            if (!eventDebug) {
                this.DebugTimestamp("CLEU", cleuEvent, sourceName, sourceGUID, destName, destGUID, spellId, spellName);
                eventDebug = true;
            }
            this.Debug("Finished (%s) spell %s (%d) queued at %s after seeing aura %d on %s.", finish, spellName, spellId, spellcast.queued, spellcast.auraId, spellcast.auraGUID);
            finished = true;
        }
        if (finished) {
            let now = API_GetTime();
            if (self_timeAuraAdded) {
                if (IsSameSpellcast(spellcast, this.lastGCDSpellcast)) {
                    this.UpdateSpellcastSnapshot(this.lastGCDSpellcast, self_timeAuraAdded);
                }
                if (IsSameSpellcast(spellcast, this.lastOffGCDSpellcast)) {
                    this.UpdateSpellcastSnapshot(this.lastOffGCDSpellcast, self_timeAuraAdded);
                }
            }
            let delta = now - spellcast.stop;
            let targetGUID = spellcast.target;
            this.Debug("Spell %s (%d) was in flight for %s seconds.", spellName, spellId, delta);
            tremove(this.queue, i);
            self_pool.Release(spellcast);
            Ovale.refreshNeeded[self_playerGUID] = true;
            this.SendMessage("Ovale_SpellFinished", now, spellId, targetGUID, finish);
        }
        return finished;
    }
    PLAYER_ENTERING_WORLD(event) {
        this.StartProfiling("OvaleFuture_PLAYER_ENTERING_WORLD");
        this.Debug(event);
        this.StopProfiling("OvaleFuture_PLAYER_ENTERING_WORLD");
    }
    PLAYER_REGEN_DISABLED(event) {
        this.StartProfiling("OvaleFuture_PLAYER_REGEN_DISABLED");
        this.Debug(event, "Entering combat.");
        let now = API_GetTime();
        Ovale.inCombat = true;
        this.combatStartTime = now;
        Ovale.refreshNeeded[self_playerGUID] = true;
        this.SendMessage("Ovale_CombatStarted", now);
        this.StopProfiling("OvaleFuture_PLAYER_REGEN_DISABLED");
    }
    PLAYER_REGEN_ENABLED(event) {
        this.StartProfiling("OvaleFuture_PLAYER_REGEN_ENABLED");
        this.Debug(event, "Leaving combat.");
        let now = API_GetTime();
        Ovale.inCombat = false;
        Ovale.refreshNeeded[self_playerGUID] = true;
        this.SendMessage("Ovale_CombatEnded", now);
        this.StopProfiling("OvaleFuture_PLAYER_REGEN_ENABLED");
    }
    UNIT_SPELLCAST_CHANNEL_START(event, unitId, spell, rank, lineId, spellId) {
        if ((unitId == "player" || unitId == "pet") && !WHITE_ATTACK[spellId]) {
            this.StartProfiling("OvaleFuture_UNIT_SPELLCAST_CHANNEL_START");
            this.DebugTimestamp(event, unitId, spell, rank, lineId, spellId);
            let now = API_GetTime();
            let [spellcast] = this.GetSpellcast(spell, spellId, undefined, now);
            if (spellcast) {
                let [name, _1, _2, _3, startTime, endTime] = API_UnitChannelInfo(unitId);
                if (name == spell) {
                    startTime = startTime / 1000;
                    endTime = endTime / 1000;
                    spellcast.channel = true;
                    spellcast.spellId = spellId;
                    spellcast.success = now;
                    spellcast.start = startTime;
                    spellcast.stop = endTime;
                    let delta = now - spellcast.queued;
                    this.Debug("Channelling spell %s (%d): start = %s (+%s), ending = %s", spell, spellId, startTime, delta, endTime);
                    this.SaveSpellcastInfo(spellcast, now);
                    this.UpdateLastSpellcast(now, spellcast);
                    this.UpdateCounters(spellId, spellcast.start, spellcast.target);
                    OvaleScore.ScoreSpell(spellId);
                    Ovale.refreshNeeded[self_playerGUID] = true;
                } else if (!name) {
                    this.Debug("Warning: not channelling a spell.");
                } else {
                    this.Debug("Warning: channelling unexpected spell %s", name);
                }
            } else {
                this.Debug("Warning: channelling spell %s (%d) without previous UNIT_SPELLCAST_SENT.", spell, spellId);
            }
            this.StopProfiling("OvaleFuture_UNIT_SPELLCAST_CHANNEL_START");
        }
    }
    UNIT_SPELLCAST_CHANNEL_STOP(event, unitId, spell, rank, lineId, spellId) {
        if ((unitId == "player" || unitId == "pet") && !WHITE_ATTACK[spellId]) {
            this.StartProfiling("OvaleFuture_UNIT_SPELLCAST_CHANNEL_STOP");
            this.DebugTimestamp(event, unitId, spell, rank, lineId, spellId);
            let now = API_GetTime();
            let [spellcast, index] = this.GetSpellcast(spell, spellId, undefined, now);
            if (spellcast && spellcast.channel) {
                this.Debug("Finished channelling spell %s (%d) queued at %s.", spell, spellId, spellcast.queued);
                spellcast.stop = now;
                this.UpdateLastSpellcast(now, spellcast);
                let targetGUID = spellcast.target;
                tremove(this.queue, index);
                self_pool.Release(spellcast);
                Ovale.refreshNeeded[self_playerGUID] = true;
                this.SendMessage("Ovale_SpellFinished", now, spellId, targetGUID, "hit");
            }
            this.StopProfiling("OvaleFuture_UNIT_SPELLCAST_CHANNEL_STOP");
        }
    }
    UNIT_SPELLCAST_CHANNEL_UPDATE(event, unitId, spell, rank, lineId, spellId) {
        if ((unitId == "player" || unitId == "pet") && !WHITE_ATTACK[spellId]) {
            this.StartProfiling("OvaleFuture_UNIT_SPELLCAST_CHANNEL_UPDATE");
            this.DebugTimestamp(event, unitId, spell, rank, lineId, spellId);
            let now = API_GetTime();
            let [spellcast] = this.GetSpellcast(spell, spellId, undefined, now);
            if (spellcast && spellcast.channel) {
                let [name, _1, _2, _3, startTime, endTime] = API_UnitChannelInfo(unitId);
                if (name == spell) {
                    startTime = startTime / 1000;
                    endTime = endTime / 1000;
                    let delta = endTime - spellcast.stop;
                    spellcast.start = startTime;
                    spellcast.stop = endTime;
                    this.Debug("Updating channelled spell %s (%d) to ending = %s (+%s).", spell, spellId, endTime, delta);
                    Ovale.refreshNeeded[self_playerGUID] = true;
                } else if (!name) {
                    this.Debug("Warning: not channelling a spell.");
                } else {
                    this.Debug("Warning: delaying unexpected channelled spell %s.", name);
                }
            } else {
                this.Debug("Warning: no queued, channelled spell %s (%d) found to update.", spell, spellId);
            }
            this.StopProfiling("OvaleFuture_UNIT_SPELLCAST_CHANNEL_UPDATE");
        }
    }
    UNIT_SPELLCAST_DELAYED(event, unitId, spell, rank, lineId, spellId) {
        if ((unitId == "player" || unitId == "pet") && !WHITE_ATTACK[spellId]) {
            this.StartProfiling("OvaleFuture_UNIT_SPELLCAST_DELAYED");
            this.DebugTimestamp(event, unitId, spell, rank, lineId, spellId);
            let now = API_GetTime();
            let [spellcast] = this.GetSpellcast(spell, spellId, lineId, now);
            if (spellcast) {
                let [name, _1, _2, _3, startTime, endTime, _, castId] = API_UnitCastingInfo(unitId);
                if (lineId == castId && name == spell) {
                    startTime = startTime / 1000;
                    endTime = endTime / 1000;
                    let delta = endTime - spellcast.stop;
                    spellcast.start = startTime;
                    spellcast.stop = endTime;
                    this.Debug("Delaying spell %s (%d) to ending = %s (+%s).", spell, spellId, endTime, delta);
                    Ovale.refreshNeeded[self_playerGUID] = true;
                } else if (!name) {
                    this.Debug("Warning: not casting a spell.");
                } else {
                    this.Debug("Warning: delaying unexpected spell %s.", name);
                }
            } else {
                this.Debug("Warning: no queued spell %s (%d) found to delay.", spell, spellId);
            }
            this.StopProfiling("OvaleFuture_UNIT_SPELLCAST_DELAYED");
        }
    }
    UNIT_SPELLCAST_SENT(event, unitId, spell, rank, targetName, lineId) {
        if ((unitId == "player" || unitId == "pet") && !WHITE_ATTACK_NAME[spell]) {
            this.StartProfiling("OvaleFuture_UNIT_SPELLCAST_SENT");
            this.DebugTimestamp(event, unitId, spell, rank, targetName, lineId);
            let now = API_GetTime();
            let caster = OvaleGUID.UnitGUID(unitId);
            let spellcast = self_pool.Get();
            spellcast.lineId = lineId;
            spellcast.caster = caster;
            spellcast.spellName = spell;
            spellcast.queued = now;
            tinsert(this.queue, spellcast);
            if (targetName == "") {
                this.Debug("Queueing (%d) spell %s with no target.", lualength(this.queue), spell);
            } else {
                spellcast.targetName = targetName;
                let [targetGUID, nextGUID] = OvaleGUID.NameGUID(targetName);
                if (nextGUID) {
                    let name = OvaleGUID.UnitName("target");
                    if (name == targetName) {
                        targetGUID = OvaleGUID.UnitGUID("target");
                    } else {
                        name = OvaleGUID.UnitName("focus");
                        if (name == targetName) {
                            targetGUID = OvaleGUID.UnitGUID("focus");
                        } else if (API_UnitExists("mouseover")) {
                            name = API_UnitName("mouseover");
                            if (name == targetName) {
                                targetGUID = API_UnitGUID("mouseover");
                            }
                        }
                    }
                    spellcast.target = targetGUID;
                    this.Debug("Queueing (%d) spell %s to %s (possibly %s).", lualength(this.queue), spell, targetName, targetGUID);
                } else {
                    spellcast.target = targetGUID;
                    this.Debug("Queueing (%d) spell %s to %s (%s).", lualength(this.queue), spell, targetName, targetGUID);
                }
            }
            this.SaveSpellcastInfo(spellcast, now);
            this.StopProfiling("OvaleFuture_UNIT_SPELLCAST_SENT");
        }
    }
    UNIT_SPELLCAST_START(event, unitId, spell, rank, lineId, spellId) {
        if ((unitId == "player" || unitId == "pet") && !WHITE_ATTACK[spellId]) {
            this.StartProfiling("OvaleFuture_UNIT_SPELLCAST_START");
            this.DebugTimestamp(event, unitId, spell, rank, lineId, spellId);
            let now = API_GetTime();
            let [spellcast] = this.GetSpellcast(spell, spellId, lineId, now);
            if (spellcast) {
                let [name, _1, _2, _3, startTime, endTime, _, castId] = API_UnitCastingInfo(unitId);
                if (lineId == castId && name == spell) {
                    startTime = startTime / 1000;
                    endTime = endTime / 1000;
                    spellcast.spellId = spellId;
                    spellcast.start = startTime;
                    spellcast.stop = endTime;
                    spellcast.channel = false;
                    let delta = now - spellcast.queued;
                    this.Debug("Casting spell %s (%d): start = %s (+%s), ending = %s.", spell, spellId, startTime, delta, endTime);
                    let [auraId, auraGUID] = this.GetAuraFinish(spell, spellId, spellcast.target, now);
                    if (auraId && auraGUID) {
                        spellcast.auraId = auraId;
                        spellcast.auraGUID = auraGUID;
                        this.Debug("Spell %s (%d) will finish after updating aura %d on %s.", spell, spellId, auraId, auraGUID);
                    }
                    this.SaveSpellcastInfo(spellcast, now);
                    OvaleScore.ScoreSpell(spellId);
                    Ovale.refreshNeeded[self_playerGUID] = true;
                } else if (!name) {
                    this.Debug("Warning: not casting a spell.");
                } else {
                    this.Debug("Warning: casting unexpected spell %s.", name);
                }
            } else {
                this.Debug("Warning: casting spell %s (%d) without previous sent data.", spell, spellId);
            }
            this.StopProfiling("OvaleFuture_UNIT_SPELLCAST_START");
        }
    }
    UNIT_SPELLCAST_SUCCEEDED(event, unitId, spell, rank, lineId, spellId) {
        if ((unitId == "player" || unitId == "pet") && !WHITE_ATTACK[spellId]) {
            this.StartProfiling("OvaleFuture_UNIT_SPELLCAST_SUCCEEDED");
            this.DebugTimestamp(event, unitId, spell, rank, lineId, spellId);
            let now = API_GetTime();
            let [spellcast, index] = this.GetSpellcast(spell, spellId, lineId, now);
            if (spellcast) {
                let success = false;
                if (!spellcast.success && spellcast.start && spellcast.stop && !spellcast.channel) {
                    this.Debug("Succeeded casting spell %s (%d) at %s, now in flight.", spell, spellId, spellcast.stop);
                    spellcast.success = now;
                    this.UpdateSpellcastSnapshot(spellcast, now);
                    success = true;
                } else {
                    let name = API_UnitChannelInfo(unitId);
                    if (!name) {
                        let now = API_GetTime();
                        spellcast.spellId = spellId;
                        spellcast.start = now;
                        spellcast.stop = now;
                        spellcast.channel = false;
                        spellcast.success = now;
                        let delta = now - spellcast.queued;
                        this.Debug("Instant-cast spell %s (%d): start = %s (+%s).", spell, spellId, now, delta);
                        let [auraId, auraGUID] = this.GetAuraFinish(spell, spellId, spellcast.target, now);
                        if (auraId && auraGUID) {
                            spellcast.auraId = auraId;
                            spellcast.auraGUID = auraGUID;
                            this.Debug("Spell %s (%d) will finish after updating aura %d on %s.", spell, spellId, auraId, auraGUID);
                        }
                        this.SaveSpellcastInfo(spellcast, now);
                        OvaleScore.ScoreSpell(spellId);
                        success = true;
                    } else {
                        this.Debug("Succeeded casting spell %s (%d) but it is channelled.", spell, spellId);
                    }
                }
                if (success) {
                    let targetGUID = spellcast.target;
                    this.UpdateLastSpellcast(now, spellcast);
                    this.UpdateCounters(spellId, spellcast.stop, targetGUID);
                    let finished = false;
                    let finish = "miss";
                    if (!spellcast.targetName) {
                        this.Debug("Finished spell %s (%d) with no target queued at %s.", spell, spellId, spellcast.queued);
                        finished = true;
                        finish = "hit";
                    } else if (targetGUID == self_playerGUID && OvaleSpellBook.IsHelpfulSpell(spellId)) {
                        this.Debug("Finished helpful spell %s (%d) cast on player queued at %s.", spell, spellId, spellcast.queued);
                        finished = true;
                        finish = "hit";
                    }
                    if (finished) {
                        tremove(this.queue, index);
                        self_pool.Release(spellcast);
                        Ovale.refreshNeeded[self_playerGUID] = true;
                        this.SendMessage("Ovale_SpellFinished", now, spellId, targetGUID, finish);
                    }
                }
            } else {
                this.Debug("Warning: no queued spell %s (%d) found to successfully complete casting.", spell, spellId);
            }
            this.StopProfiling("OvaleFuture_UNIT_SPELLCAST_SUCCEEDED");
        }
    }
    Ovale_AuraAdded(event, atTime, guid, auraId, caster) {
        if (guid == self_playerGUID) {
            self_timeAuraAdded = atTime;
            this.UpdateSpellcastSnapshot(this.lastGCDSpellcast, atTime);
            this.UpdateSpellcastSnapshot(this.lastOffGCDSpellcast, atTime);
        }
    }
    UnitSpellcastEnded(event, unitId, spell, rank, lineId, spellId) {
        if ((unitId == "player" || unitId == "pet") && !WHITE_ATTACK[spellId]) {
            this.StartProfiling("OvaleFuture_UnitSpellcastEnded");
            this.DebugTimestamp(event, unitId, spell, rank, lineId, spellId);
            let now = API_GetTime();
            let [spellcast, index] = this.GetSpellcast(spell, spellId, lineId, now);
            if (spellcast) {
                this.Debug("End casting spell %s (%d) queued at %s due to %s.", spell, spellId, spellcast.queued, event);
                if (!spellcast.success) {
                    tremove(this.queue, index);
                    self_pool.Release(spellcast);
                    Ovale.refreshNeeded[self_playerGUID] = true;
                }
            } else if (lineId) {
                this.Debug("Warning: no queued spell %s (%d) found to end casting.", spell, spellId);
            }
            this.StopProfiling("OvaleFuture_UnitSpellcastEnded");
        }
    }
    GetSpellcast(spell, spellId, lineId, atTime):[SpellCast, number] {
        this.StartProfiling("OvaleFuture_GetSpellcast");
        let spellcast: SpellCast, index;
        if (!lineId || lineId != "") {
            for (const [i, sc] of _ipairs(this.queue)) {
                if (!lineId || sc.lineId == lineId) {
                    if (spellId && sc.spellId == spellId) {
                        spellcast = sc;
                        index = i;
                        break;
                    } else if (spell) {
                        let spellName = sc.spellName || OvaleSpellBook.GetSpellName(spellId);
                        if (spell == spellName) {
                            spellcast = sc;
                            index = i;
                            break;
                        }
                    }
                }
            }
        }
        if (spellcast) {
            let spellName = spell || spellcast.spellName || OvaleSpellBook.GetSpellName(spellId);
            if (spellcast.targetName) {
                this.Debug("Found spellcast for %s to %s queued at %f.", spellName, spellcast.targetName, spellcast.queued);
            } else {
                this.Debug("Found spellcast for %s with no target queued at %f.", spellName, spellcast.queued);
            }
        }
        this.StopProfiling("OvaleFuture_GetSpellcast");
        return [spellcast, index];
    }
    GetAuraFinish(spell, spellId, targetGUID, atTime) {
        this.StartProfiling("OvaleFuture_GetAuraFinish");
        let auraId, auraGUID;
        let si = OvaleData.spellInfo[spellId];
        if (si && si.aura) {
            for (const [_, unitId] of _ipairs(SPELLCAST_AURA_ORDER)) {
                for (const [filter, auraList] of _pairs(si.aura[unitId])) {
                    for (const [id, spellData] of _pairs(auraList)) {
                        let [verified, value, data] = OvaleData.CheckSpellAuraData(id, spellData, atTime, targetGUID);
                        if (verified && (SPELLAURALIST_AURA_VALUE[value] || _type(value) == "number" && value > 0)) {
                            auraId = id;
                            auraGUID = OvaleGUID.UnitGUID(unitId);
                            break;
                        }
                    }
                    if (auraId) {
                        break;
                    }
                }
                if (auraId) {
                    break;
                }
            }
        }
        this.StopProfiling("OvaleFuture_GetAuraFinish");
        return [auraId, auraGUID];
    }
    RegisterSpellcastInfo(mod) {
        tinsert(self_modules, mod);
    }
    UnregisterSpellcastInfo(mod) {
        for (let i = lualength(self_modules); i >= 1; i += -1) {
            if (self_modules[i] == mod) {
                tremove(self_modules, i);
            }
        }
    }
    CopySpellcastInfo(spellcast, dest) {
        this.StartProfiling("OvaleFuture_CopySpellcastInfo");
        if (spellcast.damageMultiplier) {
            dest.damageMultiplier = spellcast.damageMultiplier;
        }
        for (const [_, mod] of _pairs(self_modules)) {
            let func = mod.CopySpellcastInfo;
            if (func) {
                func(mod, spellcast, dest);
            }
        }
        this.StopProfiling("OvaleFuture_CopySpellcastInfo");
    }
    SaveSpellcastInfo(spellcast, atTime) {
        this.StartProfiling("OvaleFuture_SaveSpellcastInfo");
        this.Debug("    Saving information from %s to the spellcast for %s.", atTime, spellcast.spellName);
        if (spellcast.spellId) {
            spellcast.damageMultiplier = this.GetDamageMultiplier(spellcast.spellId, spellcast.target, atTime);
        }
        for (const [_, mod] of _pairs(self_modules)) {
            let func = mod.SaveSpellcastInfo;
            if (func) {
                func(mod, spellcast, atTime);
            }
        }
        this.StopProfiling("OvaleFuture_SaveSpellcastInfo");
    }
    GetDamageMultiplier(spellId, targetGUID, atTime) {
        atTime = atTime || this["currentTime"] || API_GetTime();
        let damageMultiplier = 1;
        let si = OvaleData.spellInfo[spellId];
        if (si && si.aura && si.aura.damage) {
            let CheckRequirements;
            let GetAuraByGUID, IsActiveAura;
            let auraModule, dataModule;
            for (const [filter, auraList] of _pairs(si.aura.damage)) {
                for (const [auraId, spellData] of _pairs(auraList)) {
                    let index, multiplier;
                    if (_type(spellData) == "table") {
                        multiplier = spellData[1];
                        index = 2;
                    } else {
                        multiplier = spellData;
                    }
                    let verified;
                    if (index) {
                        verified = OvaleData.CheckRequirements(spellId, atTime, spellData, index, targetGUID);
                    } else {
                        verified = true;
                    }
                    if (verified) {
                        let aura = OvaleAura.GetAuraByGUID(self_playerGUID, auraId, filter);
                        let isActiveAura = OvaleAura.IsActiveAura(aura, atTime);
                        if (isActiveAura) {
                            let siAura = OvaleData.spellInfo[auraId];
                            if (siAura && siAura.stacking && siAura.stacking > 0) {
                                multiplier = 1 + (multiplier - 1) * aura.stacks;
                            }
                            damageMultiplier = damageMultiplier * multiplier;
                        }
                    }
                }
            }
        }
        return damageMultiplier;
    }
    UpdateCounters(spellId, atTime, targetGUID) {
        let inccounter = OvaleData.GetSpellInfoProperty(spellId, atTime, "inccounter", targetGUID);
        if (inccounter) {
            let value = this.counter[inccounter] && this.counter[inccounter] || 0;
            this.counter[inccounter] = value + 1;
        }
        let resetcounter = OvaleData.GetSpellInfoProperty(spellId, atTime, "resetcounter", targetGUID);
        if (resetcounter) {
            this.counter[resetcounter] = 0;
        }
    }
    IsActive(spellId) {
        for (const [_, spellcast] of _ipairs(this.queue)) {
            if (spellcast.spellId == spellId && spellcast.start) {
                return true;
            }
        }
        return false;
    }

    InFlight(spellId) {
        return this.IsActive(spellId);
    }

    LastInFlightSpell() {
        let spellcast;
        if (this.lastGCDSpellcast.success) {
            spellcast = this.lastGCDSpellcast;
        }
        for (let i = lualength(this.queue); i >= 1; i += -1) {
            let sc = this.queue[i];
            if (sc.success) {
                if (!spellcast || spellcast.success < sc.success) {
                    spellcast = sc;
                }
                break;
            }
        }
        return spellcast;
    }
    LastSpellSent() {
        let spellcast = undefined;
        if (this.lastGCDSpellcast.success) {
            spellcast = this.lastGCDSpellcast;
        }
        for (let i = lualength(this.queue); i >= 1; i += -1) {
            let sc = this.queue[i];
            if (sc.success) {
                if (!spellcast || (spellcast.success && spellcast.success < sc.success) || (!spellcast.success && spellcast.queued < sc.success)) {
                    spellcast = sc;
                }
            } else if (!sc.start && !sc.stop) {
                if (spellcast.success && spellcast.success < sc.queued) {
                    spellcast = sc;
                } else if (spellcast.queued < sc.queued) {
                    spellcast = sc;
                }
            }
        }
        return spellcast;
    }
    ApplyInFlightSpells() {
        this.StartProfiling("OvaleFuture_ApplyInFlightSpells");
        let now = API_GetTime();
        let index = 1;
        while (index <= lualength(this.queue)) {
            let spellcast = this.queue[index];
            if (spellcast.stop) {
                let isValid = false;
                let description;
                if (now < spellcast.stop) {
                    isValid = true;
                    description = spellcast.channel && "channelling" || "being cast";
                } else if (now < spellcast.stop + 5) {
                    isValid = true;
                    description = "in flight";
                }
                if (isValid) {
                    if (spellcast.target) {
                        OvaleState.Log("Active spell %s (%d) is %s to %s (%s), now=%f, endCast=%f", spellcast.spellName, spellcast.spellId, description, spellcast.targetName, spellcast.target, now, spellcast.stop);
                    } else {
                        OvaleState.Log("Active spell %s (%d) is %s, now=%f, endCast=%f", spellcast.spellName, spellcast.spellId, description, now, spellcast.stop);
                    }
                    futureState.ApplySpell(spellcast.spellId, spellcast.target, spellcast.start, spellcast.stop, spellcast.channel, spellcast);
                } else {
                    if (spellcast.target) {
                        this.Debug("Warning: removing active spell %s (%d) to %s (%s) that should have finished.", spellcast.spellName, spellcast.spellId, spellcast.targetName, spellcast.target);
                    } else {
                        this.Debug("Warning: removing active spell %s (%d) that should have finished.", spellcast.spellName, spellcast.spellId);
                    }
                    tremove(this.queue, index);
                    self_pool.Release(spellcast);
                    index = index - 1;
                }
            }
            index = index + 1;
        }
        this.StopProfiling("OvaleFuture_ApplyInFlightSpells");
    }
    UpdateLastSpellcast(atTime, spellcast) {
        this.StartProfiling("OvaleFuture_UpdateLastSpellcast");
        this.lastCastTime[spellcast.spellId] = atTime;
        if (spellcast.offgcd) {
            this.Debug("    Caching spell %s (%d) as most recent off-GCD spellcast.", spellcast.spellName, spellcast.spellId);
            for (const [k, v] of _pairs(spellcast)) {
                this.lastOffGCDSpellcast[k] = v;
            }
            this.lastSpellcast = this.lastOffGCDSpellcast;
        } else {
            this.Debug("    Caching spell %s (%d) as most recent GCD spellcast.", spellcast.spellName, spellcast.spellId);
            for (const [k, v] of _pairs(spellcast)) {
                this.lastGCDSpellcast[k] = v;
            }
            this.lastSpellcast = this.lastGCDSpellcast;
        }
        this.StopProfiling("OvaleFuture_UpdateLastSpellcast");
    }
    UpdateSpellcastSnapshot(spellcast, atTime) {
        if (spellcast.queued && (!spellcast.snapshotTime || (spellcast.snapshotTime < atTime && atTime < spellcast.stop + 1))) {
            if (spellcast.targetName) {
                this.Debug("    Updating to snapshot from %s for spell %s to %s (%s) queued at %s.", atTime, spellcast.spellName, spellcast.targetName, spellcast.target, spellcast.queued);
            } else {
                this.Debug("    Updating to snapshot from %s for spell %s with no target queued at %s.", atTime, spellcast.spellName, spellcast.queued);
            }
            OvalePaperDoll.UpdateSnapshot(spellcast, true);
            if (spellcast.spellId) {
                spellcast.damageMultiplier = this.GetDamageMultiplier(spellcast.spellId, spellcast.target, atTime);
                if (spellcast.damageMultiplier != 1) {
                    this.Debug("        persistent multiplier = %f", spellcast.damageMultiplier);
                }
            }
        }
    }
}

class FutureState {

    inCombat = undefined;
    combatStartTime = undefined;
    currentTime = undefined;
    currentSpellId = undefined;
    startCast = undefined;
    endCast = undefined;
    nextCast: number = undefined;
    lastCast = undefined;
    channel = undefined;
    lastSpellId = undefined;
    lastGCDSpellId = undefined;
    lastGCDSpellIds = {}
    
    lastOffGCDSpellId = undefined;
    counter = undefined;
    
    InitializeState() {
        this.lastCast = {}
        this.counter = {}
    }
    ResetState() {
        OvaleFuture.StartProfiling("OvaleFuture_ResetState");
        let now = API_GetTime();
        this.currentTime = now;
        OvaleFuture.Log("Reset state with current time = %f", this.currentTime);
        this.inCombat = OvaleFuture.inCombat;
        this.combatStartTime = OvaleFuture.combatStartTime || 0;
        this.nextCast = now;
        let reason = "";
        let [start, duration] = OvaleCooldown.GetGlobalCooldown(now);
        if (start && start > 0) {
            let ending = start + duration;
            if (this.nextCast < ending) {
                this.nextCast = ending;
                reason = " (waiting for GCD)";
            }
        }
        let lastGCDSpellcastFound, lastOffGCDSpellcastFound, lastSpellcastFound;
        for (let i = lualength(OvaleFuture.queue); i >= 1; i += -1) {
            let spellcast = OvaleFuture.queue[i];
            if (spellcast.spellId && spellcast.start) {
                OvaleFuture.Log("    Found cast %d of spell %s (%d), start = %s, stop = %s.", i, spellcast.spellName, spellcast.spellId, spellcast.start, spellcast.stop);
                if (!lastSpellcastFound) {
                    this.lastSpellId = spellcast.spellId;
                    if (spellcast.start && spellcast.stop && spellcast.start <= now && now < spellcast.stop) {
                        this.currentSpellId = spellcast.spellId;
                        this.startCast = spellcast.start;
                        this.endCast = spellcast.stop;
                        this.channel = spellcast.channel;
                    }
                    lastSpellcastFound = true;
                }
                if (!lastGCDSpellcastFound && !spellcast.offgcd) {
                    this.PushGCDSpellId(spellcast.spellId);
                    if (spellcast.stop && this.nextCast < spellcast.stop) {
                        this.nextCast = spellcast.stop;
                        reason = " (waiting for spellcast)";
                    }
                    lastGCDSpellcastFound = true;
                }
                if (!lastOffGCDSpellcastFound && spellcast.offgcd) {
                    this.lastOffGCDSpellId = spellcast.spellId;
                    lastOffGCDSpellcastFound = true;
                }
            }
            if (lastGCDSpellcastFound && lastOffGCDSpellcastFound && lastSpellcastFound) {
                break;
            }
        }
        if (!lastSpellcastFound) {
            let spellcast = OvaleFuture.lastSpellcast;
            if (spellcast) {
                this.lastSpellId = spellcast.spellId;
                if (spellcast.start && spellcast.stop && spellcast.start <= now && now < spellcast.stop) {
                    this.currentSpellId = spellcast.spellId;
                    this.startCast = spellcast.start;
                    this.endCast = spellcast.stop;
                    this.channel = spellcast.channel;
                }
            }
        }
        if (!lastGCDSpellcastFound) {
            let spellcast = OvaleFuture.lastGCDSpellcast;
            if (spellcast) {
                this.lastGCDSpellId = spellcast.spellId;
                if (spellcast.stop && this.nextCast < spellcast.stop) {
                    this.nextCast = spellcast.stop;
                    reason = " (waiting for spellcast)";
                }
            }
        }
        if (!lastOffGCDSpellcastFound) {
            let spellcast = OvaleFuture.lastOffGCDSpellcast;
            if (spellcast) {
                this.lastOffGCDSpellId = spellcast.spellId;
            }
        }
        OvaleFuture.Log("    lastSpellId = %s, lastGCDSpellId = %s, lastOffGCDSpellId = %s", this.lastSpellId, this.lastGCDSpellId, this.lastOffGCDSpellId);
        OvaleFuture.Log("    nextCast = %f%s", this.nextCast, reason);
        _wipe(this.lastCast);
        for (const [k, v] of _pairs(OvaleFuture.counter)) {
            this.counter[k] = v;
        }
        OvaleFuture.StopProfiling("OvaleFuture_ResetState");
    }
    CleanState() {
        for (const [k] of _pairs(this.lastCast)) {
            this.lastCast[k] = undefined;
        }
        for (const [k] of _pairs(this.counter)) {
            this.counter[k] = undefined;
        }
    }
    ApplySpellStartCast(spellId, targetGUID, startCast, endCast, channel, spellcast) {
        OvaleFuture.StartProfiling("OvaleFuture_ApplySpellStartCast");
        if (channel) {
            OvaleFuture.UpdateCounters(spellId, startCast, targetGUID);
        }
        OvaleFuture.StopProfiling("OvaleFuture_ApplySpellStartCast");
    }
    ApplySpellAfterCast(spellId, targetGUID, startCast, endCast, channel, spellcast) {
        OvaleFuture.StartProfiling("OvaleFuture_ApplySpellAfterCast");
        if (!channel) {
            OvaleFuture.UpdateCounters(spellId, endCast, targetGUID);
        }
        OvaleFuture.StopProfiling("OvaleFuture_ApplySpellAfterCast");
    }

    GetCounter (id) {
        return this.counter[id] || 0;
    }
    GetCounterValue(id) {
        return this.GetCounter(id);
    }

    TimeOfLastCast(spellId) {
        return this.lastCast[spellId] || OvaleFuture.lastCastTime[spellId] || 0;
    }
    IsChanneling(atTime) {
        atTime = atTime || this.currentTime;
        return this.channel && (atTime < this.endCast);
    }
    static staticSpellcast = {}

    PushGCDSpellId(spellId) {
        if (this.lastGCDSpellId) {
            tinsert(this.lastGCDSpellIds, this.lastGCDSpellId);
            if (lualength(this.lastGCDSpellIds) > 5) {
                tremove(this.lastGCDSpellIds, 1);
            }
        }
        this.lastGCDSpellId = spellId;
    }
    ApplySpell(spellId, targetGUID, startCast, endCast?, channel?, spellcast?) {
        OvaleFuture.StartProfiling("OvaleFuture_state_ApplySpell");
        if (spellId) {
            if (!targetGUID) {
                targetGUID = Ovale.playerGUID;
            }
            let castTime;
            if (startCast && endCast) {
                castTime = endCast - startCast;
            } else {
                castTime = OvaleSpellBook.GetCastTime(spellId) || 0;
                startCast = startCast || this.nextCast;
                endCast = endCast || (startCast + castTime);
            }
            if (!spellcast) {
                spellcast = FutureState.staticSpellcast;
                _wipe(spellcast);
                spellcast.caster = self_playerGUID;
                spellcast.spellId = spellId;
                spellcast.spellName = OvaleSpellBook.GetSpellName(spellId);
                spellcast.target = targetGUID;
                spellcast.targetName = OvaleGUID.GUIDName(targetGUID);
                spellcast.start = startCast;
                spellcast.stop = endCast;
                spellcast.channel = channel;
                paperDollState.UpdateSnapshot(spellcast);
                let atTime = channel && startCast || endCast;
                for (const [_, mod] of _pairs(self_modules)) {
                    let func = mod.SaveSpellcastInfo;
                    if (func) {
                        func(mod, spellcast, atTime, this);
                    }
                }
            }
            this.lastSpellId = spellId;
            this.startCast = startCast;
            this.endCast = endCast;
            this.lastCast[spellId] = endCast;
            this.channel = channel;
            let gcd = cooldownState.GetGCD(spellId, startCast, targetGUID);
            let nextCast = (castTime > gcd) && endCast || (startCast + gcd);
            if (this.nextCast < nextCast) {
                this.nextCast = nextCast;
            }
            if (gcd > 0) {
                this.PushGCDSpellId(spellId);
            } else {
                this.lastOffGCDSpellId = spellId;
            }
            let now = API_GetTime();
            if (startCast >= now) {
                this.currentTime = startCast + SIMULATOR_LAG;
            } else {
                this.currentTime = now;
            }
            OvaleFuture.Log("Apply spell %d at %f currentTime=%f nextCast=%f endCast=%f targetGUID=%s", spellId, startCast, this.currentTime, nextCast, endCast, targetGUID);
            if (!this.inCombat && OvaleSpellBook.IsHarmfulSpell(spellId)) {
                this.inCombat = true;
                if (channel) {
                    this.combatStartTime = startCast;
                } else {
                    this.combatStartTime = endCast;
                }
            }
            if (startCast > now) {
                OvaleState.ApplySpellStartCast(spellId, targetGUID, startCast, endCast, channel, spellcast);
            }
            if (endCast > now) {
                OvaleState.ApplySpellAfterCast(spellId, targetGUID, startCast, endCast, channel, spellcast);
            }
            OvaleState.ApplySpellOnHit(spellId, targetGUID, startCast, endCast, channel, spellcast);
        }
        OvaleFuture.StopProfiling("OvaleFuture_state_ApplySpell");
    }
    GetDamageMultiplier(spellId, targetGUID, atTime) {
        return OvaleFuture.GetDamageMultiplier(spellId, targetGUID, atTime);
    }
    UpdateCounters(spellId, atTime, targetGUID){
        return OvaleFuture.UpdateCounters(spellId, atTime, targetGUID);
    }
}

export const futureState = new FutureState();
OvaleState.RegisterState(futureState);


export const OvaleFuture = new OvaleFutureClass();