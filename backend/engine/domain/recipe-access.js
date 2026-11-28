// Who may be answered from the factory work orders. The mark is a Symbol on the engine's input: a request body is JSON,
// which cannot carry one, so no client can grant it to itself.
'use strict';

const ACCESS = Symbol.for('ka.factoryRecipes');

/**
 * Accounts allowed: the ones switched on in the admin panel (Subscriptions → factory work orders), or named in
 * KA_RECIPE_ACCOUNTS="owner@mill.com,planner@mill.com". Either way the email must be verified.
 */
function allowedAccount(user) {
  if (!user || !user.email || user.email_verified === false) return false;
  if (user.factory_access === true) return true;
  const list = String(process.env.KA_RECIPE_ACCOUNTS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  return list.includes(String(user.email).toLowerCase());
}

/** mark (or unmark) an engine input for this user */
function grant(input, user) {
  if (input && typeof input === 'object') { if (allowedAccount(user)) input[ACCESS] = true; else delete input[ACCESS]; }
  return input;
}

const granted = (input) => !!(input && input[ACCESS] === true);

module.exports = { ACCESS, allowedAccount, grant, granted };
