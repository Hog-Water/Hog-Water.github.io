/** Pure, browser-capable MAKE A FOOL rules transactions. */

export const STATE_FORMAT = "bork-borg.make-a-fool.state.v1";
export const CATALOG_FORMAT = "bork-borg.make-a-fool.catalog.v1";

const SOURCES = {
  abilities: "manuscript/content/make-a-fool/content/abilities.md",
  hp: "manuscript/content/make-a-fool/content/hp.md",
  identity: "manuscript/content/make-a-fool/make-a-fool.md",
  starting: "manuscript/content/what-you-own/content/starting-junk.md",
  inventory: "manuscript/content/what-you-own/content/inventory-slots.md",
  defects: "manuscript/content/weapons-of-regret/content/whats-wrong-with-it.md",
  matching: "manuscript/content/weapons-of-regret/content/matching-rolls.md",
};

export class GenerationError extends Error {}

/** Small deterministic PRNG. The unsigned 32-bit seed is part of this API. */
export function seededRandom(seed) {
  if (!Number.isSafeInteger(seed)) throw new GenerationError("seed must be a safe integer");
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export function catalogSha256(bytes) {
  if (!globalThis.crypto?.subtle) throw new GenerationError("Web Crypto SHA-256 is unavailable");
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return globalThis.crypto.subtle.digest("SHA-256", data).then((digest) =>
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  );
}

export function emptyState(catalogHash) {
  if (!/^[0-9a-f]{64}$/.test(catalogHash)) throw new GenerationError("catalog hash must be lowercase SHA-256");
  return { format: STATE_FORMAT, catalog: { format: CATALOG_FORMAT, sha256: catalogHash }, character: {}, events: [], unresolved: [] };
}

function validateCatalog(catalog) {
  if (catalog?.format !== CATALOG_FORMAT || !catalog.tables || !Array.isArray(catalog.sources)) {
    throw new GenerationError("unsupported or malformed MAKE A FOOL catalog");
  }
  for (const [name, table] of Object.entries(catalog.tables)) {
    if (!table.source || !table.die || !Array.isArray(table.results) || table.results.length === 0) {
      throw new GenerationError(`malformed catalog table: ${name}`);
    }
    const keys = new Set(table.results.map(({ key }) => key));
    if (keys.size !== table.results.length) throw new GenerationError(`duplicate catalog result key: ${name}`);
  }
}

function clone(value) { return structuredClone(value); }

export function createGenerator({ catalog, catalogHash, random = Math.random }) {
  validateCatalog(catalog);
  if (typeof random !== "function") throw new GenerationError("random must be a function");
  const byTable = Object.fromEntries(Object.entries(catalog.tables).map(([name, table]) => [name, new Map(table.results.map((row) => [row.key, row]))]));
  let sequence = 0;

  const die = (sides) => Math.floor(random() * sides) + 1;
  const forcedRoll = (notation, result) => {
    if (!Number.isInteger(result)) throw new GenerationError("forced result must be an integer");
    const dice = notation === "d66" ? [Math.floor(result / 10), result % 10] : [result];
    return { notation, dice, result };
  };
  const roll = (notation) => {
    if (notation === "d66") {
      const dice = [die(6), die(6)];
      return { notation, dice, result: dice[0] * 10 + dice[1] };
    }
    return forcedRoll(notation, die(Number(notation.slice(1))));
  };
  const tableResult = (name, forcedKey) => {
    const table = catalog.tables[name];
    if (!table) throw new GenerationError(`unknown catalog table: ${name}`);
    const rolled = forcedKey === undefined ? roll(table.die) : forcedRoll(table.die, forcedKey);
    const result = byTable[name].get(rolled.result);
    if (!result) throw new GenerationError(`${name} has no result ${rolled.result}`);
    return { table, result, roll: rolled };
  };
  const begin = (state, label) => {
    const next = clone(state);
    if (next.format !== STATE_FORMAT || next.catalog?.sha256 !== catalogHash || next.catalog?.format !== catalog.format) {
      throw new GenerationError("state and catalog do not match");
    }
    return { next, transaction: `tx-${String(++sequence).padStart(6, "0")}-${label}` };
  };
  const latestEvent = (state, predicate) => [...state.events].reverse().find(predicate);
  const eventWriting = (state, field) => latestEvent(state, (event) => Object.hasOwn(event.writes, field));
  const currentTableEvent = (state, table, field) => latestEvent(
    state,
    (event) => event.source?.table === table && (!field || Object.hasOwn(event.writes, field)),
  );
  const addEvent = (context, kind, writes, source, extras = {}) => {
    const event = { id: `event-${String(++sequence).padStart(6, "0")}`, transaction: context.transaction, kind, writes, source: { path: source }, ...extras };
    Object.assign(context.next.character, writes);
    context.next.events.push(event);
    return event;
  };
  const addTableEvent = (context, name, outcome, writes, previousEvent) => addEvent(
    context,
    previousEvent ? "reroll" : "roll",
    writes,
    outcome.table.source,
    {
      source: { path: outcome.table.source, table: name, key: outcome.result.key },
      roll: outcome.roll,
      ...(previousEvent ? { previousEvent: previousEvent.id } : {}),
    },
  );
  const addDerived = (context, writes, source, extras = {}) => addEvent(context, "derived", writes, source, extras);
  const unresolved = (context, id, kind, source, prompt) => {
    context.next.unresolved = context.next.unresolved.filter((item) => item.id !== id);
    context.next.unresolved.push({ id, kind, source, prompt });
  };
  const clearUnresolved = (context, id) => {
    context.next.unresolved = context.next.unresolved.filter((item) => item.id !== id);
  };
  const resultText = (name, key) => byTable[name].get(key)?.values[0];

  function tableOperation(state, name, field, mapping, options = {}) {
    const context = begin(state, name);
    const outcome = tableResult(name, options.key);
    const previous = currentTableEvent(state, name, field);
    const writes = mapping(outcome.result.values, outcome.result.key, context);
    addTableEvent(context, name, outcome, writes, previous);
    return context.next;
  }

  function baseFortune(state) {
    const event = latestEvent(state, (candidate) => candidate.source?.path === SOURCES.abilities && Object.hasOwn(candidate.writes, "abilities.fortune"));
    return event?.roll?.result;
  }

  function companionKey(state) {
    return currentTableEvent(state, "companion", "identity.companion")?.source.key;
  }

  function refreshFortune(context, reason) {
    const base = baseFortune(context.next);
    if (!Number.isInteger(base)) return;
    const value = Math.min(3, base + (companionKey(context.next) === 6 ? 1 : 0));
    addDerived(context, { "abilities.fortune": value }, catalog.tables.companion.source, { reason });
  }

  function currentPossessionEvent(state, slot) {
    return currentTableEvent(state, "possession", `possessions.${slot}.name`);
  }

  function currentToolboxRoll(state, slot) {
    const possession = currentPossessionEvent(state, slot);
    if (possession?.source.key !== 20) return 0;
    return latestEvent(
      state,
      (event) => event.transaction === possession.transaction && event.reason === "TOOLBOX MARKED PROFESSIONAL",
    )?.roll?.result ?? 0;
  }

  function refreshParts(context, reason) {
    const base = context.next.character["background.name"] === "TINKER BASTARD" ? 2 : 1;
    const value = base + currentToolboxRoll(context.next, 1) + currentToolboxRoll(context.next, 2);
    addDerived(context, { "resources.parts": value }, SOURCES.starting, { reason });
  }

  function repairAppearance(state) {
    const repair = currentTableEvent(state, "repair", "weapon.repair_history");
    const family = state.character["weapon.family"];
    if (!repair || !["SIMPLE", "BUILT", "MECHANICAL"].includes(family)) return null;
    const appearance = byTable.repair_appearance?.get(repair.source.key);
    if (!appearance) throw new GenerationError("repair appearance catalog is stale or incomplete");
    return { repair, family, value: appearance.values[["SIMPLE", "BUILT", "MECHANICAL"].indexOf(family)] };
  }

  function refreshRepairAppearance(context, reason) {
    const derived = repairAppearance(context.next);
    if (!derived) {
      addDerived(context, { "weapon.repair_appearance": "" }, catalog.tables.repair_appearance.source, { reason });
      return;
    }
    addDerived(context, { "weapon.repair_appearance": derived.value }, catalog.tables.repair_appearance.source, {
      source: { path: catalog.tables.repair_appearance.source, table: "repair_appearance", key: derived.repair.source.key },
      input: { family: derived.family, repairKey: derived.repair.source.key },
      reason,
    });
  }

  function currentDefectKeys(state) {
    return [1, 2].flatMap((slot) => {
      const event = currentTableEvent(state, "defect", `weapon.defects.${slot}`);
      return event && state.character[`weapon.defects.${slot}`] ? [event.source.key] : [];
    });
  }

  function refreshMatchingChoice(context) {
    const weapon = currentTableEvent(context.next, "weapon", "weapon.type");
    const matches = weapon && currentDefectKeys(context.next).includes(weapon.source.key);
    if (matches) {
      if (!context.next.character["weapon.nickname"]) {
        unresolved(context, "weapon-nickname", "player-choice", SOURCES.matching, "The Weapon and Defect rolls match. Name the weapon.");
      }
    } else {
      clearUnresolved(context, "weapon-nickname");
      if (context.next.character["weapon.nickname"]) addDerived(context, { "weapon.nickname": "" }, SOURCES.matching, { reason: "Weapon and Defect rolls no longer match" });
    }
  }

  function currentWarrantyExists(state) {
    return [1, 2].some((slot) => currentPossessionEvent(state, slot)?.source.key === 100);
  }

  const operations = {
    firstName(state, table = "first_name_men", options = {}) {
      if (!["first_name_men", "first_name_women"].includes(table)) throw new GenerationError("invalid first-name table");
      const previous = eventWriting(state, "identity.name.firstName");
      const context = begin(state, table);
      const outcome = tableResult(table, options.key);
      addTableEvent(context, table, outcome, { "identity.name.firstName": outcome.result.values[0] }, previous);
      return context.next;
    },
    lastName: (state, options = {}) => tableOperation(state, "last_name", "identity.name.lastName", ([name]) => ({ "identity.name.lastName": name }), options),
    ability(state, ability, options = {}) {
      if (!["stoutness", "alacrity", "savvy", "fortune"].includes(ability)) throw new GenerationError("invalid ability");
      const field = `abilities.${ability}`;
      const previous = latestEvent(state, (event) => event.source?.path === SOURCES.abilities && Object.hasOwn(event.writes, field));
      const context = begin(state, `ability-${ability}`);
      const dice = options.dice ?? [die(4), die(4)];
      if (dice.length !== 2 || dice.some((value) => !Number.isInteger(value) || value < 1 || value > 4)) throw new GenerationError("ability dice must be two d4 results");
      const rolled = { notation: "d4-d4", dice, result: dice[0] - dice[1] };
      addEvent(context, previous ? "reroll" : "roll", { [field]: rolled.result }, SOURCES.abilities, { roll: rolled, ...(previous ? { previousEvent: previous.id } : {}) });
      if (ability === "fortune" && companionKey(context.next) === 6) refreshFortune(context, "Current Companion #6 modifies the replaced FORTUNE roll");
      if (ability === "stoutness") {
        const hpRoll = latestEvent(context.next, (event) => event.source?.path === SOURCES.hp && event.roll?.notation === "d8");
        if (hpRoll) addDerived(context, { "health.hp.maximum": Math.max(1, hpRoll.roll.result + rolled.result) }, SOURCES.hp, { input: { hpRoll: hpRoll.roll.result, stoutness: rolled.result }, reason: "Current HP roll and replaced STOUTNESS" });
      }
      return context.next;
    },
    hp(state, options = {}) {
      const stoutness = state.character["abilities.stoutness"];
      if (!Number.isInteger(stoutness)) throw new GenerationError("HP requires an integer STOUTNESS");
      const previous = latestEvent(state, (event) => event.source?.path === SOURCES.hp && event.roll?.notation === "d8");
      const context = begin(state, "hp");
      const rolled = options.key === undefined ? roll("d8") : forcedRoll("d8", options.key);
      if (rolled.result < 1 || rolled.result > 8) throw new GenerationError("HP roll must be 1..8");
      const maximum = Math.max(1, rolled.result + stoutness);
      const writes = { "health.hp.maximum": maximum };
      if (options.initializeCurrent || !Object.hasOwn(state.character, "health.hp.current")) writes["health.hp.current"] = maximum;
      addEvent(context, previous ? "reroll" : "roll", writes, SOURCES.hp, { roll: rolled, ...(previous ? { previousEvent: previous.id } : {}) });
      return context.next;
    },
    background(state, options = {}) {
      const next = tableOperation(state, "background", "background.name", ([name, know, have]) => ({ "background.name": name, "background.know": know, "background.have": have }), options);
      const context = begin(next, "background-parts");
      refreshParts(context, "Current Background and Toolbox possessions");
      return context.next;
    },
    wrong(state, options = {}) {
      return tableOperation(state, "wrong", "identity.wrong", ([text], key, context) => {
        if (key === 20 && !options.luckyItem) unresolved(context, "lucky-item", "player-choice", catalog.tables.wrong.source, "Choose the ordinary carried lucky item.");
        else clearUnresolved(context, "lucky-item");
        return { "identity.wrong": key === 20 && options.luckyItem ? `${text} Lucky item: ${options.luckyItem}.` : text };
      }, options);
    },
    resolveLuckyItem(state, luckyItem) {
      const current = currentTableEvent(state, "wrong", "identity.wrong");
      if (current?.source.key !== 20 || !luckyItem) throw new GenerationError("lucky-item choice requires current What's Wrong With You? #20 and a value");
      const context = begin(state, "lucky-item-choice");
      addEvent(context, "choice", { "identity.wrong": `${state.character["identity.wrong"]} Lucky item: ${luckyItem}.` }, catalog.tables.wrong.source, { input: luckyItem });
      clearUnresolved(context, "lucky-item");
      return context.next;
    },
    good(state, options = {}) {
      return tableOperation(state, "good", "identity.good", ([text], key, context) => {
        addDerived(context, { "inventory.load.capacity": key === 10 ? 12 : 10 }, SOURCES.inventory, { reason: "Current One Good Thing" });
        return { "identity.good": text };
      }, options);
    },
    debt: (state, options = {}) => tableOperation(state, "debt", "identity.debt", ([text]) => ({ "identity.debt": text }), options),
    companion(state, options = {}) {
      const next = tableOperation(state, "companion", "identity.companion", ([text]) => ({ "identity.companion": text }), options);
      const context = begin(next, "companion-fortune");
      refreshFortune(context, "Current Companion");
      return context.next;
    },
    startingSupplies(state, options = {}) {
      const context = begin(state, "starting-supplies");
      const silver = options.silver === undefined ? die(20) : options.silver;
      const water = options.water === undefined ? die(4) : options.water;
      const rations = options.rations === undefined ? die(4) : options.rations;
      if (![silver, water, rations].every(Number.isInteger) || silver < 1 || silver > 20 || water < 1 || water > 4 || rations < 1 || rations > 4) throw new GenerationError("starting supply rolls are out of range");
      addEvent(context, "roll", { "resources.silver": silver, "resources.water": water, "resources.rations": rations }, SOURCES.starting, { roll: { notation: "d20/d4/d4", dice: [silver, water, rations], result: [silver, water, rations] } });
      refreshParts(context, "Starting Useful Parts plus current Background and Toolboxes");
      if (options.light === "candles" || options.light === "lantern") addEvent(context, "choice", { "resources.light": options.light === "candles" ? "Candles" : "Basic lantern" }, SOURCES.starting, { input: options.light });
      else unresolved(context, "light-choice", "player-choice", SOURCES.starting, "Choose candles or a basic lantern.");
      return context.next;
    },
    resolveLight(state, value) {
      if (!["candles", "lantern"].includes(value)) throw new GenerationError("light choice must be candles or lantern");
      const context = begin(state, "light-choice");
      addEvent(context, "choice", { "resources.light": value === "candles" ? "Candles" : "Basic lantern" }, SOURCES.starting, { input: value });
      clearUnresolved(context, "light-choice");
      return context.next;
    },
    weapon(state, options = {}) {
      const outcome = tableResult("weapon", options.key);
      const previous = currentTableEvent(state, "weapon", "weapon.type");
      const context = begin(state, "weapon");
      const [name, family, damage, ammo] = outcome.result.values;
      if (outcome.result.key === 20 && (!options.improvisedNightmare?.name || !["SIMPLE", "BUILT", "MECHANICAL"].includes(options.improvisedNightmare.family))) {
        addTableEvent(context, "weapon", outcome, { "weapon.type": name, "weapon.family": "", "weapon.damage": damage, "weapon.ammo_die": ammo }, previous);
        unresolved(context, "improvised-nightmare", "player-choice", catalog.tables.weapon.source, "Name the improvised nightmare and choose its physical Family.");
      } else {
        addTableEvent(context, "weapon", outcome, { "weapon.type": outcome.result.key === 20 ? options.improvisedNightmare.name : name, "weapon.family": outcome.result.key === 20 ? options.improvisedNightmare.family : family, "weapon.damage": damage, "weapon.ammo_die": ammo }, previous);
        clearUnresolved(context, "improvised-nightmare");
      }
      const next = context.next;
      return operations.weaponDependencies(next, options);
    },
    weaponDependencies(state, options = {}) {
      let next = state;
      if (options.defects !== false) next = operations.defects(next, options.defects ?? {});
      if (options.repair !== false) next = operations.repair(next, options.repair ?? {});
      const context = begin(next, "weapon-dependencies");
      if (currentTableEvent(next, "repair", "weapon.repair_history")) refreshRepairAppearance(context, "Current Weapon Family");
      refreshMatchingChoice(context);
      return context.next;
    },
    resolveImprovisedNightmare(state, { name, family } = {}) {
      const weapon = currentTableEvent(state, "weapon", "weapon.type");
      if (weapon?.source.key !== 20 || !name || !["SIMPLE", "BUILT", "MECHANICAL"].includes(family)) throw new GenerationError("Improvised Nightmare choice requires current Weapon #20, a name, and a valid Family");
      const context = begin(state, "improvised-nightmare-choice");
      addEvent(context, "choice", { "weapon.type": name, "weapon.family": family }, catalog.tables.weapon.source, { input: { name, family } });
      clearUnresolved(context, "improvised-nightmare");
      if (currentTableEvent(context.next, "repair", "weapon.repair_history")) refreshRepairAppearance(context, "Resolved current Weapon Family");
      return context.next;
    },
    defects(state, options = {}) {
      const weaponEvent = currentTableEvent(state, "weapon", "weapon.type");
      if (!weaponEvent) throw new GenerationError("Defects require a generated weapon");
      const needed = weaponEvent.source.key === 20 ? 2 : 1;
      const forced = options.keys ? [...options.keys] : options.key === undefined ? null : [options.key];
      const strictForced = Boolean(options.keys);
      if (strictForced && forced.length !== needed) throw new GenerationError(`weapon requires ${needed} initial Defect result(s)`);
      const chosen = [];
      while (chosen.length < needed) {
        const outcome = tableResult("defect", forced?.shift());
        if (chosen.some(({ result }) => result.key === outcome.result.key) || (needed > 1 && outcome.result.key === 20)) {
          if (strictForced) throw new GenerationError("initial Defects must be distinct, and #20 cannot accompany another Defect");
          continue;
        }
        chosen.push(outcome);
      }
      const context = begin(state, "defects");
      chosen.forEach((outcome, index) => addTableEvent(context, "defect", outcome, { [`weapon.defects.${index + 1}`]: `${outcome.result.values[0]} - ${outcome.result.values[1]}` }, currentTableEvent(state, "defect", `weapon.defects.${index + 1}`)));
      if (needed === 1) addDerived(context, { "weapon.defects.2": "" }, SOURCES.defects, { reason: "Current weapon requires one initial Defect" });
      if (chosen.some(({ result }) => result.key === weaponEvent.source.key) && options.nickname) {
        addEvent(context, "choice", { "weapon.nickname": options.nickname }, SOURCES.matching, { input: options.nickname });
      }
      refreshMatchingChoice(context);
      return context.next;
    },
    resolveWeaponNickname(state, nickname) {
      const weapon = currentTableEvent(state, "weapon", "weapon.type");
      if (!nickname || !weapon || !currentDefectKeys(state).includes(weapon.source.key)) throw new GenerationError("weapon nickname requires current matching Weapon and Defect rolls");
      const context = begin(state, "weapon-nickname-choice");
      addEvent(context, "choice", { "weapon.nickname": nickname }, SOURCES.matching, { input: nickname });
      clearUnresolved(context, "weapon-nickname");
      return context.next;
    },
    repair(state, options = {}) {
      const context = begin(state, "repair");
      const outcome = tableResult("repair", options.key);
      addTableEvent(context, "repair", outcome, { "weapon.repair_history": outcome.result.values[0] }, currentTableEvent(state, "repair", "weapon.repair_history"));
      refreshRepairAppearance(context, "Current repair result and Weapon Family");
      return context.next;
    },
    possession(state, slot, options = {}) {
      if (![1, 2].includes(slot)) throw new GenerationError("possession slot must be 1 or 2");
      const field = `possessions.${slot}.name`;
      const context = begin(state, `possession-${slot}`);
      const outcome = tableResult("possession", options.key);
      const previous = currentPossessionEvent(state, slot);
      addTableEvent(context, "possession", outcome, { [field]: outcome.result.values[0], [`possessions.${slot}.behavior`]: outcome.result.values[1], ...(!previous ? { [`possessions.${slot}.warranty`]: false, [`possessions.${slot}.wear.1`]: false, [`possessions.${slot}.wear.2`]: false, [`possessions.${slot}.wear.3`]: false } : {}) }, previous);
      if (outcome.result.key === 20) {
        const parts = options.toolboxRoll === undefined ? die(6) : options.toolboxRoll;
        if (!Number.isInteger(parts) || parts < 1 || parts > 6) throw new GenerationError("toolbox roll must be 1..6");
        const base = context.next.character["background.name"] === "TINKER BASTARD" ? 2 : 1;
        const otherSlot = slot === 1 ? 2 : 1;
        const total = base + parts + currentToolboxRoll(context.next, otherSlot);
        addEvent(context, "roll", { "resources.parts": total }, catalog.tables.possession.source, { source: { path: catalog.tables.possession.source, table: "possession", key: 20 }, roll: forcedRoll("d6", parts), reason: "TOOLBOX MARKED PROFESSIONAL", input: { slot } });
      }
      if (outcome.result.key !== 20) refreshParts(context, "Current Background and Toolbox possessions");
      if (currentWarrantyExists(context.next) && !context.next.character["possessions.1.warranty"] && !context.next.character["possessions.2.warranty"]) unresolved(context, "warranty-choice", "player-choice", catalog.tables.possession.source, "Choose which possession receives The Warranty.");
      else if (currentWarrantyExists(context.next)) clearUnresolved(context, "warranty-choice");
      else {
        clearUnresolved(context, "warranty-choice");
        addDerived(context, { "possessions.1.warranty": false, "possessions.2.warranty": false }, catalog.tables.possession.source, { reason: "No current Warranty result" });
      }
      return context.next;
    },
    warranty(state, slot) {
      if (![1, 2].includes(slot) || !currentWarrantyExists(state) || !currentPossessionEvent(state, slot)) throw new GenerationError("Warranty requires a current possession result #100 and a populated target slot");
      const context = begin(state, "warranty-choice");
      addEvent(context, "choice", { "possessions.1.warranty": slot === 1, "possessions.2.warranty": slot === 2 }, catalog.tables.possession.source, { input: { slot } });
      clearUnresolved(context, "warranty-choice");
      return context.next;
    },
    keepsake: (state, options = {}) => tableOperation(state, "keepsake", "keepsake.description", ([text]) => ({ "keepsake.description": text }), options),
  };

  function generateFull(options = {}) {
    let state = emptyState(catalogHash);
    state = operations.firstName(state, options.firstNameTable ?? (die(2) === 1 ? "first_name_men" : "first_name_women"), options.firstName ?? {});
    state = operations.lastName(state, options.lastName ?? {});
    for (const ability of ["stoutness", "alacrity", "savvy", "fortune"]) state = operations.ability(state, ability, options.abilities?.[ability] ?? {});
    state = operations.hp(state, { ...(options.hp ?? {}), initializeCurrent: true });
    state = operations.background(state, options.background ?? {});
    state = operations.wrong(state, options.wrong ?? {});
    state = operations.good(state, options.good ?? {});
    state = operations.debt(state, options.debt ?? {});
    state = operations.companion(state, options.companion ?? {});
    state = operations.startingSupplies(state, options.starting ?? {});
    state = operations.weapon(state, options.weapon ?? {});
    state = operations.possession(state, 1, options.possessions?.[1] ?? {});
    state = operations.possession(state, 2, options.possessions?.[2] ?? {});
    state = operations.keepsake(state, options.keepsake ?? {});
    return state;
  }

  return { generateFull, operations };
}
