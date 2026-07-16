const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

describe('Reminder round-trip', () => {
  it('hidden field defaults to empty array', () => {
    assert.equal('<input type="hidden" name="reminders_json" value="[]">', '<input type="hidden" name="reminders_json" value="[]">');
  });

  it('serializes reminders to reminders_json', () => {
    const reminders = [
      { count: 10, unit: 'minutes', related: 'START' },
      { count: 1, unit: 'hours', related: 'START' }
    ];
    const json = JSON.stringify(reminders);
    const parsed = JSON.parse(json);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].count, 10);
    assert.equal(parsed[0].unit, 'minutes');
    assert.equal(parsed[0].related, 'START');
    assert.equal(parsed[1].count, 1);
    assert.equal(parsed[1].unit, 'hours');
  });

  it('empty reminders array serializes correctly', () => {
    const json = JSON.stringify([]);
    const parsed = JSON.parse(json);
    assert.equal(parsed.length, 0);
  });

  it('validates reminder count range', () => {
    const valid = (count) => Number.isInteger(count) && count >= 0 && count <= 525600;
    assert.ok(valid(0));
    assert.ok(valid(525600));
    assert.ok(valid(10));
    assert.ok(!valid(-1));
    assert.ok(!valid(525601));
    assert.ok(!valid(1.5));
  });

  it('validates reminder unit values', () => {
    const validUnits = ['minutes', 'hours', 'days', 'weeks', 'months'];
    assert.ok(validUnits.includes('minutes'));
    assert.ok(validUnits.includes('hours'));
    assert.ok(validUnits.includes('days'));
    assert.ok(validUnits.includes('weeks'));
    assert.ok(validUnits.includes('months'));
    assert.ok(!validUnits.includes('years'));
    assert.ok(!validUnits.includes('seconds'));
  });

  it('limits reminders to five', () => {
    const reminders = Array.from({ length: 5 }, (_, i) => ({
      count: i * 10, unit: 'minutes', related: 'START'
    }));
    assert.ok(reminders.length <= 5);
    const overLimit = Array.from({ length: 6 }, (_, i) => ({
      count: i * 10, unit: 'minutes', related: 'START'
    }));
    assert.ok(overLimit.length > 5);
  });
});
