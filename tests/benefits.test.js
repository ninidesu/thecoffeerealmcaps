import test from 'node:test'
import assert from 'node:assert/strict'
import { validateBenefitInformation, benefitLinkLabel } from '../src/utils/benefits.js'

const today = new Date(2026, 8, 5, 12)
const applicant = { kind: 'senior', full_name: 'Maria Dela Cruz', date_of_birth: '1966-09-05', id_number: '00123456' }
test('senior age boundary uses the full birthday, while PWD applicants need not be seniors', () => {
  assert.equal(validateBenefitInformation(applicant, today), '')
  assert.match(validateBenefitInformation({ ...applicant, date_of_birth: '1966-09-06' }, today), /60/)
  assert.equal(validateBenefitInformation({ ...applicant, kind: 'pwd', date_of_birth: '2001-02-28' }, today), '')
})
test('invalid calendar dates, future birthdays, bad names and overlong IDs are rejected', () => {
  for (const date_of_birth of ['', '2025-02-29', '2000-04-31', '2027-01-01', '1899-12-31']) assert.notEqual(validateBenefitInformation({ ...applicant, kind: 'pwd', date_of_birth }, today), '')
  assert.equal(validateBenefitInformation({ ...applicant, kind: 'pwd', date_of_birth: '2000-02-29' }, today), '')
  for (const full_name of ['A', 'Maria123', '<script>', 'A'.repeat(61)]) assert.notEqual(validateBenefitInformation({ ...applicant, full_name }, today), '')
  for (const id_number of ['', '12', '1'.repeat(21), '123-456', 'SC123456', '123 456', '１２３', ' 123456 ']) assert.notEqual(validateBenefitInformation({ ...applicant, id_number }, today), '')
  assert.equal(validateBenefitInformation({ ...applicant, id_number: '0'.repeat(20) }, today), '')
})
test('profile labels distinguish every application state and approved benefit type', () => {
  assert.match(benefitLinkLabel(null), /^Apply/)
  assert.match(benefitLinkLabel({ status: 'pending' }), /status/)
  assert.match(benefitLinkLabel({ status: 'resubmission' }), /^Update/)
  assert.match(benefitLinkLabel({ status: 'rejected' }), /rejected/)
  assert.equal(benefitLinkLabel({ status: 'approved', kind: 'senior' }), 'Verified as Senior Citizen')
  assert.match(benefitLinkLabel({ status: 'approved', kind: 'pwd' }), /PWD/)
})
