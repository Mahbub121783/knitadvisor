// Who may be answered from the factory work orders. The mark is a Symbol on the engine's input: a request body is JSON,
// which cannot carry one, so no client can grant it to itself.
'use strict';

const ACCESS = Symbol.for('ka.factoryRecipes');

/** accounts allowed: KA_RECIPE_ACCOUNTS="owner@mill.com,planner@mill.com" (read at each call, so a restart is enough) */
function allowedAccount(user) {
  const list = String(process.env.KA_RECIPE_ACCOUNTS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  return !!(user && user.email && user.email_verified !== false && list.includes(String(user.email).toLowerCase()));
}

/** mark (or unmark) an engine input for this user */
function grant(input, user) {
  if (input && typeof input === 'object') { if (allowedAccount(user)) input[ACCESS] = true; else delete input[ACCESS]; }
  return input;
}

const granted = (input) => !!(input && input[ACCESS] === true);

module.exports = { ACCESS, allowedAccount, grant, granted };
