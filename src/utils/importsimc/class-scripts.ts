import { ipairs } from "@wowts/lua";
import { format } from "@wowts/string";
import { ClassId, eventDispatcher } from "@wowts/wow-mock";
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { IoC } from "../../ioc";
import { registerScripts } from "../../scripts";
import { getDefinition, getDesc, getItemDefinition } from "./ast-helpers";
import {
    convertFromItemData,
    convertFromSpellData,
    CustomAuras,
    CustomSpellData,
} from "./customspell";
import { replaceInFile } from "./file-tools";
import { getFixes } from "./fixes";
import { DbcData } from "./importspells";

const limitLine1 = "// THE REST OF THIS FILE IS AUTOMATICALLY GENERATED";
const limitLine2 = "// ANY CHANGES MADE BELOW THIS POINT WILL BE LOST";
const SIMC_CLASS = [
    "deathknight",
    "demonhunter",
    "druid",
    "hunter",
    "mage",
    "monk",
    "paladin",
    "priest",
    "rogue",
    "shaman",
    "warlock",
    "warrior",
];

function canonicalize(s: string) {
    const token = "xXxUnDeRsCoReXxX";
    s = s.toLowerCase();
    s = s.replace(/[\s\-_(){}[\]]/g, token);
    s = s.replace(/\./g, "");
    s = s.replace(/xXxUnDeRsCoReXxX/g, "_");
    s = s.replace("_+", "_");
    s = s.replace("^_", "");
    s = s.replace("_$", "");
    return s;
}

function truncateFile(fileName: string, newCode: string) {
    const file = readFileSync(fileName, { encoding: "utf8" });
    const lines = file.split("\n");
    const output: string[] = [];
    for (const line of lines) {
        if (line.indexOf(limitLine1) >= 0) {
            break;
        }
        output.push(line);
    }
    output.push("     " + limitLine1);
    output.push("     " + limitLine2);
    output.push("");
    output.push(newCode);
    output.push("}");
    writeFileSync(fileName, output.join("\n"), { encoding: "utf8" });
}

function getProfileFiles(
    profileFile: string | undefined,
    profilesDirectory: string
) {
    const files: string[] = [];
    if (profileFile) {
        files.push(profileFile);
    } else {
        const dir = readdirSync(profilesDirectory);
        for (const name of dir) {
            files.push(name);
        }
        files.sort();
    }
    return files;
}

function getOrSet<T>(map: Map<string, T[]>, className: string) {
    let result = map.get(className);
    if (result) return result;
    result = [];
    map.set(className, result);
    return result;
}

function addId<T>(ids: T[], id?: T) {
    if (id && !ids.includes(id)) {
        ids.push(id);
    }
}

function isDefined<T>(t: T | undefined): t is T {
    return t !== undefined;
}

export class ClassScripts {
    constructor(
        private spellData: DbcData,
        private profilesDirectory: string,
        private outputDirectory: string
    ) {
        const { customIdentifierById, customIdentifiers } = getFixes(
            this.spellData
        );
        this.customIdentifierById = customIdentifierById;
        this.customIdentifiers = customIdentifiers;
    }
    private customIdentifierById: Map<
        number,
        { id: number; identifier: string }
    >;
    private customIdentifiers: Map<string, number>;
    private spellsByClass = new Map<string, number[]>();
    private talentsByClass = new Map<string, number[]>();
    private itemsByClass = new Map<string, number[]>();
    private spellListsByClass = new Map<string, string[]>();
    private azeriteTraitByClass = new Map<string, number[]>();
    private essenceByClass = new Map<string, number[]>();
    private runeforgeByClass = new Map<string, number[]>();
    private conduitByClass = new Map<string, number[]>();
    private soulbindAbilityByClass = new Map<string, number[]>();
    private customByClass = new Map<string, number[]>();
    private modifiedFiles = new Map<string, string>();

