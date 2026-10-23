import test from 'node:test';
import assert from 'node:assert/strict';
import { hasConfiguredOpeningHours, validateAppointmentSelection } from '../src/appointmentRules';

const mondayHours = { mon: [{ open: '12:00', close: '16:00' }] };
const futureNow = new Date('2026-10-18T00:00:00.000Z');

test('no configured opening hours allow a request without a selected time', () => {
  assert.equal(hasConfiguredOpeningHours({ sun: [], mon: [], tue: [] }), false);
  assert.equal(validateAppointmentSelection({
    needsAppointment: true,
    durationMinutes: 60,
    openingHoursDays: { sun: [], mon: [], tue: [] },
    timezone: 'Asia/Jerusalem',
    now: futureNow,
  }), null);
});

test('configured opening hours require a selected appointment time', () => {
  assert.equal(validateAppointmentSelection({
    needsAppointment: true,
    durationMinutes: 60,
    openingHoursDays: mondayHours,
    timezone: 'Asia/Jerusalem',
    now: futureNow,
  }), 'appointment_required');
});

test('a business with hours on some days still requires a time when the selected day is closed', () => {
  assert.equal(validateAppointmentSelection({
    needsAppointment: true,
    durationMinutes: 60,
    openingHoursDays: { sun: [], mon: [{ open: '12:00', close: '16:00' }] },
    timezone: 'Asia/Jerusalem',
    now: futureNow,
  }), 'appointment_required');
});

test('a valid appointment within the opening range is accepted', () => {
  assert.equal(validateAppointmentSelection({
    needsAppointment: true,
    appointmentAt: '2026-10-19T12:00',
    durationMinutes: 60,
    openingHoursDays: mondayHours,
    timezone: 'Asia/Jerusalem',
    now: futureNow,
  }), null);
});

test('an appointment that ends after closing is rejected', () => {
  assert.equal(validateAppointmentSelection({
    needsAppointment: true,
    appointmentAt: '2026-10-19T15:30',
    durationMinutes: 60,
    openingHoursDays: mondayHours,
    timezone: 'Asia/Jerusalem',
    now: futureNow,
  }), 'invalid_appointment_time');
});

test('past appointment requests are rejected', () => {
  assert.equal(validateAppointmentSelection({
    needsAppointment: true,
    appointmentAt: '2026-10-18T12:00',
    durationMinutes: 60,
    openingHoursDays: { sun: [{ open: '09:00', close: '17:00' }] },
    timezone: 'Asia/Jerusalem',
    now: new Date('2026-10-18T12:00:00.000Z'),
  }), 'invalid_appointment_time');
});


test('appointment starts use a fixed 15-minute grid independent of service duration', () => {
  const hours = { mon: [{ open: '09:00', close: '12:00' }] };
  assert.equal(validateAppointmentSelection({
    needsAppointment: true,
    appointmentAt: '2026-10-19T09:45',
    durationMinutes: 45,
    openingHoursDays: hours,
    timezone: 'Asia/Jerusalem',
    now: new Date('2026-10-19T06:39:00.000Z'),
  }), null);
  assert.equal(validateAppointmentSelection({
    needsAppointment: true,
    appointmentAt: '2026-10-19T09:43',
    durationMinutes: 45,
    openingHoursDays: hours,
    timezone: 'Asia/Jerusalem',
    now: new Date('2026-10-19T06:39:00.000Z'),
  }), 'invalid_appointment_time');
});

test('a selected appointment time is rejected for items that do not require appointments', () => {
  assert.equal(validateAppointmentSelection({
    needsAppointment: false,
    appointmentAt: '2026-10-19T12:00',
    durationMinutes: 0,
    openingHoursDays: mondayHours,
    timezone: 'Asia/Jerusalem',
    now: futureNow,
  }), 'appointment_not_applicable');
});
