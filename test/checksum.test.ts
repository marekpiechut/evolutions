import test, { describe } from 'node:test'
import assert from 'node:assert'
import { generateChecksum } from '../src/checksum.js'

describe('checksum', () => {
	test('generates checksum for empty array', () => {
		const result = generateChecksum([])
		assert.equal(result, 'da39a3ee5e6b4b0d3255bfef95601890afd80709')
	})

	test('generates checksum for empty string', () => {
		const result = generateChecksum([''])
		assert.equal(result, 'da39a3ee5e6b4b0d3255bfef95601890afd80709')
	})

	test('generates checksum for single sql', () => {
		const result = generateChecksum([
			'create table TEST (checksum VARCHAR(64), version INTEGER);',
		])
		assert.equal(result, '316baf1959f4030663c2ab409d3e2bc8af978967')
	})

	test('generates checksum for multiple sqls', () => {
		const result = generateChecksum([
			'create table TEST (checksum VARCHAR(64), version INTEGER);',
			"insert into TEST (checksum, version) values ('abc', 1);",
		])
		assert.equal(result, '612175e9c943a127b85da6279b29bf9d653b915a')
	})

	test('same sqls have same checksum', () => {
		const result1 = generateChecksum([
			'create table TEST (checksum VARCHAR(64), version INTEGER);',
			"insert into TEST (checksum, version) values ('abc', 1);",
		])

		const result2 = generateChecksum([
			'create table TEST (checksum VARCHAR(64), version INTEGER);',
			"insert into TEST (checksum, version) values ('abc', 1);",
		])
		assert.equal(result1, result2)
	})

	test('trailing whitespace does not change checksum', () => {
		const result1 = generateChecksum([
			'create table TEST (checksum VARCHAR(64), version INTEGER);',
			"insert into TEST (checksum, version) values ('abc', 1);",
		])

		const result2 = generateChecksum([
			'   create table TEST (checksum VARCHAR(64), version INTEGER);    ',
			"   insert into TEST (checksum, version) values ('abc', 1);    ",
		])
		assert.equal(result1, result2)
	})

	test('blank lines do not change checksum', () => {
		const result1 = generateChecksum([
			'create table TEST (checksum VARCHAR(64), version INTEGER);',
			"insert into TEST (checksum, version) values ('abc', 1);",
		])

		const result2 = generateChecksum([
			'   create table TEST (checksum VARCHAR(64), version INTEGER);    ',
			'      ',
			'						',
			"   insert into TEST (checksum, version) values ('abc', 1);    ",
			'',
		])
		assert.equal(result1, result2)
	})
})
