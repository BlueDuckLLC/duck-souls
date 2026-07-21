// inventory.js — STUB (RED). Real implementation lands after the failing test is committed.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Inv = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function newInv() { return {}; }
  function slotFor() { return null; }
  function pickup(inv) { return { inv, dropped: null }; }
  return { newInv, slotFor, pickup };
});
