import { L } from "./Localization";
import { NewAddon, AceModule } from "./TsAddon";
import aceEvent from "AceEvent-3.0";
let _assert = assert;
let format = string.format;
let _ipairs = ipairs;
let _pairs = pairs;
let _select = select;
let strfind = string.find;
let _strjoin = strjoin;
let strlen = string.len;
let _tostring = tostring;
let _tostringall = tostringall;
let _wipe = wipe;
let API_UnitClass = UnitClass;
let API_UnitGUID = UnitGUID;
let INFINITY = math.huge;
let self_oneTimeMessage = {
}
let MAX_REFRESH_INTERVALS = 500;
let self_refreshIntervals:LuaArray<number> = {
}
let self_refreshIndex = 1;

export type Constructor<T> = new(...args: any[]) => T;

export function MakeString(s?, ...__args) {
    if (s && strlen(s) > 0) {
        if (__args) {
            if (strfind(s, "%%%.%d") || strfind(s, "%%[%w]")) {
                s = format(s, ..._tostringall(...__args));
            } else {
                s = _strjoin(" ", s, ..._tostringall(...__args));
            }
        }
    } else {
        s = _tostring(undefined);
    }
    return s;
}

export function RegisterPrinter<T extends Constructor<AceModule>>(base: T) {
    return class extends base {
        GetMethod(methodName, subModule) {
            let [func, arg] = [this[methodName], this];
            if (!func) {
                [func, arg] = [subModule[methodName], subModule];
            }
            _assert(func != undefined);
            return [func, arg];
        }    
    }    
}

interface Color {
    r:number;
    g:number;
    b:number;
}

export interface OvaleDb {
    profile: {
        source: string;
        code: string,
        check: {},
        list: {},
        standaloneOptions: boolean,
        showHiddenScripts: boolean;
        overrideCode: string;
        apparence: {
            avecCible: boolean,
            clickThru: boolean,
            enCombat: boolean,
            enableIcons: boolean,
            hideEmpty: boolean,
            hideVehicule: boolean,
            margin: number,
            offsetX: number,
            offsetY: number,
            targetHostileOnly: boolean,
            verrouille: boolean,
            vertical: boolean,
            alpha: number,
            flashIcon: boolean,
            remainsFontColor: {
                r: number,
                g: number,
                b: number
            },
            fontScale: number,
            highlightIcon: true,
            iconScale: number,
            numeric: false,
            raccourcis: true,
            smallIconScale: number,
            targetText: string,
            iconShiftX: number,
            iconShiftY: number,
            optionsAlpha: number,
            predictif: boolean,
            secondIconScale: number,
            taggedEnemies: boolean,
            auraLag: number,
            moving: boolean,
            spellFlash: {
                enabled: boolean,
                colorMain?: Color,
                colorCd?: Color,
                colorShortCd?: Color,
                colorInterrupt?: Color,
                inCombat?: boolean,
                hideInVehicle?: boolean,
                hasTarget?: boolean,
                hasHostileTarget?: boolean,
                threshold?: number,
                size?: number,
                brightness?: number,
            },
            minimap: {
                hide: boolean
            }
        }
    },
    global: any;
}

const OvaleBase = NewAddon("Ovale", aceEvent);
class OvaleClass extends OvaleBase {
    playerClass = _select(2, API_UnitClass("player"));
    playerGUID: string = undefined;
    db: Database & OvaleDb = undefined;
    refreshNeeded:LuaObj<boolean> = {}
    inCombat = false;
    MSG_PREFIX = "Ovale";


    constructor() {
        super();
        _G["BINDING_HEADER_OVALE"] = "Ovale";
        let toggleCheckBox = L["Inverser la boîte à cocher "];
        _G["BINDING_NAME_OVALE_CHECKBOX0"] = `${toggleCheckBox}(1)`;
        _G["BINDING_NAME_OVALE_CHECKBOX1"] = `${toggleCheckBox}(2)`;
        _G["BINDING_NAME_OVALE_CHECKBOX2"] = `${toggleCheckBox}(3)`;
        _G["BINDING_NAME_OVALE_CHECKBOX3"] = `${toggleCheckBox}(4)`;
        _G["BINDING_NAME_OVALE_CHECKBOX4"] = `${toggleCheckBox}(5)`;
    
        this.RegisterEvent("PLAYER_ENTERING_WORLD");
    }

    // OnDisable() {
    //     this.UnregisterEvent("PLAYER_ENTERING_WORLD");
    //     this.UnregisterEvent("PLAYER_TARGET_CHANGED");
    //     this.UnregisterMessage("Ovale_CombatEnded");
    //     this.UnregisterMessage("Ovale_OptionChanged");
    //     this.frame.Hide();
    // }
    PLAYER_ENTERING_WORLD() {
        this.playerGUID = API_UnitGUID("player");
        _wipe(self_refreshIntervals);
        self_refreshIndex = 1;
        this.ClearOneTimeMessages();
    }

    needRefresh() {
        if (this.playerGUID) {
            this.refreshNeeded[this.playerGUID] = true;
        }
    }
    
    AddRefreshInterval(milliseconds) {
        if (milliseconds < INFINITY) {
            self_refreshIntervals[self_refreshIndex] = milliseconds;
            self_refreshIndex = (self_refreshIndex < MAX_REFRESH_INTERVALS) && (self_refreshIndex + 1) || 1;
        }
    }
    GetRefreshIntervalStatistics() {
        let [sumRefresh, minRefresh, maxRefresh, count] = [0, INFINITY, 0, 0];
        for (const [, v] of _ipairs(self_refreshIntervals)) {
            if (v > 0) {
                if (minRefresh > v) {
                    minRefresh = v;
                }
                if (maxRefresh < v) {
                    maxRefresh = v;
                }
                sumRefresh = sumRefresh + v;
                count = count + 1;
            }
        }
        let avgRefresh = (count > 0) && (sumRefresh / count) || 0;
        return [avgRefresh, minRefresh, maxRefresh, count];
    }
    
    
    OneTimeMessage(...__args) {
        let s = MakeString(...__args);
        if (!self_oneTimeMessage[s]) {
            self_oneTimeMessage[s] = true;
        }
    }
    ClearOneTimeMessages() {
        _wipe(self_oneTimeMessage);
    }
    PrintOneTimeMessages() {
        for (const [s] of _pairs(self_oneTimeMessage)) {
            if (self_oneTimeMessage[s] != "printed") {
                this.Print(s);
                self_oneTimeMessage[s] = "printed";
            }
        }
    }
}

export const Ovale = new OvaleClass();

