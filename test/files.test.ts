import test, { describe } from 'node:test'
import { Readable } from 'node:stream'
import assert from 'node:assert'
import { parseSqlFile } from '../src/files.js'

describe('sql file parsing', () => {
	test('handles empty files gracefuly', async () => {
		const emptyStream = Readable.from('')
		const result = await parseSqlFile(emptyStream)
		assert.deepEqual(result.ups, [])
		assert.equal(result.downs, undefined)
	})

	test('handles file without comments as ups only', async () => {
		const emptyStream = Readable.from(`
			CREATE TABLE test (id INT PRIMARY KEY, name TEXT);

			INSERT INTO test (id, name) VALUES (1, 'Test');
		`)
		const result = await parseSqlFile(emptyStream)
		assert.deepEqual(result.ups, [
			'CREATE TABLE test (id INT PRIMARY KEY, name TEXT);',
			"INSERT INTO test (id, name) VALUES (1, 'Test');",
		])
		assert.equal(result.downs, undefined)
	})

	test('merges lines without semicolon', async () => {
		const emptyStream = Readable.from(`
			CREATE TABLE test (
				id INT PRIMARY KEY, name TEXT
			);

			INSERT INTO test (id, name) VALUES (1, 'Test');
		`)
		const result = await parseSqlFile(emptyStream)
		assert.deepEqual(result.ups, [
			'CREATE TABLE test (\nid INT PRIMARY KEY, name TEXT\n);',
			"INSERT INTO test (id, name) VALUES (1, 'Test');",
		])
		assert.equal(result.downs, undefined)
	})

	test('ignores comments', async () => {
		const emptyStream = Readable.from(`
			CREATE TABLE test (id INT PRIMARY KEY, name TEXT);
			-- comment 1
			INSERT INTO test (id, name) VALUES (1, 'Test');
			-- comment 2
		`)
		const result = await parseSqlFile(emptyStream)
		assert.deepEqual(result.ups, [
			'CREATE TABLE test (id INT PRIMARY KEY, name TEXT);',
			"INSERT INTO test (id, name) VALUES (1, 'Test');",
		])
		assert.equal(result.downs, undefined)
	})

	test('parses up/down sections', async () => {
		const emptyStream = Readable.from(`
			CREATE TABLE test (
				id INT PRIMARY KEY, name TEXT
			);

			INSERT INTO test (id, name) VALUES (1, 'Test');
			-- DOWN --
			DROP TABLE test;
			DROP TABLE test2;
		`)
		const result = await parseSqlFile(emptyStream)
		assert.deepEqual(result.ups, [
			'CREATE TABLE test (\nid INT PRIMARY KEY, name TEXT\n);',
			"INSERT INTO test (id, name) VALUES (1, 'Test');",
		])
		assert.deepEqual(result.downs, ['DROP TABLE test;', 'DROP TABLE test2;'])
	})

	test('does not split on semicolons in blocks', async () => {
		const emptyStream = Readable.from(`
			CREATE TABLE test (id INT PRIMARY KEY, name TEXT);

			-- BLOCK --
			CREATE FUNCTION test_function() RETURNS VOID AS $$
			BEGIN
				INSERT INTO test (id, name) VALUES (1, 'Test');
				INSERT INTO test (id, name) VALUES (2, 'Test2');
			END;
			$$ LANGUAGE plpgsql;
			-- BLOCK END --

			INSERT INTO test (id, name) VALUES (1, 'Test');
		`)
		const result = await parseSqlFile(emptyStream)
		assert.deepEqual(result.ups, [
			'CREATE TABLE test (id INT PRIMARY KEY, name TEXT);',
			"CREATE FUNCTION test_function() RETURNS VOID AS $$\nBEGIN\nINSERT INTO test (id, name) VALUES (1, 'Test');\nINSERT INTO test (id, name) VALUES (2, 'Test2');\nEND;\n$$ LANGUAGE plpgsql;",
			"INSERT INTO test (id, name) VALUES (1, 'Test');",
		])
	})
})
