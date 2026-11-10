import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReminders, choicesFrom, urlBase64ToBytes, ALL_DAYS } from '../../public/assets/js/lib/reminders.js';

test('reminder choices become the server list and back', () => {
  const { reminders, error } = buildReminders({ meals: { on: true, time: '19:30' }, weight: { on: true, time: '07:15', days: [1, 3, 3, 9] }, workout: { on: false, time: '18:00' } });
  assert.equal(error, null);
  assert.deepEqual(reminders, [{ type: 'meals', time: '19:30', days: ALL_DAYS }, { type: 'weight', time: '07:15', days: [1, 3] }]);
  assert.deepEqual(choicesFrom(reminders).weight, { on: true, time: '07:15', days: [1, 3] });
  assert.deepEqual(choicesFrom([]).workout, { on: false, time: '18:00', days: ALL_DAYS });
  assert.match(buildReminders({ meals: { on: true, time: '25:00' } }).error, /time for “Food diary”/);
  assert.match(buildReminders({ meals: { on: true, time: '08:00', days: [] } }).error, /at least one day/);
  assert.deepEqual(buildReminders({}).reminders, []);
});

test('VAPID key decoding', () => {
  assert.deepEqual([...urlBase64ToBytes('AQID_-8')], [1, 2, 3, 255, 239]);
});
