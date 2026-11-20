import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { CREDITS, licenceFileOf } from '../src/app/credits.ts'
import { reflowLicence } from '../src/app/licenceText.ts'

test('reflowLicence: lines inside a paragraph are joined, blank lines separate paragraphs', () => {
  assert.deepEqual(reflowLicence('Permission is hereby\ngranted, free of\n  charge.\n\n\nThe above notice\nshall be included.\n'), [
    'Permission is hereby granted, free of charge.',
    'The above notice shall be included.',
  ])
  assert.deepEqual(reflowLicence('a\r\nb\r\n\r\nc'), ['a b', 'c'])
  assert.deepEqual(reflowLicence('  \n\n  '), [])
  assert.deepEqual(reflowLicence(''), [])
})

test('reflowLicence: no word is lost or added in any licence file', () => {
  for (const credit of CREDITS) {
    const text = readFileSync(fileURLToPath(new URL(`../public/licences/${licenceFileOf(credit)}`, import.meta.url)), 'utf8')
    assert.equal(reflowLicence(text).join(' '), text.split(/\s+/).filter(Boolean).join(' '), credit.id)
  }
})
