// inventory.js — two independent holders: one WEAPON slot, one ARTIFACT slot (operator law
// "one slot for weapon, one for artifact"). Pure functions over a plain {weapon, artifact} object,
// like boss.js / pantheon.js. Weapon classification is INJECTED (isWeapon predicate) so this module
// knows nothing about the game's item table — the game passes k => ITEMS[k] && ITEMS[k].weapon.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Inv = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {

  function newInv() { return { weapon: null, artifact: null }; }

  // which holder a pickup belongs in
  function slotFor(kind, isWeapon) { return isWeapon(kind) ? 'weapon' : 'artifact'; }

  // put `kind` into its slot; returns the new inventory + whatever it displaced (null if empty).
  // Pure — never mutates the input inventory (the game swaps the dropped item onto the floor).
  function pickup(inv, kind, isWeapon) {
    const slot = slotFor(kind, isWeapon);
    const dropped = inv[slot] || null;
    return { inv: { ...inv, [slot]: kind }, dropped };
  }

  return { newInv, slotFor, pickup };
});
