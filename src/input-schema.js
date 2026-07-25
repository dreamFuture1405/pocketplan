const VALID_MODES = ['meal', 'outfit'];
const MAX_BUDGET = 1000000;
const MAX_ITEMS = 100;
const MAX_CONSTRAINTS = 20;
const MAX_TIME = 1440;
const MAX_TEXT_LEN = 500;

function validateInput(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, errors: ['body must be an object'] };
  }
  const errors = [];

  if (!VALID_MODES.includes(body.mode)) {
    errors.push('mode must be one of: ' + VALID_MODES.join(', '));
  }

  if (typeof body.budget !== 'number' || !Number.isFinite(body.budget) || body.budget < 0 || body.budget > MAX_BUDGET) {
    errors.push('budget must be a finite number between 0 and ' + MAX_BUDGET);
  }

  if (!Array.isArray(body.ownedItems)) {
    errors.push('ownedItems must be an array');
  } else if (body.ownedItems.length > MAX_ITEMS) {
    errors.push('ownedItems must contain at most ' + MAX_ITEMS + ' items');
  } else if (!body.ownedItems.every(function (i) { return typeof i === 'string' && i.length <= MAX_TEXT_LEN; })) {
    errors.push('each owned item must be a string of at most ' + MAX_TEXT_LEN + ' chars');
  }

  if (typeof body.occasion !== 'string' || body.occasion.length < 1 || body.occasion.length > MAX_TEXT_LEN) {
    errors.push('occasion must be a non-empty string of at most ' + MAX_TEXT_LEN + ' chars');
  }

  if (typeof body.time !== 'number' || !Number.isFinite(body.time) || body.time < 0 || body.time > MAX_TIME) {
    errors.push('time must be a finite number between 0 and ' + MAX_TIME + ' minutes');
  }

  if (!Array.isArray(body.constraints)) {
    errors.push('constraints must be an array');
  } else if (body.constraints.length > MAX_CONSTRAINTS) {
    errors.push('constraints must contain at most ' + MAX_CONSTRAINTS + ' items');
  } else if (!body.constraints.every(function (c) { return typeof c === 'string' && c.length <= MAX_TEXT_LEN; })) {
    errors.push('each constraint must be a string of at most ' + MAX_TEXT_LEN + ' chars');
  }

  if (errors.length > 0) {
    return { ok: false, errors: errors };
  }
  return { ok: true, value: body };
}

module.exports = { validateInput };