import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { Readable } from 'node:stream'
import { Evolution, EvolutionExpression } from './models.js'

export const parseFiles = async (
	filesOrFolder: string | string[]
): Promise<Evolution[]> => {
	let files
	if (typeof filesOrFolder === 'string') {
		files = await fs.promises.readdir(filesOrFolder)
		files = files.map(f => path.join(filesOrFolder, f))
	} else {
		files = filesOrFolder
	}
	const sqls = files.filter(f => f.endsWith('.sql')).sort()
	const parsed = await Promise.all(
		sqls.map(file => {
			const stream = fs.createReadStream(file, 'utf-8')
			return parseSqlFile(stream)
		})
	)
	return parsed
}

export const parseSqlFile = (stream: Readable): Promise<Evolution> => {
	return new Promise((resolve, reject) => {
		const reader = readline.createInterface({ input: stream })
		const ups: EvolutionExpression[] = []
		const downs: EvolutionExpression[] = []
		let current = ups
		let statement = ''
		let inBlock = false
		reader.on('error', reject)
		reader.on('line', line => {
			const trimmed = line.trim()
			if (statement.length > 0) {
				statement += '\n'
			}

			//Skip blank lines
			if (trimmed.length === 0) {
				return
			} else if (trimmed === '-- DOWN --') {
				current = downs
			} else if (trimmed === '-- BLOCK --') {
				inBlock = true
			} else if (inBlock && trimmed === '-- BLOCK END --') {
				if (statement.trim()) {
					current.push(statement.trim())
					statement = ''
				}
				inBlock = false
			} else if (!trimmed.startsWith('--')) {
				statement += trimmed
				if (!inBlock && trimmed.endsWith(';')) {
					current.push(statement)
					statement = ''
				}
			}
		})
		reader.on('close', () => {
			if (statement) {
				current.push(statement)
			}
			resolve({
				ups: ups,
				downs: downs.length ? downs : undefined,
			})
		})
	})
}
