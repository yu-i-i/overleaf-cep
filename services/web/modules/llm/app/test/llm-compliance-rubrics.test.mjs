// overleaf-lab (2026-08-27): the shared rubric helpers used by BOTH the admin
// save and the new per-user compliance rubric save. They are pure functions,
// so this is a plain node:test file (no app context needed).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
    sanitizeComplianceRubrics,
    validateComplianceRubrics,
} from '../src/LLMAdminController.mjs'

test('sanitizeComplianceRubrics: non-array -> null (caller keeps existing)', () => {
    assert.equal(sanitizeComplianceRubrics(undefined), null)
    assert.equal(sanitizeComplianceRubrics(null), null)
    assert.equal(sanitizeComplianceRubrics('nope'), null)
})

test('sanitizeComplianceRubrics: drops incomplete entries, caps lengths and count', () => {
    const longName = 'x'.repeat(500)
    const longGuidelines = 'g'.repeat(50000)
    const list = [
        ...Array.from({ length: 12 }, (_, i) => ({
            id: `r${i}`,
            name: `rubric ${i}`,
            guidelines: '1. be kind',
            scanPatterns: 'Wikipedia :: wikipedia',
        })),
        { id: '', name: 'no id', guidelines: 'x' },
        { id: 'nom', name: '', guidelines: 'x' },
        { id: 'cap', name: longName, guidelines: longGuidelines, scanPatterns: 'p'.repeat(9000) },
    ]
    const out = sanitizeComplianceRubrics(list)
    assert.equal(out.length, 13) // 15 in - 2 incomplete; well under the cap of 50
    const cap = out.find(r => r.id === 'cap')
    assert.equal(cap.name.length, 200)
    assert.equal(cap.guidelines.length, 20000)
    assert.equal(cap.scanPatterns.length, 4000)
})

test('sanitizeComplianceRubrics: caps the list at 50 rubrics', () => {
    const big = Array.from({ length: 55 }, (_, i) => ({ id: `r${i}`, name: `rubric ${i}` }))
    assert.equal(sanitizeComplianceRubrics(big).length, 50)
})

test('validateComplianceRubrics: clean list -> null', () => {
    const ok = [
        { name: 'a', scanPatterns: '' },
        { name: 'b', scanPatterns: 'Wikipedia :: wikipedia\nFirst person :: (?<![\\w.@/])io\\b' },
    ]
    assert.equal(validateComplianceRubrics(ok), null)
    assert.equal(validateComplianceRubrics(null), null)
})

test('validateComplianceRubrics: invalid regex and over-long patterns are rejected', () => {
    const badRegex = [{ name: 'r', scanPatterns: 'Broken :: (unclosed' }]
    assert.match(
        validateComplianceRubrics(badRegex),
        /Invalid scan pattern regex in rubric "r"/,
    )
    const tooLong = [{ name: 'r', scanPatterns: 'a'.repeat(4001) }]
    assert.match(
        validateComplianceRubrics(tooLong),
        /must be 4000 characters or fewer/,
    )
})