    private importClassScript(filename: string) {
        const output: string[] = [];
        const inputName = this.profilesDirectory + "/" + filename;
        const simc = readFileSync(inputName, { encoding: "utf8" });
        if (simc.indexOf("optimal_raid=") >= 0) return;
        let source: string | undefined,
            className: string | undefined,
            specialization: string | undefined;
        const matches = simc.match(/[^\r\n]+/g);
        if (matches) {
            for (const line of matches) {
                if (!source) {
                    if (line.substring(0, 3) == "### ") {
                        source = line.substring(4);
                    }
                }
                if (!className) {
                    for (const simcClass of SIMC_CLASS) {
                        const length = simcClass.length;
                        if (line.substring(0, length + 1) == simcClass + "=") {
                            className = simcClass.toUpperCase();
                        }
                    }
                }
                if (!specialization) {
                    if (line.substring(0, 5) == "spec=") {
                        specialization = line.substring(5);
                    }
                }
                if (className && specialization) {
                    break;
                }
            }
        }

        if (!className || !specialization) {
            console.log("className and specialization must be defined");
            return;
        }

        console.log(filename);
        const ioc = new IoC();
        ioc.ovale.playerGUID = "player";
        ioc.ovale.playerClass = <ClassId>className;
        for (const [key] of this.spellData.spellLists) {
            ioc.data.buffSpellList[key] = {};
        }
        eventDispatcher.DispatchEvent("ADDON_LOADED", "Ovale");
        eventDispatcher.DispatchEvent("PLAYER_ENTERING_WORLD", "Ovale");
        registerScripts(ioc.scripts);

        const profile = ioc.simulationCraft.ParseProfile(
            simc,
            Object.assign({}, this.spellData.identifiers),
            { effect: this.spellData.spellEffectById }
        );
        if (!profile) return;
        const profileName = profile.annotation.name.substring(
            1,
            profile.annotation.name.length - 1
        );
        let desc: string;
        if (source) {
            desc = format("%s: %s", source, profileName);
        } else {
            desc = profileName;
        }
        const name = canonicalize(desc);
        output.push("	{");
        output.push(format('	 	const name = "sc_%s";', name));
        output.push(format('	 	const desc = "[9.0] Simulationcraft: %s";', desc));
        output.push("	const code = `");
        output.push(ioc.simulationCraft.Emit(profile, true));
        output.push("`;");
        output.push(
            format(
                `         OvaleScripts.RegisterScript(
                    "%s",
                    "%s",
                    name,
                    desc,
                    code,
                    "%s"
                );`,
                profile.annotation.classId,
                profile.annotation.specialization,
                "script"
            )
        );
        output.push("    }");
        const outputFileName = "ovale_" + className.toLowerCase() + ".ts";
        console.log("Appending to " + outputFileName + ": " + name);
        const outputName = this.outputDirectory + "/" + outputFileName;
        const existing = this.modifiedFiles.get(outputName);
        const outputCode = output.join("\n");
        if (!existing) {
            this.modifiedFiles.set(outputName, outputCode);
        } else {
            this.modifiedFiles.set(outputName, existing + "\n\n" + outputCode);
        }
        const classSpells = getOrSet(this.spellsByClass, className);
        const classTalents = getOrSet(this.talentsByClass, className);
        const classItems = getOrSet(this.itemsByClass, className);
        const azeriteTraits = getOrSet(this.azeriteTraitByClass, className);
        const essences = getOrSet(this.essenceByClass, className);
        const spellLists = getOrSet(this.spellListsByClass, className);
        const runeforges = getOrSet(this.runeforgeByClass, className);
        const conduits = getOrSet(this.conduitByClass, className);
        const soulbindAbilities = getOrSet(
            this.soulbindAbilityByClass,
            className
        );
        const custom = getOrSet(this.customByClass, className);

        const identifiers = ipairs(profile.annotation.symbolList)
            .map((x) => x[1])
            .sort();
        for (const symbol of identifiers) {
            const spellList = this.spellData.spellLists.get(symbol);
            if (spellList) {
                for (const spell of spellList) {
                    if (this.customIdentifierById.has(spell.id))
                        addId(custom, spell.id);
                    else addId(classSpells, spell.id);
                }
                if (spellLists.indexOf(symbol) < 0) spellLists.push(symbol);
                continue;
            }
            const id = this.spellData.identifiers[symbol];
            if (this.customIdentifiers.has(symbol)) addId(custom, id);
            else if (symbol.match(/_talent/)) {
                addId(classTalents, id);
            } else if (symbol.match(/_item$/)) {
                addId(classItems, id);
            } else if (symbol.match(/_trait$/)) {
                addId(azeriteTraits, id);
            } else if (symbol.match(/_essence_id$/)) {
                addId(essences, id);
            } else if (symbol.match(/_runeforge$/)) {
                addId(runeforges, id);
            } else if (symbol.match(/_conduit$/)) {
                addId(conduits, id);
            } else if (symbol.match(/_soulbind$/)) {
                addId(soulbindAbilities, id);
            } else {
                if (id && classSpells.indexOf(id) < 0) {
                    classSpells.push(id);
                }
            }
        }
    }

