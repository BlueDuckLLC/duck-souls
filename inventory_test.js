// inventory_test.js — TWO independent holders: one WEAPON slot, one ARTIFACT slot (operator law:
// "one slot for weapon, one for artifact"). Pure + node-tested like boss.js/pantheon.js. Weapon
// classification is INJECTED (isWeapon predicate) so the module stays game-agnostic. Written RED
// first per /tdd — no mock implementation; asserts real behavior.
const Inv = require('./inventory.js');

let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.error('FAIL: ' + name); } }

const WEAPONS = new Set(['sword', 'hammer', 'whip', 'rapier', 'boomerang', 'flail', 'sporebow']);
const isW = k => WEAPONS.has(k); // artifacts = anything not a weapon (gun, star, bomb, lantern, hotdog, key, chalice)

// newInv: two empty slots
{
  const inv = Inv.newInv();
  t('starts with an empty weapon slot', inv.weapon === null);
  t('starts with an empty artifact slot', inv.artifact === null);
}
// a WEAPON goes to the weapon slot, artifact slot untouched
{
  const r = Inv.pickup(Inv.newInv(), 'hammer', isW);
  t('weapon lands in the weapon slot', r.inv.weapon === 'hammer');
  t('artifact slot stays empty when picking a weapon', r.inv.artifact === null);
  t('nothing dropped into an empty weapon slot', r.dropped === null);
}
// an ARTIFACT (non-weapon) goes to the artifact slot, weapon slot untouched
{
  const r = Inv.pickup(Inv.newInv(), 'bomb', isW);
  t('artifact lands in the artifact slot', r.inv.artifact === 'bomb');
  t('weapon slot stays empty when picking an artifact', r.inv.weapon === null);
}
// the two slots are INDEPENDENT — holding both at once is the whole point
{
  let inv = Inv.pickup(Inv.newInv(), 'rapier', isW).inv;
  inv = Inv.pickup(inv, 'lantern', isW).inv;
  t('weapon + artifact are held simultaneously (weapon)', inv.weapon === 'rapier');
  t('weapon + artifact are held simultaneously (artifact)', inv.artifact === 'lantern');
}
// picking a new WEAPON swaps only the weapon (returns the dropped one); artifact is left alone
{
  let inv = Inv.pickup(Inv.newInv(), 'sword', isW).inv;
  inv = Inv.pickup(inv, 'gun', isW).inv;                 // gun = artifact
  const r = Inv.pickup(inv, 'flail', isW);               // new weapon
  t('new weapon replaces the old weapon', r.inv.weapon === 'flail');
  t('swapping a weapon returns the dropped weapon', r.dropped === 'sword');
  t('swapping a weapon does NOT touch the artifact', r.inv.artifact === 'gun');
}
// picking a new ARTIFACT swaps only the artifact; weapon is left alone
{
  let inv = Inv.pickup(Inv.newInv(), 'whip', isW).inv;
  inv = Inv.pickup(inv, 'hotdog', isW).inv;
  const r = Inv.pickup(inv, 'chalice', isW);
  t('new artifact replaces the old artifact', r.inv.artifact === 'chalice');
  t('swapping an artifact returns the dropped artifact', r.dropped === 'hotdog');
  t('swapping an artifact does NOT touch the weapon', r.inv.weapon === 'whip');
}
// pickup is PURE — it must not mutate the input inventory
{
  const inv0 = Inv.newInv();
  Inv.pickup(inv0, 'hammer', isW);
  t('pickup does not mutate the input inventory', inv0.weapon === null);
}
// slotFor: the classification helper the game will use to route a pickup
{
  t('slotFor routes a weapon to "weapon"', Inv.slotFor('boomerang', isW) === 'weapon');
  t('slotFor routes a non-weapon to "artifact"', Inv.slotFor('key', isW) === 'artifact');
}

console.log(`\ninventory: ${pass} passed, ${fail} failed`);
console.log(`=== ${fail} failed, ${pass} passed in 0.00s ===`);
process.exit(fail ? 1 : 0);