    importClassScripts(profileFile?: string) {
        const files = getProfileFiles(profileFile, this.profilesDirectory);

        for (const filename of files) {
            if (!filename.startsWith("generate")) {
                this.importClassScript(filename);
            }
        }

        this.writeFiles();
        this.writeSpellScripts();
    }

    private writeFiles() {
        for (const [file, source] of this.modifiedFiles.entries()) {
            truncateFile(file, source);
        }
    }

    private writeSpellScripts() {
        for (const [className, spellIds] of this.spellsByClass) {
            let output = `    let code = \``;
            const talentIds = this.talentsByClass.get(className) || [];
            const spells: CustomSpellData[] = [];
            const remainingsSpellIds = spellIds.concat();
            const addSpells = (addedIds: number[]) => {
                for (const spellId of addedIds) {
                    if (
                        remainingsSpellIds.indexOf(spellId) < 0 &&
                        spellIds.indexOf(spellId) < 0
                    ) {
                        remainingsSpellIds.push(spellId);
                        spellIds.push(spellId);
                    }
                }
            };
            while (remainingsSpellIds.length) {
                const spellId = remainingsSpellIds.pop();
                if (!spellId) continue;
                const spell = this.spellData.spellDataById.get(spellId);
                if (!spell) {
                    continue;
                }
                if (spell.replaced_by) {
                    addSpells(spell.replaced_by);
                }

                const customSpell = convertFromSpellData(
                    spell,
                    this.spellData.spellDataById
                );
                spells.push(customSpell);
                if (customSpell.auras) {
                    for (const t in customSpell.auras) {
                        const target = t as keyof CustomAuras;
                        const auras = customSpell.auras[target];
                        if (auras) {
                            addSpells(auras.map((x) => x.id));
                        }
                    }
                }
            }

            const sortedSpells = spells.sort((x, y) =>
                x.identifier < y.identifier ? -1 : 1
            );
            for (const spell of sortedSpells) {
                if (!spell) continue;
                output += `Define(${spell.identifier} ${spell.id})\n`;
                output += getDefinition(
                    this.spellData,
                    spell.identifier,
                    spell,
                    talentIds,
                    spellIds
                );
            }

            const spellLists = this.spellListsByClass.get(className);
            if (spellLists) {
                for (const spellList of spellLists) {
                    const spells = this.spellData.spellLists.get(spellList);
                    if (spells) {
                        output += `SpellList(${spellList} ${spells
                            .map((x) => x.identifier)
                            .join(" ")})\n`;
                    }
                }
            }

            const talents = talentIds
                .map((x) => this.spellData.talentsById.get(x))
                .filter(isDefined)
                .sort((x, y) => (x.name > y.name ? 1 : -1));
            for (let i = 0; i < talents.length; i++) {
                const talent = talents[i];
                if (!talent) continue;
                output += `Define(${talent.identifier} ${talent.id})\n`;
                const spell = this.spellData.spellDataById.get(talent.spell_id);
                if (spell && spell.desc) {
                    output += `# ${getDesc(spell)}\n`;
                }
            }

            const writeIds = <T, U extends { identifier: string }>(
                idInSimc: Map<string, T[]>,
                repository: Map<T, U>,
                idProperty: keyof U,
                infoHandler?: (item: U) => string | undefined
            ) => {
                const ids = idInSimc.get(className);
                if (ids) {
                    for (const id of ids) {
                        const item = repository.get(id);
                        if (!item) continue;
                        output += `Define(${item.identifier} ${item[idProperty]})\n`;
                        if (infoHandler) {
                            const data = infoHandler(item);
                            if (data) output += data + "\n";
                        }
                    }
                }
            };

            writeIds(this.customByClass, this.customIdentifierById, "id");
            writeIds(
                this.itemsByClass,
                this.spellData.itemsById,
                "id",
                (item) =>
                    getItemDefinition(
                        convertFromItemData(item, this.spellData.spellDataById)
                    )
            );
            writeIds(
                this.azeriteTraitByClass,
                this.spellData.azeriteTraitById,
                "spellId"
            );
            writeIds(this.essenceByClass, this.spellData.essenceById, "id");
            writeIds(
                this.runeforgeByClass,
                this.spellData.runeforgeById,
                "bonus_id"
            );
            writeIds(this.conduitByClass, this.spellData.conduitById, "id");
            writeIds(
                this.soulbindAbilityByClass,
                this.spellData.soulbindAbilityById,
                "spell_id"
            );

            output += `    \`;`;

            const fileName =
                this.outputDirectory + "/ovale_" + className + "_spells.ts";
            replaceInFile(fileName, output);
        }
    }
}
